import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkerJobCancelledError, WorkerPool, WorkerQueueFullError } from '../WorkerPool';

let tempDir: string;
let workerScript: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'shellysvn-worker-pool-test-'));
  workerScript = join(tempDir, 'worker.cjs');
  await writeFile(
    workerScript,
    `
const { parentPort } = require('worker_threads');
const timers = new Map();

parentPort.on('message', (message) => {
  if (message.type === 'cancel') {
    const timer = timers.get(message.id);
    if (timer) clearTimeout(timer);
    timers.delete(message.id);
    parentPort.postMessage({ type: 'error', id: message.id, error: 'cancelled' });
    return;
  }

  const delay = message.payload.dirPath.endsWith('/shutdown-active')
    ? 5000
    : message.payload.dirPath.endsWith('/a')
      ? 250
      : 0;
  if (message.payload.dirPath.endsWith('/progress')) {
    parentPort.postMessage({
      type: 'progress',
      id: message.id,
      progress: {
        channel: 'svn:operation:progress',
        payload: { operationId: message.id, phase: 'running' },
      },
    });
  }
  const timer = setTimeout(() => {
    timers.delete(message.id);
    parentPort.postMessage({
      type: 'result',
      id: message.id,
      result: { directStatus: {}, allEntries: [{ status: 'M', fullPath: message.payload.dirPath + '/file.txt' }] },
    });
  }, delay);
  timers.set(message.id, timer);
});
`
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('WorkerPool', () => {
  it('limits concurrent jobs and starts queued jobs when workers free up', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const first = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'first' }
    );
    const second = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'second' }
    );

    expect(pool.getStateForTests()).toMatchObject({
      activeCount: 1,
      queuedCount: 1,
    });

    await expect(first).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/a/file.txt' })],
    });
    await expect(second).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/b/file.txt' })],
    });
  });

  it('cancels queued jobs without starting a worker', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const first = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'first' }
    );
    const second = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'second' }
    );

    expect(pool.cancel('second')).toBe(true);
    await expect(second).rejects.toBeInstanceOf(WorkerJobCancelledError);
    await expect(first).resolves.toMatchObject({ allEntries: expect.any(Array) });
  });

  it('deduplicates queued jobs by id and keeps the newest payload', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const first = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'first' }
    );
    const superseded = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'duplicate' }
    );
    const newest = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/c', svnCommand: 'svn', context: {} },
      { id: 'duplicate' }
    );

    await expect(superseded).rejects.toBeInstanceOf(WorkerJobCancelledError);
    await expect(first).resolves.toMatchObject({ allEntries: expect.any(Array) });
    await expect(newest).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/c/file.txt' })],
    });
  });

  it('lets duplicate callers join an active idempotent job', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const first = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'shared-active' }
    );
    const duplicate = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'shared-active' }
    );

    expect(pool.getStateForTests()).toMatchObject({
      activeCount: 1,
      queuedCount: 0,
      joinedSubscriberCount: 1,
    });
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      expect.objectContaining({
        allEntries: [expect.objectContaining({ fullPath: '/repo/a/file.txt' })],
      }),
      expect.objectContaining({
        allEntries: [expect.objectContaining({ fullPath: '/repo/a/file.txt' })],
      }),
    ]);
  });

  it('does not join jobs whose payloads differ despite sharing an id', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const first = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'colliding-id' }
    );
    const different = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'colliding-id' }
    );

    await expect(different).rejects.toThrow('Worker job is already running');
    await expect(first).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/a/file.txt' })],
    });
  });

  it('lets duplicate callers join a queued idempotent job', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const active = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'active' }
    );
    const queued = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'shared-queued' }
    );
    const duplicate = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'shared-queued' }
    );

    expect(pool.getStateForTests()).toMatchObject({ activeCount: 1, queuedCount: 1 });
    await active;
    await expect(Promise.all([queued, duplicate])).resolves.toEqual([
      expect.objectContaining({
        allEntries: [expect.objectContaining({ fullPath: '/repo/b/file.txt' })],
      }),
      expect.objectContaining({
        allEntries: [expect.objectContaining({ fullPath: '/repo/b/file.txt' })],
      }),
    ]);
  });

  it('rejects every caller joined to a failed active job', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const first = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'shared-timeout', timeoutMs: 1 }
    );
    const duplicate = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'shared-timeout', timeoutMs: 1 }
    );

    const results = await Promise.allSettled([first, duplicate]);
    expect(results).toEqual([
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ message: expect.stringContaining('timed out') }),
      }),
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ message: expect.stringContaining('timed out') }),
      }),
    ]);
  });

  it('rejects new jobs when the queue is full', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, maxQueuedJobs: 1, workerScript });

    const active = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'active' }
    );
    const queued = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'queued' }
    );
    const rejected = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/c', svnCommand: 'svn', context: {} },
      { id: 'rejected' }
    );

    await expect(rejected).rejects.toBeInstanceOf(WorkerQueueFullError);
    await expect(active).resolves.toMatchObject({ allEntries: expect.any(Array) });
    await expect(queued).resolves.toMatchObject({ allEntries: expect.any(Array) });
  });

  it('forwards cancellation to active jobs', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const active = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/shutdown-active', svnCommand: 'svn', context: {} },
      { id: 'active' }
    );

    expect(pool.cancel('active')).toBe(true);
    await expect(active).rejects.toThrow('cancelled');
    expect(pool.getStateForTests()).toMatchObject({ activeCount: 0, queuedCount: 0 });
  });

  it('runs interactive jobs before queued background jobs', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const first = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'first', priority: 'background' }
    );
    const background = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'background', priority: 'background' }
    );
    const interactive = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/c', svnCommand: 'svn', context: {} },
      { id: 'interactive', priority: 'interactive' }
    );

    await expect(first).resolves.toMatchObject({ allEntries: expect.any(Array) });
    await expect(interactive).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/c/file.txt' })],
    });
    await expect(background).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/b/file.txt' })],
    });
  });

  it('ages queued background work ahead of newer interactive work', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const pool = new WorkerPool({ maxWorkers: 1, workerScript, backgroundAgingMs: 100 });

    const active = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'active', priority: 'interactive' }
    );
    const background = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'aged-background', priority: 'background' }
    );

    now.mockReturnValue(1_200);
    const interactive = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/c', svnCommand: 'svn', context: {} },
      { id: 'new-interactive', priority: 'interactive' }
    );

    expect(pool.getStateForTests().queuedIds).toEqual(['aged-background', 'new-interactive']);
    now.mockRestore();
    await Promise.all([active, background, interactive]);
  });

  it('forwards worker progress messages without settling the job', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });
    const onProgress = vi.fn();

    const result = await pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/progress', svnCommand: 'svn', context: {} },
      { id: 'progress-job', onProgress }
    );

    expect(onProgress).toHaveBeenCalledWith({
      channel: 'svn:operation:progress',
      payload: { operationId: 'progress-job', phase: 'running' },
    });
    expect(result).toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/progress/file.txt' })],
    });
  });

  it('times out active jobs', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const job = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'slow', timeoutMs: 1 }
    );

    await expect(job).rejects.toThrow('Worker job timed out');
    expect(pool.getStateForTests()).toMatchObject({ activeCount: 0, queuedCount: 0 });
  });

  it('uses a fresh worker after a timed-out job', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const timedOut = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'timed-out', timeoutMs: 1 }
    );

    await expect(timedOut).rejects.toThrow('Worker job timed out');

    await expect(
      pool.run(
        'svn:deepStatus',
        { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
        { id: 'after-timeout' }
      )
    ).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/b/file.txt' })],
    });
  });

  it('rejects jobs when a worker crashes', async () => {
    const crashWorkerScript = join(tempDir, 'crash-worker.cjs');
    await writeFile(
      crashWorkerScript,
      `
process.exit(3);
`
    );
    const pool = new WorkerPool({ maxWorkers: 1, workerScript: crashWorkerScript });

    const job = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'crash' }
    );

    await expect(job).rejects.toThrow('Worker exited with code 3');
  });

  it('rejects jobs when a worker exits cleanly but unexpectedly', async () => {
    const exitWorkerScript = join(tempDir, 'clean-exit-worker.cjs');
    await writeFile(exitWorkerScript, 'process.exit(0);');
    const pool = new WorkerPool({ maxWorkers: 1, workerScript: exitWorkerScript });

    await expect(
      pool.run(
        'svn:deepStatus',
        { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
        { id: 'clean-exit' }
      )
    ).rejects.toThrow('Worker exited with code 0');
    expect(pool.getStateForTests()).toMatchObject({ activeCount: 0, workerCount: 0 });
  });

  it('removes a failed worker before scheduling queued work on its replacement', async () => {
    const recoverableWorkerScript = join(tempDir, 'recoverable-worker.cjs');
    await writeFile(
      recoverableWorkerScript,
      `
const { parentPort } = require('worker_threads');
parentPort.on('message', (message) => {
  if (message.payload.dirPath.endsWith('/crash')) {
    throw new Error('worker crash');
  }
  parentPort.postMessage({
    type: 'result',
    id: message.id,
    result: {
      directStatus: {},
      allEntries: [{ status: 'M', fullPath: message.payload.dirPath + '/file.txt' }],
    },
  });
});
`
    );
    const pool = new WorkerPool({ maxWorkers: 1, workerScript: recoverableWorkerScript });

    const crashed = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/crash', svnCommand: 'svn', context: {} },
      { id: 'crash' }
    );
    const queued = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/after-crash', svnCommand: 'svn', context: {} },
      { id: 'after-crash' }
    );

    await expect(crashed).rejects.toThrow('worker crash');
    await expect(queued).resolves.toMatchObject({
      allEntries: [expect.objectContaining({ fullPath: '/repo/after-crash/file.txt' })],
    });
  });

  it('rejects active and queued jobs during shutdown', async () => {
    const pool = new WorkerPool({ maxWorkers: 1, workerScript });

    const active = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/a', svnCommand: 'svn', context: {} },
      { id: 'active' }
    );
    const queued = pool.run(
      'svn:deepStatus',
      { dirPath: '/repo/b', svnCommand: 'svn', context: {} },
      { id: 'queued' }
    );

    const activeExpectation = expect(active).rejects.toBeInstanceOf(WorkerJobCancelledError);
    const queuedExpectation = expect(queued).rejects.toBeInstanceOf(WorkerJobCancelledError);

    await pool.shutdown();
    await activeExpectation;
    await queuedExpectation;
    expect(pool.getStateForTests()).toMatchObject({ activeCount: 0, queuedCount: 0 });
  });
});
