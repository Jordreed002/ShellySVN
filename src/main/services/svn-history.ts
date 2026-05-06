import type { SvnBlameResult, SvnDiffResult, SvnLogResult } from '@shared/types';
import { debug } from '../utils/debug';
import {
  getWorkerBlame,
  getWorkerDiff,
  getWorkerDiffStreaming,
  getWorkerLog,
  getWorkerUrlDiff,
} from './svn-history-worker';

export async function getLog(
  path: string,
  limit = 100,
  startRev?: number,
  endRev?: number,
  useMergeHistory = false,
  workerJobId?: string
): Promise<SvnLogResult> {
  try {
    return workerJobId
      ? getWorkerLog(path, limit, startRev, endRev, useMergeHistory, workerJobId)
      : getWorkerLog(path, limit, startRev, endRev, useMergeHistory);
  } catch (error) {
    debug.error('[SVN] Log error:', error);
    return { entries: [], startRevision: 0, endRevision: 0 };
  }
}

export async function getDiff(
  path: string,
  revision?: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  try {
    return workerJobId ? getWorkerDiff(path, revision, workerJobId) : getWorkerDiff(path, revision);
  } catch (error) {
    debug.error('[SVN] Diff error:', error);
    return { files: [], hasChanges: false, rawDiff: (error as Error).message };
  }
}

export async function getUrlDiff(
  leftUrl: string,
  rightUrl: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  try {
    return workerJobId
      ? getWorkerUrlDiff(leftUrl, rightUrl, workerJobId)
      : getWorkerUrlDiff(leftUrl, rightUrl);
  } catch (error) {
    debug.error('[SVN] URL diff error:', error);
    return { files: [], hasChanges: false, rawDiff: (error as Error).message };
  }
}

export async function getDiffStreaming(
  path: string,
  revision?: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  try {
    return workerJobId
      ? getWorkerDiffStreaming(path, revision, workerJobId)
      : getWorkerDiffStreaming(path, revision);
  } catch (error) {
    debug.error('[SVN] Streaming diff error:', error);
    return { files: [], hasChanges: false, rawDiff: (error as Error).message };
  }
}

export async function getBlame(
  path: string,
  startRevision?: number,
  endRevision?: number,
  workerJobId?: string
): Promise<SvnBlameResult> {
  try {
    return workerJobId
      ? getWorkerBlame(path, startRevision, endRevision, workerJobId)
      : getWorkerBlame(path, startRevision, endRevision);
  } catch (error) {
    debug.error('[SVN] Blame error:', error);
    return { path, lines: [], startRevision: 0, endRevision: 0 };
  }
}
