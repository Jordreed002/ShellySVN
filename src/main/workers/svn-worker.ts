import { basename, dirname, isAbsolute, join, normalize } from 'path';
import { readdir, stat } from 'fs/promises';
import { parentPort } from 'worker_threads';

import type { SvnStatusChar } from '@shared/types';
import { runResolvedSvn } from '../services/svn-runner';
import {
  parseSvnBlameXml,
  parseSvnDiff,
  parseSvnLogXml,
  parseSvnStatusXml as parseWorkingCopyStatusXml,
} from '../svn/parsers';
import { parseDiffStreaming } from '../utils/diff-parser';
import { parseSvnStatusEntriesXml } from '../utils/svn-xml';
import type {
  BlamePayload,
  DiffPayload,
  DiffUrlsPayload,
  FolderSizesPayload,
  FsSvnStatusResult,
  LogPayload,
  StatusPayload,
  WorkerJobMessage,
  WorkerParentMessage,
} from './types';

const SVN_STATUS_MAP: Record<string, SvnStatusChar> = {
  normal: ' ',
  added: 'A',
  conflicted: 'C',
  deleted: 'D',
  ignored: 'I',
  modified: 'M',
  replaced: 'R',
  external: 'X',
  unversioned: '?',
  missing: '!',
  obstructed: '~',
  incomplete: '!',
};

const runningControllers = new Map<string, AbortController>();
const cancelledJobs = new Set<string>();

function mapStatus(statusName: string): SvnStatusChar {
  return SVN_STATUS_MAP[statusName] || ' ';
}

function parseSvnStatusXml(xml: string, baseDir: string): FsSvnStatusResult {
  const directStatus: FsSvnStatusResult['directStatus'] = {};
  const allEntries: FsSvnStatusResult['allEntries'] = [];

  for (const entry of parseSvnStatusEntriesXml(xml)) {
    const status = mapStatus(entry.item);
    const fullPath = normalize(isAbsolute(entry.path) ? entry.path : join(baseDir, entry.path));
    const fileName = basename(fullPath);

    allEntries.push({
      status,
      revision: entry.revision,
      author: entry.author,
      fullPath,
    });

    if (normalize(dirname(fullPath)) === normalize(baseDir)) {
      directStatus[fileName] = {
        status,
        revision: entry.revision,
        author: entry.author,
      };
    }
  }

  return { directStatus, allEntries };
}

interface WorkerSvnPayload {
  svnCommand: string;
  context: StatusPayload['context'];
  trustSslFailures?: boolean;
  trustedSslFailures?: string;
  credentials?: { username: string; password: string };
}

async function runSvnXml(
  jobId: string,
  args: string[],
  payload: WorkerSvnPayload,
  cwd: string
): Promise<string> {
  const controller = new AbortController();
  runningControllers.set(jobId, controller);

  if (cancelledJobs.has(jobId)) {
    cancelledJobs.delete(jobId);
    runningControllers.delete(jobId);
    throw new Error('SVN operation cancelled');
  }

  try {
    const result = await runResolvedSvn(args, {
      svnCommand: payload.svnCommand,
      context: payload.context,
      cwd,
      trustSslFailures: payload.trustSslFailures,
      trustedSslFailures: payload.trustedSslFailures,
      credentials: payload.credentials,
      signal: controller.signal,
    });
    return result.stdout;
  } finally {
    runningControllers.delete(jobId);
    cancelledJobs.delete(jobId);
  }
}

async function runDeepStatus(job: WorkerJobMessage<'svn:deepStatus'>): Promise<FsSvnStatusResult> {
  const xml = await runSvnXml(
    job.id,
    ['status', '--xml', '--depth=infinity', job.payload.dirPath],
    job.payload,
    job.payload.dirPath
  );
  return parseSvnStatusXml(xml, job.payload.dirPath);
}

async function runFsStatus(job: WorkerJobMessage<'svn:fsStatus'>): Promise<FsSvnStatusResult> {
  const args = ['status', '--xml'];
  if (job.payload.depth) {
    args.push(`--depth=${job.payload.depth}`);
  }
  args.push(job.payload.dirPath);

  const xml = await runSvnXml(job.id, args, job.payload, job.payload.dirPath);
  return parseSvnStatusXml(xml, job.payload.dirPath);
}

async function runWorkingCopyStatus(job: WorkerJobMessage<'svn:workingCopyStatus'>) {
  const args = ['status', '--xml'];
  if (job.payload.showUpdates) {
    args.push('--show-updates');
  }
  args.push(job.payload.dirPath);

  const xml = await runSvnXml(job.id, args, job.payload, job.payload.dirPath);
  return parseWorkingCopyStatusXml(xml, job.payload.dirPath);
}

function buildDiffArgs(payload: DiffPayload): string[] {
  const args = ['diff'];
  if (payload.revision) {
    args.push('-c', payload.revision);
  }
  args.push(payload.path);
  return args;
}

async function runDiff(job: WorkerJobMessage<'svn:diff'>) {
  const output = await runSvnXml(job.id, buildDiffArgs(job.payload), {
    svnCommand: job.payload.svnCommand,
    context: job.payload.context,
    trustSslFailures: job.payload.trustSslFailures,
    trustedSslFailures: job.payload.trustedSslFailures,
    credentials: job.payload.credentials,
  }, process.cwd());
  return parseSvnDiff(output);
}

async function runDiffStreaming(job: WorkerJobMessage<'svn:diffStreaming'>) {
  const output = await runSvnXml(job.id, buildDiffArgs(job.payload), {
    svnCommand: job.payload.svnCommand,
    context: job.payload.context,
    trustSslFailures: job.payload.trustSslFailures,
    trustedSslFailures: job.payload.trustedSslFailures,
    credentials: job.payload.credentials,
  }, process.cwd());

  if (output.includes('Cannot display: file marked as a binary type')) {
    return {
      files: [],
      hasChanges: true,
      isBinary: true,
      rawDiff: output,
    };
  }

  return parseDiffStreaming(output);
}

