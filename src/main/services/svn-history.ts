import type {
  SvnBlameResult,
  SvnDiffResult,
  SvnLogResult,
  SvnLogRequestOptions,
  SvnMergeInfoKind,
  SvnMergeInfoResult,
} from '@shared/types';
import { debug } from '../utils/debug';
import { normalizeRepoUrl } from '../utils/svn-url';
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

/**
 * `svn log -r 1:...` (and any range starting at revision 1) on a repository
 * with zero commits fails with SVN_ERR_FS_NO_SUCH_REVISION instead of
 * returning an empty log. Revision 1 exists in every repository with
 * at least one commit, so this signature identifies r0 repositories exactly.
 * The youngest-revision marker itself is declared on the shared
 * `SvnLogResult` type.
 */
function isEmptyRepositoryLogError(error: unknown, startRevision?: number): boolean {
  if (startRevision === undefined || startRevision > 1) return false;
  const message = error instanceof Error ? error.message : String(error || '');
  return /\bE160006\b/.test(message) && /\bno such revision 1\b/i.test(message);
}

function withYoungestRevision(result: SvnLogResult): SvnLogResult {
  return result.entries.length > 0 ? { ...result, youngestRevision: result.endRevision } : result;
}

export async function getMergeInfo(
  source: string,
  target: string,
  kind: SvnMergeInfoKind
): Promise<SvnMergeInfoResult> {
  validateSvnTargets([source, target], 'Mergeinfo target');
  if (kind !== 'merged' && kind !== 'eligible') {
    throw new Error('Mergeinfo kind must be merged or eligible');
  }

  // Canonical URL targets keep command identity and result identity stable;
  // working-copy paths pass through normalizeRepoUrl untouched.
  const sourceTarget = normalizeRepoUrl(source);
  const destinationTarget = normalizeRepoUrl(target);
  const rawOutput = await runSvnText(
    withSvnTargets(['mergeinfo', '--show-revs', kind], [sourceTarget, destinationTarget])
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
  const propertyResult = await proplist(destinationTarget, { showInherited: true });
  if (propertyResult.error) {
    throw new SvnCommandError(propertyResult, {
      command: 'proplist',
      target: destinationTarget,
    });
  }
  const properties = propertyResult.properties
    .filter((property) => property.name === 'svn:mergeinfo')
    .map((property) => ({
      value: property.value,
      inherited: property.inherited === true,
      ...(property.inheritedFrom ? { inheritedFrom: property.inheritedFrom } : {}),
    }));

  return {
    source: sourceTarget,
    target: destinationTarget,
    kind,
    revisions,
    properties,
    rawOutput,
  };
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
  // Canonicalize URL targets (IDN/IPv6/percent-encoding) so the worker job id
  // (also the join key for concurrent identical requests) and any downstream
  // cache key are stable; working-copy paths pass through untouched.
  const target = normalizeRepoUrl(path);
  try {
    const result = await (workerJobId
      ? getWorkerLog(target, limit, startRev, endRev, useMergeHistory, workerJobId, options)
      : getWorkerLog(target, limit, startRev, endRev, useMergeHistory, undefined, options));
    return withYoungestRevision(result);
  } catch (error) {
    if (isEmptyRepositoryLogError(error, startRev)) {
      // A repository with no commits has no log to show; report an empty,
      // error-free result instead of surfacing E160006 as a failure.
      debug.log('[SVN] Log target is an empty repository (r0):', target);
      return { entries: [], startRevision: 0, endRevision: 0, youngestRevision: 0 };
    }
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
  // Normalize both sides so the worker job id is stable across callers that
  // spell the same repository URL differently (IDN, IPv6, percent-encoding).
  const left = normalizeRepoUrl(leftUrl);
  const right = normalizeRepoUrl(rightUrl);
  try {
    return await (workerJobId
      ? getWorkerUrlDiff(left, right, workerJobId)
      : getWorkerUrlDiff(left, right));
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
