import { existsSync, mkdirSync } from 'fs';
import { cpus } from 'os';
import { basename, join } from 'path';
import { Worker } from 'worker_threads';
import { isDeepStrictEqual } from 'util';

import type {
  WorkerJobName,
  WorkerJobPayloadMap,
  WorkerJobResultMap,
  WorkerPriority,
  WorkerRunOptions,
  WorkerChildMessage,
  WorkerProgressEvent,
} from './types';

export class WorkerJobCancelledError extends Error {
  constructor(message = 'Worker job cancelled') {
    super(message);
    this.name = 'WorkerJobCancelledError';
  }
}

export class WorkerQueueFullError extends Error {
  constructor(message = 'Worker queue is full') {
    super(message);
    this.name = 'WorkerQueueFullError';
  }
}

interface QueuedJob<N extends WorkerJobName = WorkerJobName> {
  id: string;
  name: N;
  payload: WorkerJobPayloadMap[N];
  priority: WorkerPriority;
  queuedAt: number;
  timeoutMs?: number;
  resolve: (result: WorkerJobResultMap[N]) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: WorkerProgressEvent) => void;
  subscribers: JobSubscriber[];
}

interface JobSubscriber {
  resolve: (result: WorkerJobResultMap[WorkerJobName]) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: WorkerProgressEvent) => void;
}

interface ActiveJob {
  name: WorkerJobName;
  payload: WorkerJobPayloadMap[WorkerJobName];
  worker: Worker;
  timeout: NodeJS.Timeout | null;
  resolve: (result: WorkerJobResultMap[WorkerJobName]) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: WorkerProgressEvent) => void;
  subscribers: JobSubscriber[];
}

export interface WorkerPoolOptions {
  maxWorkers?: number;
  workerScript?: string;
  maxQueuedJobs?: number;
  backgroundAgingMs?: number;
}

export const DEFAULT_MAX_QUEUED_WORKER_JOBS = 1000;
export const DEFAULT_BACKGROUND_WORKER_AGING_MS = 5_000;

const COALESCIBLE_READ_JOBS = new Set<WorkerJobName>([
  'fs:folderSizes',
  'svn:deepStatus',
  'svn:fsStatus',
  'svn:workingCopyStatus',
  'svn:diff',
  'svn:diffStreaming',
  'svn:diffUrls',
  'svn:log',
  'svn:blame',
  'svn:cat',
]);

function getDefaultWorkerCount(): number {
  return Math.max(2, Math.min((cpus().length || 2) - 1, 4));
}

function getDefaultWorkerScript(): string {
  const builtWorkerScript = join(__dirname, 'workers', 'svn-worker.js');
  if (existsSync(builtWorkerScript)) {
    return builtWorkerScript;
  }

  if (basename(__dirname) !== 'workers') {
    const projectBuiltWorkerScript = join(process.cwd(), 'out', 'main', 'workers', 'svn-worker.js');
    if (existsSync(projectBuiltWorkerScript)) {
      return projectBuiltWorkerScript;
    }

    return builtWorkerScript;
  }

  const sourceWorkerScript = join(__dirname, 'svn-worker.ts');
  const testWorkerScript = join(process.cwd(), 'tmp', 'workers', 'svn-worker.cjs');

  mkdirSync(join(process.cwd(), 'tmp', 'workers'), { recursive: true });
  const { buildSync } = loadEsbuild();
  buildSync({
    entryPoints: [sourceWorkerScript],
    outfile: testWorkerScript,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    tsconfig: join(process.cwd(), 'tsconfig.node.json'),
    logLevel: 'silent',
  });
  return testWorkerScript;
}

function loadEsbuild(): typeof import('esbuild') {
  try {
    return require('esbuild') as typeof import('esbuild');
  } catch {
    return require(
      join(process.cwd(), 'node_modules', '.bun', 'node_modules', 'esbuild')
    ) as typeof import('esbuild');
  }
}

export class WorkerPool {
  private readonly maxWorkers: number;
  private readonly workerScript: string;
  private readonly maxQueuedJobs: number;
  private readonly backgroundAgingMs: number;
  private readonly queue: QueuedJob[] = [];
  private readonly activeJobs = new Map<string, ActiveJob>();
  private readonly workers = new Set<Worker>();
  private shuttingDown = false;

  constructor(options: WorkerPoolOptions = {}) {
    this.maxWorkers = options.maxWorkers ?? getDefaultWorkerCount();
    this.workerScript = options.workerScript ?? getDefaultWorkerScript();
    this.maxQueuedJobs = options.maxQueuedJobs ?? DEFAULT_MAX_QUEUED_WORKER_JOBS;
    this.backgroundAgingMs = options.backgroundAgingMs ?? DEFAULT_BACKGROUND_WORKER_AGING_MS;
  }

