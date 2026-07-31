/**
 * Does this repository path sit inside a checkout, and if so, what state is it in?
 *
 * This is the gate for every local fact in the browser. `svn ls` describes the
 * server; only `svn status` knows what is on your disk, and it only means
 * anything under a working copy.
 *
 * Three things this is careful about:
 *
 * 1. **"Not a working copy" is an answer, not an error.** In a 51-client
 *    repository it is the normal state. `svn info` throwing E155007 resolves to
 *    `scope: 'repository'` with no error surfaced.
 * 2. **`svn status` is slow and must never block the listing.** It runs in its
 *    own query, keyed off a deferred path so fast navigation coalesces, with
 *    the query's `AbortSignal` forwarded so switching directories cancels the
 *    in-flight scan. `cancelStatus()` aborts it on demand.
 * 3. **Failures are explained, not swallowed.** A locked working copy surfaces
 *    as a `needs-cleanup` problem with the command that clears it, because that
 *    is more useful than "svn status failed".
 */

import { useCallback, useDeferredValue, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SvnExternalsResult,
  SvnInfoResult,
  SvnStatusEntry,
  SvnStatusResult,
} from '@shared/types';

import {
  buildWorkingCopyState,
  deriveProblems,
  indexStatusByPath,
  resolveScope,
} from '../adapters';
import type { RepoProblem, RepoScope, WorkingCopyState } from '../types';
import {
  createLocalToRepoPath,
  describeError,
  isNeedsCleanupError,
  isNotAWorkingCopyError,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_HISTORY_STALE_TIME_MS,
  REPO_BROWSER_INFO_STALE_TIME_MS,
  REPO_BROWSER_STATUS_STALE_TIME_MS,
  urlToRepoPath,
  workingCopyExternalsQueryKey,
  workingCopyHeadQueryKey,
  workingCopyIncomingQueryKey,
  workingCopyInfoQueryKey,
  workingCopyMergeInfoQueryKey,
  workingCopyStatusQueryKey,
  type UnsupportedCapability,
} from './queryKeys';

/** Ceiling on revisions counted for `incomingRevisions`; beyond it we say "N+". */
export const MAX_INCOMING_REVISIONS = 500;

/** What `svn info` told us, or that the path is simply not in a checkout. */
interface WorkingCopyIdentity {
  info: SvnInfoResult;
  /** Repository-relative path of `localPath`, derived from url − repositoryRoot. */
  repoPath: string;
}

export interface UseWorkingCopyForPathOptions {
  /**
   * Merge source for `svn mergeinfo --show-revs eligible`. Subversion cannot
   * guess this — without a source there is no eligible-revision count to give.
   */
  mergeSource?: string | null;
  /** Run `svn status`. Off means the caller has explicitly deferred it. */
  includeStatus?: boolean;
  /** Count revisions on the server not yet in this copy. Costs one `svn log`. */
  includeIncoming?: boolean;
  incomingLimit?: number;
  /** Age at which a lock is called stale, passed to `deriveProblems`. */
  staleLockDays?: number;
  enabled?: boolean;
}

export interface UseWorkingCopyForPathResult {
  /** `'working-copy'` only once we know the path is inside a checkout. */
  scope: RepoScope;
  isWorkingCopy: boolean;
  /** Null until resolved, and whenever the path is not inside a checkout. */
  workingCopy: WorkingCopyState | null;
  /**
   * Repository-relative roots of the checkout containing this path, ready to
   * hand to `useRepoListing`'s `workingCopyRepoPaths`.
   */
  workingCopyRepoPaths: readonly string[];
  /** Status entries keyed by repository-relative path, for `mergeEntries`. */
  statusByPath: Map<string, SvnStatusEntry>;
  problems: RepoProblem[];
  /** Resolution finished and the path is outside every checkout. Expected. */
  notAWorkingCopy: boolean;
  /** `svn info` is still running. */
  isResolving: boolean;
  /** `svn status` is still running — the listing must not wait for this. */
  isStatusPending: boolean;
  /** `svn status` returned early; roll-ups and problems are incomplete. */
  isStatusPartial: boolean;
  /** True when `incomingRevisions` hit `incomingLimit` and is really "N+". */
  isIncomingCapped: boolean;
  /** A real failure — never set for "not a working copy". */
  error: string | null;
  /** False when no merge source was supplied, so the count is 0 by omission. */
  eligibleRevisionsAvailable: boolean;
  /** Capabilities the IPC surface cannot answer for this working copy. */
  unsupported: UnsupportedCapability[];
  /** Abort the in-flight `svn status`. */
  cancelStatus: () => void;
  refetch: () => void;
}

const EMPTY_STATUS_INDEX: Map<string, SvnStatusEntry> = new Map();
const EMPTY_PROBLEMS: RepoProblem[] = [];
const EMPTY_ROOTS: readonly string[] = [];

