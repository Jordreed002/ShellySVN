import type {
  SvnBlameResult,
  SvnDiffResult,
  SvnLogResult,
  SvnLogRequestOptions,
  SvnMergeInfoKind,
  SvnMergeInfoResult,
} from '@shared/types';
import { debug } from '../utils/debug';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { getSvnReadError, SvnCommandError } from '../utils/svn-errors';
import { runSvnText } from './svn-executor';
import { proplist } from './svn-metadata';
import {
  getWorkerBlame,
  getWorkerDiff,
  getWorkerDiffStreaming,
  getWorkerLog,
  getWorkerUrlDiff,
} from './svn-history-worker';

export async function getMergeInfo(
  source: string,
  target: string,
  kind: SvnMergeInfoKind
): Promise<SvnMergeInfoResult> {
  validateSvnTargets([source, target], 'Mergeinfo target');
  if (kind !== 'merged' && kind !== 'eligible') {
    throw new Error('Mergeinfo kind must be merged or eligible');
  }

  const rawOutput = await runSvnText(
    withSvnTargets(['mergeinfo', '--show-revs', kind], [source, target])
  );
  const revisions = Array.from(
    new Set(
      rawOutput
        .split(/\r?\n/)
        .map((line) => /^r(\d+)\s*$/.exec(line.trim())?.[1])
        .filter((revision): revision is string => revision !== undefined)
        .map(Number)
    )
  ).toSorted((a, b) => a - b);
  const propertyResult = await proplist(target, { showInherited: true });
  if (propertyResult.error) {
    throw new SvnCommandError(propertyResult, { command: 'proplist', target });
  }
  const properties = propertyResult.properties
    .filter((property) => property.name === 'svn:mergeinfo')
    .map((property) => ({
      value: property.value,
      inherited: property.inherited === true,
      ...(property.inheritedFrom ? { inheritedFrom: property.inheritedFrom } : {}),
    }));

  return { source, target, kind, revisions, properties, rawOutput };
}

export async function getLog(
  path: string,
  limit = 100,
  startRev?: number,
  endRev?: number,
  useMergeHistory = false,
  workerJobId?: string,
  options: Omit<SvnLogRequestOptions, 'signal'> = {}
): Promise<SvnLogResult> {
  try {
    return await (workerJobId
      ? getWorkerLog(path, limit, startRev, endRev, useMergeHistory, workerJobId, options)
      : getWorkerLog(path, limit, startRev, endRev, useMergeHistory, undefined, options));
  } catch (error) {
    debug.error('[SVN] Log error:', error);
    return {
      entries: [],
      startRevision: 0,
      endRevision: 0,
      ...getSvnReadError(error, { command: 'log', target: path }),
    };
  }
}

export async function getDiff(
  path: string,
  revision?: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  try {
    return await (workerJobId
      ? getWorkerDiff(path, revision, workerJobId)
      : getWorkerDiff(path, revision));
  } catch (error) {
    debug.error('[SVN] Diff error:', error);
    return {
      files: [],
      hasChanges: false,
      rawDiff: (error as Error).message,
      ...getSvnReadError(error, { command: 'diff', target: path }),
    };
  }
}

export async function getUrlDiff(
  leftUrl: string,
  rightUrl: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  try {
    return await (workerJobId
      ? getWorkerUrlDiff(leftUrl, rightUrl, workerJobId)
      : getWorkerUrlDiff(leftUrl, rightUrl));
  } catch (error) {
    debug.error('[SVN] URL diff error:', error);
    return {
      files: [],
      hasChanges: false,
      rawDiff: (error as Error).message,
      ...getSvnReadError(error, { command: 'diff', target: leftUrl }),
    };
  }
}

export async function getDiffStreaming(
  path: string,
  revision?: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  try {
    return await (workerJobId
      ? getWorkerDiffStreaming(path, revision, workerJobId)
      : getWorkerDiffStreaming(path, revision));
  } catch (error) {
    debug.error('[SVN] Streaming diff error:', error);
    return {
      files: [],
      hasChanges: false,
      rawDiff: (error as Error).message,
      ...getSvnReadError(error, { command: 'diff', target: path }),
    };
  }
}

export async function getBlame(
  path: string,
  startRevision?: number,
  endRevision?: number,
  workerJobId?: string
): Promise<SvnBlameResult> {
  try {
    return await (workerJobId
      ? getWorkerBlame(path, startRevision, endRevision, workerJobId)
      : getWorkerBlame(path, startRevision, endRevision));
  } catch (error) {
    debug.error('[SVN] Blame error:', error);
    return {
      path,
      lines: [],
      startRevision: 0,
      endRevision: 0,
      ...getSvnReadError(error, { command: 'blame', target: path }),
    };
  }
}