async function runDiffUrls(job: WorkerJobMessage<'svn:diffUrls'>) {
  const payload: DiffUrlsPayload = job.payload;
  const output = await runSvnXml(job.id, ['diff', payload.leftUrl, payload.rightUrl], {
    svnCommand: payload.svnCommand,
    context: payload.context,
    trustSslFailures: payload.trustSslFailures,
    trustedSslFailures: payload.trustedSslFailures,
    credentials: payload.credentials,
  }, process.cwd());
  return parseSvnDiff(output);
}

async function runLog(job: WorkerJobMessage<'svn:log'>) {
  const payload: LogPayload = job.payload;
  const args = ['log', '--xml', '-l', String(payload.limit)];
  if (payload.startRev !== undefined && payload.endRev !== undefined) {
    args.push('-r', `${payload.startRev}:${payload.endRev}`);
  }
  if (payload.useMergeHistory) {
    args.push('--use-merge-history');
  }
  args.push(payload.path);

  const xml = await runSvnXml(job.id, args, {
    svnCommand: payload.svnCommand,
    context: payload.context,
    trustSslFailures: payload.trustSslFailures,
    trustedSslFailures: payload.trustedSslFailures,
    credentials: payload.credentials,
  }, process.cwd());
  return parseSvnLogXml(xml);
}

async function runBlame(job: WorkerJobMessage<'svn:blame'>) {
  const payload: BlamePayload = job.payload;
  const args = ['blame', '--xml', '-v'];
  if (payload.startRevision !== undefined && payload.endRevision !== undefined) {
    args.push('-r', `${payload.startRevision}:${payload.endRevision}`);
  }
  args.push(payload.path);

  const xml = await runSvnXml(job.id, args, {
    svnCommand: payload.svnCommand,
    context: payload.context,
    trustSslFailures: payload.trustSslFailures,
    trustedSslFailures: payload.trustedSslFailures,
    credentials: payload.credentials,
  }, process.cwd());
  return parseSvnBlameXml(xml, payload.path);
}

async function calculateFolderSize(folderPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await readdir(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.svn') {
        continue;
      }

      const fullPath = join(folderPath, entry.name);

      try {
        if (entry.isDirectory()) {
          totalSize += await calculateFolderSize(fullPath);
        } else if (entry.isFile()) {
          const stats = await stat(fullPath);
          totalSize += stats.size;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return 0;
  }

  return totalSize;
}

async function runFolderSizes(job: WorkerJobMessage<'fs:folderSizes'>) {
  const payload: FolderSizesPayload = job.payload;
  const results: Record<string, number> = {};

  for (const folderPath of payload.folderPaths) {
    results[folderPath] = await calculateFolderSize(folderPath);
  }

  return results;
}

function cancelJob(id: string) {
  cancelledJobs.add(id);
  const controller = runningControllers.get(id);
  if (controller) {
    controller.abort();
  }
}

parentPort?.on('message', (message: WorkerParentMessage) => {
  if ('type' in message && message.type === 'cancel') {
    cancelJob(message.id);
    return;
  }

  void (async () => {
    try {
      if (message.name === 'svn:deepStatus') {
        const result = await runDeepStatus(message as WorkerJobMessage<'svn:deepStatus'>);
        parentPort?.postMessage({ type: 'result', id: message.id, result });
        return;
      }

      if (message.name === 'fs:folderSizes') {
        const result = await runFolderSizes(message as WorkerJobMessage<'fs:folderSizes'>);
        parentPort?.postMessage({ type: 'result', id: message.id, result });
        return;
      }

      if (message.name === 'svn:fsStatus') {
        const result = await runFsStatus(message as WorkerJobMessage<'svn:fsStatus'>);
        parentPort?.postMessage({ type: 'result', id: message.id, result });
        return;
      }

      if (message.name !== 'svn:workingCopyStatus') {
        if (message.name === 'svn:diff') {
          const result = await runDiff(message as WorkerJobMessage<'svn:diff'>);
          parentPort?.postMessage({ type: 'result', id: message.id, result });
          return;
        }

        if (message.name === 'svn:diffStreaming') {
          const result = await runDiffStreaming(message as WorkerJobMessage<'svn:diffStreaming'>);
          parentPort?.postMessage({ type: 'result', id: message.id, result });
          return;
        }

        if (message.name === 'svn:diffUrls') {
          const result = await runDiffUrls(message as WorkerJobMessage<'svn:diffUrls'>);
          parentPort?.postMessage({ type: 'result', id: message.id, result });
          return;
        }

        if (message.name === 'svn:log') {
          const result = await runLog(message as WorkerJobMessage<'svn:log'>);
          parentPort?.postMessage({ type: 'result', id: message.id, result });
          return;
        }

        if (message.name === 'svn:blame') {
          const result = await runBlame(message as WorkerJobMessage<'svn:blame'>);
          parentPort?.postMessage({ type: 'result', id: message.id, result });
          return;
        }

        throw new Error(`Unsupported worker job: ${message.name}`);
      }

      const result = await runWorkingCopyStatus(
        message as WorkerJobMessage<'svn:workingCopyStatus'>
      );
      parentPort?.postMessage({ type: 'result', id: message.id, result });
    } catch (error) {
      parentPort?.postMessage({
        type: 'error',
        id: message.id,
        error: error instanceof Error ? error.message : String(error || ''),
      });
    }
  })();
});