/**
 * `svn info` does not report the checkout depth, and there is no other IPC
 * call that does, so `WorkingCopyState.depth` is honestly `'unknown'`.
 */
const DEPTH_UNSUPPORTED: UnsupportedCapability = {
  capability: 'working-copy:depth',
  reason:
    'Subversion reports checkout depth only via `svn info --xml`’s <depth> element, which this app’s info parser does not expose. The depth shows as "unknown" rather than being guessed.',
  command: 'svn info --xml',
};

export function useWorkingCopyForPath(
  repoPath: string,
  localPath: string | null | undefined,
  options: UseWorkingCopyForPathOptions = {}
): UseWorkingCopyForPathResult {
  const {
    mergeSource = null,
    includeStatus = true,
    includeIncoming = true,
    incomingLimit = MAX_INCOMING_REVISIONS,
    staleLockDays,
    enabled = true,
  } = options;

  const queryClient = useQueryClient();
  const resolvedLocalPath = localPath ?? '';
  const canResolve = enabled && resolvedLocalPath.length > 0;

  /* ── 1. Identity: is this a working copy at all? ── */

  const infoQuery = useQuery({
    queryKey: workingCopyInfoQueryKey(resolvedLocalPath),
    queryFn: async (): Promise<WorkingCopyIdentity | null> => {
      try {
        const info = await window.api.svn.info(resolvedLocalPath);
        // A path can resolve without being versioned; treat a missing URL the
        // same as "not a working copy" rather than building a half-state.
        if (!info?.url) return null;
        return {
          info,
          repoPath: urlToRepoPath(info.url, info.repositoryRoot) ?? repoPath,
        };
      } catch (error) {
        if (isNotAWorkingCopyError(error)) return null;
        throw error;
      }
    },
    enabled: canResolve,
    staleTime: REPO_BROWSER_INFO_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  const identity = infoQuery.data ?? null;
  const isWorkingCopy = identity !== null;
  const workingCopyRoot = identity?.info.workingCopyRoot ?? resolvedLocalPath;

  /* ── 2. HEAD on the server for this URL ── */

  const headQuery = useQuery({
    queryKey: workingCopyHeadQueryKey(identity?.info.url ?? ''),
    queryFn: async (): Promise<number> => {
      const info = await window.api.svn.infoUrl(identity?.info.url ?? '');
      return info?.revision ?? 0;
    },
    enabled: canResolve && isWorkingCopy,
    staleTime: REPO_BROWSER_INFO_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  const baseRevision = identity?.info.revision ?? 0;
  const headRevision = headQuery.data ?? baseRevision;

  /* ── 3. `svn status` — slow, deferred, cancellable, never blocking ── */

  // Deferring the path means rapid tree navigation collapses into one scan of
  // wherever the user actually stopped, instead of one per directory passed
  // through.
  const deferredStatusPath = useDeferredValue(isWorkingCopy ? workingCopyRoot : '');

  const statusQuery = useQuery({
    queryKey: workingCopyStatusQueryKey(deferredStatusPath),
    queryFn: ({ signal }): Promise<SvnStatusResult> =>
      window.api.svn.status(deferredStatusPath, { signal }),
    enabled: canResolve && includeStatus && deferredStatusPath.length > 0,
    staleTime: REPO_BROWSER_STATUS_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  // `svn:status` resolves with an error field rather than throwing, which is
  // what lets a locked working copy become an explained problem below.
  const statusResult = statusQuery.data;
  const statusFailed = Boolean(statusResult?.error);
  const needsCleanup = isNeedsCleanupError(statusResult?.errorCode, statusResult?.error);
  const usableStatus: SvnStatusResult | undefined = statusFailed ? undefined : statusResult;

  /* ── 4. Eligible revisions — only answerable with a merge source ── */

  const mergeInfoQuery = useQuery({
    queryKey: workingCopyMergeInfoQueryKey(mergeSource ?? '', workingCopyRoot),
    queryFn: async (): Promise<number> => {
      const result = await window.api.svn.mergeInfo(
        mergeSource ?? '',
        workingCopyRoot,
        'eligible'
      );
      return result?.revisions?.length ?? 0;
    },
    enabled: canResolve && isWorkingCopy && Boolean(mergeSource),
    staleTime: REPO_BROWSER_HISTORY_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  /* ── 5. Incoming revisions — `svn log BASE+1:HEAD` on the URL ── */

  const hasIncomingRange = headRevision > baseRevision && baseRevision > 0;

  const incomingQuery = useQuery({
    queryKey: workingCopyIncomingQueryKey(identity?.info.url ?? '', baseRevision, headRevision),
    queryFn: async ({ signal }): Promise<number> => {
      const result = await window.api.svn.log(
        identity?.info.url ?? '',
        incomingLimit,
        headRevision,
        baseRevision + 1,
        false,
        { signal }
      );
      return result?.entries?.length ?? 0;
    },
    enabled: canResolve && isWorkingCopy && includeIncoming && hasIncomingRange,
    staleTime: REPO_BROWSER_INFO_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  const incomingRevisions = hasIncomingRange ? (incomingQuery.data ?? 0) : 0;

  /* ── 6. Externals — needed by `deriveProblems` for floating definitions ── */

  const externalsQuery = useQuery({
    queryKey: workingCopyExternalsQueryKey(workingCopyRoot),
    queryFn: (): Promise<SvnExternalsResult> => window.api.svn.externals.list(workingCopyRoot),
    enabled: canResolve && isWorkingCopy,
    staleTime: REPO_BROWSER_HISTORY_STALE_TIME_MS,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    retry: false,
  });

  /* ── Assemble ── */

  const statusByPath = useMemo(() => {
    if (!identity || !usableStatus) return EMPTY_STATUS_INDEX;
    return indexStatusByPath(
      usableStatus,
      createLocalToRepoPath(workingCopyRoot, identity.repoPath)
    );
  }, [identity, usableStatus, workingCopyRoot]);

  const workingCopy = useMemo<WorkingCopyState | null>(() => {
    if (!identity) return null;
    return buildWorkingCopyState({
      info: identity.info,
      localPath: workingCopyRoot,
      repoPath: identity.repoPath,
      status: usableStatus,
      headRevision,
      incomingRevisions,
      eligibleRevisions: mergeInfoQuery.data ?? 0,
      // No IPC call reports checkout depth — see DEPTH_UNSUPPORTED.
      depth: 'unknown',
    });
  }, [
    identity,
    workingCopyRoot,
    usableStatus,
    headRevision,
    incomingRevisions,
    mergeInfoQuery.data,
  ]);

  const problems = useMemo(() => {
    if (!identity) return EMPTY_PROBLEMS;
    return deriveProblems({
      status: usableStatus,
      externals: externalsQuery.data,
      localPath: workingCopyRoot,
      needsCleanup,
      staleLockDays,
    });
  }, [identity, usableStatus, externalsQuery.data, workingCopyRoot, needsCleanup, staleLockDays]);

  const workingCopyRepoPaths = useMemo(
    () => (identity ? [identity.repoPath] : EMPTY_ROOTS),
    [identity]
  );

  const unsupported = useMemo<UnsupportedCapability[]>(() => {
    if (!identity) return [];
    const gaps: UnsupportedCapability[] = [DEPTH_UNSUPPORTED];
    if (!mergeSource) {
      gaps.push({
        capability: 'working-copy:eligible-revisions',
        reason:
          'Eligible revisions are counted against a specific merge source. Subversion cannot infer one, so no source means no count — not a count of zero.',
        command: `svn mergeinfo --show-revs eligible <source> "${workingCopyRoot}"`,
      });
    }
    return gaps;
  }, [identity, mergeSource, workingCopyRoot]);

  const cancelStatus = useCallback(() => {
    void queryClient.cancelQueries({ queryKey: workingCopyStatusQueryKey(deferredStatusPath) });
  }, [queryClient, deferredStatusPath]);

  const refetch = useCallback(() => {
    void infoQuery.refetch();
    void headQuery.refetch();
    void statusQuery.refetch();
    void externalsQuery.refetch();
    if (mergeSource) void mergeInfoQuery.refetch();
    if (hasIncomingRange) void incomingQuery.refetch();
  }, [
    infoQuery,
    headQuery,
    statusQuery,
    externalsQuery,
    mergeInfoQuery,
    incomingQuery,
    mergeSource,
    hasIncomingRange,
  ]);

  // Only `svn info` failing for a reason other than "not a working copy" is a
  // real error. A failed status, mergeinfo or externals read degrades the view
  // but must not blank a listing that is perfectly valid without them.
  const error = infoQuery.isError ? describeError(infoQuery.error) : null;

  return {
    scope: identity ? resolveScope(repoPath, [identity.repoPath]) : 'repository',
    isWorkingCopy,
    workingCopy,
    workingCopyRepoPaths,
    statusByPath,
    problems,
    notAWorkingCopy: canResolve && infoQuery.isSuccess && identity === null,
    isResolving: infoQuery.isLoading,
    isStatusPending: statusQuery.isFetching,
    isStatusPartial: statusResult?.partial === true || Boolean(statusResult?.parseError),
    isIncomingCapped: incomingRevisions >= incomingLimit,
    error,
    eligibleRevisionsAvailable: Boolean(mergeSource) && mergeInfoQuery.isSuccess,
    unsupported,
    cancelStatus,
    refetch,
  };
}