  run<N extends WorkerJobName>(
    name: N,
    payload: WorkerJobPayloadMap[N],
    options: WorkerRunOptions = {}
  ): Promise<WorkerJobResultMap[N]> {
    const id = options.id ?? `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const priority = options.priority ?? 'background';
    const joinExisting = options.joinExisting ?? COALESCIBLE_READ_JOBS.has(name);

    return new Promise<WorkerJobResultMap[N]>((resolve, reject) => {
      if (this.shuttingDown) {
        reject(new WorkerJobCancelledError('Worker pool is shutting down'));
        return;
      }

      const activeJob = this.activeJobs.get(id);
      if (
        activeJob &&
        joinExisting &&
        activeJob.name === name &&
        isDeepStrictEqual(activeJob.payload, payload)
      ) {
        activeJob.subscribers.push({
          resolve: resolve as (result: WorkerJobResultMap[WorkerJobName]) => void,
          reject,
          onProgress: options.onProgress,
        });
        return;
      }
      if (activeJob) {
        reject(new Error(`Worker job is already running: ${id}`));
        return;
      }

      const duplicateQueuedIndex = this.queue.findIndex((job) => job.id === id);
      if (duplicateQueuedIndex >= 0) {
        const duplicate = this.queue[duplicateQueuedIndex];
        if (
          joinExisting &&
          duplicate.name === name &&
          isDeepStrictEqual(duplicate.payload, payload)
        ) {
          this.queue[duplicateQueuedIndex].subscribers.push({
            resolve: resolve as (result: WorkerJobResultMap[WorkerJobName]) => void,
            reject,
            onProgress: options.onProgress,
          });
          return;
        }
        const [superseded] = this.queue.splice(duplicateQueuedIndex, 1);
        this.rejectQueuedJob(superseded, new WorkerJobCancelledError('Worker job superseded'));
      }

      if (this.queue.length >= this.maxQueuedJobs) {
        reject(new WorkerQueueFullError());
        return;
      }

      this.queue.push({
        id,
        name,
        payload,
        priority,
        queuedAt: Date.now(),
        timeoutMs: options.timeoutMs,
        resolve,
        reject,
        onProgress: options.onProgress,
        subscribers: [],
      });
      this.sortQueue();
      this.startNext();
    });
  }

  cancel(id: string): boolean {
    const queuedIndex = this.queue.findIndex((job) => job.id === id);
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1);
      this.rejectQueuedJob(job, new WorkerJobCancelledError());
      return true;
    }

    const active = this.activeJobs.get(id);
    if (!active) {
      return false;
    }

    // oxlint-disable-next-line eslint-plugin-unicorn(require-post-message-target-origin)
    active.worker.postMessage({ type: 'cancel', id });
    return true;
  }

  getStateForTests() {
    return {
      activeCount: this.activeJobs.size,
      queuedCount: this.queue.length,
      workerCount: this.workers.size,
      joinedSubscriberCount:
        Array.from(this.activeJobs.values()).reduce(
          (count, job) => count + job.subscribers.length,
          0
        ) + this.queue.reduce((count, job) => count + job.subscribers.length, 0),
      activeIds: Array.from(this.activeJobs.keys()),
      queuedIds: this.queue.map((job) => job.id),
    };
  }

  private sortQueue() {
    const now = Date.now();
    const score = (job: QueuedJob) => {
      if (job.priority === 'interactive') return 0;
      return now - job.queuedAt >= this.backgroundAgingMs ? -1 : 1;
    };
    this.queue.sort((a, b) => score(a) - score(b) || a.queuedAt - b.queuedAt);
  }

  private startNext() {
    while (this.activeJobs.size < this.maxWorkers && this.queue.length > 0) {
      this.sortQueue();
      const worker = this.getIdleWorker() ?? this.createWorker();
      if (!worker) {
        return;
      }
      const job = this.queue.shift()!;
      this.startJob(worker, job);
    }
  }

  private getIdleWorker(): Worker | null {
    for (const worker of this.workers) {
      const busy = Array.from(this.activeJobs.values()).some((job) => job.worker === worker);
      if (!busy) {
        return worker;
      }
    }

    return null;
  }

  private createWorker(): Worker | null {
    if (this.workers.size >= this.maxWorkers || this.shuttingDown) {
      return null;
    }

    const worker = new Worker(this.workerScript);
    this.workers.add(worker);

    worker.on('message', (message: WorkerChildMessage) => {
      const active = this.activeJobs.get(message.id);
      if (!active || active.worker !== worker) return;

      if (message.type === 'progress') {
        active.onProgress?.(message.progress);
        for (const subscriber of active.subscribers) {
          subscriber.onProgress?.(message.progress);
        }
      } else if (message.type === 'result') {
        this.resolveJob(message.id, message.result as WorkerJobResultMap[WorkerJobName]);
      } else {
        this.rejectJob(message.id, new Error(message.error));
      }
    });

    worker.on('error', (error) => {
      this.workers.delete(worker);
      this.rejectJobsForWorker(worker, error);
      void worker.terminate();
      this.startNext();
    });

    worker.on('exit', (code) => {
      this.workers.delete(worker);
      if (!this.shuttingDown) {
        this.rejectJobsForWorker(worker, new Error(`Worker exited with code ${code}`));
      }
      this.startNext();
    });

    return worker;
  }

  private startJob<N extends WorkerJobName>(worker: Worker, job: QueuedJob<N>) {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      this.activeJobs.delete(job.id);
      this.startNext();
    };

    const reject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      job.reject(error);
      for (const subscriber of job.subscribers) {
        subscriber.reject(error);
      }
    };

    const resolve = (result: WorkerJobResultMap[N]) => {
      if (settled) return;
      settled = true;
      cleanup();
      job.resolve(result);
      for (const subscriber of job.subscribers) {
        subscriber.resolve(result as WorkerJobResultMap[WorkerJobName]);
      }
    };

    if (job.timeoutMs && job.timeoutMs > 0) {
      timeout = setTimeout(() => {
        // oxlint-disable-next-line eslint-plugin-unicorn(require-post-message-target-origin)
        worker.postMessage({ type: 'cancel', id: job.id });
        this.workers.delete(worker);
        void worker.terminate();
        reject(new Error(`Worker job timed out after ${job.timeoutMs}ms`));
      }, job.timeoutMs);
    }

    this.activeJobs.set(job.id, {
      worker,
      timeout,
      reject,
      resolve: resolve as (result: WorkerJobResultMap[WorkerJobName]) => void,
      onProgress: job.onProgress,
      subscribers: job.subscribers,
      name: job.name,
      payload: job.payload,
    });
    // oxlint-disable eslint-plugin-unicorn(require-post-message-target-origin)
    worker.postMessage({
      id: job.id,
      name: job.name,
      payload: job.payload,
    });
    // oxlint-enable eslint-plugin-unicorn(require-post-message-target-origin)
  }

  private resolveJob(id: string, result: WorkerJobResultMap[WorkerJobName]) {
    const active = this.activeJobs.get(id);
    if (!active) return;

    if (active.timeout) {
      clearTimeout(active.timeout);
    }
    this.activeJobs.delete(id);
    active.resolve(result);
  }

  private rejectJob(id: string, error: Error) {
    const active = this.activeJobs.get(id);
    if (!active) return;

    if (active.timeout) {
      clearTimeout(active.timeout);
    }
    this.activeJobs.delete(id);
    active.reject(error);
  }

  private rejectJobsForWorker(worker: Worker, error: Error) {
    for (const [id, active] of Array.from(this.activeJobs.entries())) {
      if (active.worker === worker) {
        if (active.timeout) {
          clearTimeout(active.timeout);
        }
        this.activeJobs.delete(id);
        active.reject(error);
      }
    }
  }

  private rejectQueuedJob(job: QueuedJob, error: Error) {
    job.reject(error);
    for (const subscriber of job.subscribers) {
      subscriber.reject(error);
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.rejectQueuedJob(job, new WorkerJobCancelledError('Worker pool is shutting down'));
    }

    const terminations: Array<Promise<number>> = [];
    for (const [id, active] of this.activeJobs) {
      if (active.timeout) {
        clearTimeout(active.timeout);
      }
      active.reject(new WorkerJobCancelledError('Worker pool is shutting down'));
      // oxlint-disable-next-line eslint-plugin-unicorn(require-post-message-target-origin)
      active.worker.postMessage({ type: 'cancel', id });
    }

    this.activeJobs.clear();
    for (const worker of this.workers) {
      worker.removeAllListeners();
      terminations.push(worker.terminate());
    }
    this.workers.clear();
    await Promise.allSettled(terminations);
  }
}

let sharedWorkerPool: WorkerPool | null = null;

export function getSharedWorkerPool(): WorkerPool {
  sharedWorkerPool ??= new WorkerPool();
  return sharedWorkerPool;
}

export function resetSharedWorkerPoolForTests(pool: WorkerPool | null = null): void {
  sharedWorkerPool = pool;
}

export async function shutdownSharedWorkerPool(): Promise<void> {
  const pool = sharedWorkerPool;
  sharedWorkerPool = null;
  await pool?.shutdown();
}
