/**
 * `svn list` for one directory, mapped to `RepoEntry[]`.
 *
 * Reuses the route's existing conventions rather than inventing new ones:
 * the same query key (`getRepoBrowserListQueryKey`), the same offline cache
 * (`readCachedList`), the same stale time and the same auth-error test.
 *
 * The one rule from the spec is enforced by delegation: `resolveScope` decides
 * whether this directory is inside a checkout, and `mergeEntries` refuses to
 * attach a single local fact when it is not.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SvnListResult, SvnStatusEntry } from '@shared/types';

import { readCachedList } from '@renderer/utils/cachedSvnRead';

import { mergeEntries, resolveScope } from '../adapters';
import type { LocalPresence, PegRevision, RepoEntry, RepoScope } from '../types';
import {
  describeError,
  getRepoBrowserListQueryKey,
  isRepoBrowserAuthError,
  pegToRevisionArg,
  REPO_BROWSER_GC_TIME_MS,
  REPO_BROWSER_LIST_STALE_TIME_MS,
  toRepoRelativeEntries,
  type RepoBrowserCredentials,
} from './queryKeys';

/**
 * Depths the offline cache can key. `svn list` also accepts `files`, but
 * `readCachedList` does not, and an uncached listing path is not worth the
 * inconsistency.
 */
export type RepoListDepth = 'empty' | 'immediates' | 'infinity';

export interface UseRepoListingOptions {
  /** Repository-relative path of the directory being listed. `''` is the root. */
  repoPath?: string;
  credentials?: RepoBrowserCredentials | null;
  /** Repository-relative roots of known working copies. Gates every local fact. */
  workingCopyRepoPaths?: readonly string[];
  /** Status entries keyed by repository-relative path, from `useWorkingCopyForPath`. */
  statusByPath?: Map<string, SvnStatusEntry>;
  /** Paths carrying `svn:externals`, keyed by repository-relative path. */
  externalPaths?: Map<string, { pegged: boolean }>;
  /** Repository-relative paths present on disk, with how completely. */
  presenceByPath?: Map<string, LocalPresence>;
  depth?: RepoListDepth;
  enabled?: boolean;
  staleTime?: number;
  /** Injection seam for tests and the E2E runtime override. */
  listFn?: (
    url: string,
    revision: string,
    depth: RepoListDepth,
    credentials: RepoBrowserCredentials | undefined
  ) => Promise<SvnListResult>;
}

export interface UseRepoListingResult {
  entries: RepoEntry[];
  /** Whether local status may be shown at all for this directory. */
  scope: RepoScope;
  /** How many entries the server reported, before any client-side filtering. */
  totalCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  /** Authentication is required — the route should prompt; not a hard failure. */
  needsAuth: boolean;
  /** SVN returned a truncated listing; the directory holds more than this. */
  partial: boolean;
  /** The live read failed and these entries came from the offline cache. */
  fromCache: boolean;
  cachedAt: number | null;
  cacheAgeMs: number;
  refetch: () => void;
}

const NO_STATUS: undefined = undefined;

export function useRepoListing(
  url: string,
  peg: PegRevision,
  options: UseRepoListingOptions = {}
): UseRepoListingResult {
  const {
    repoPath = '',
    credentials = null,
    workingCopyRepoPaths,
    statusByPath = NO_STATUS,
    externalPaths,
    presenceByPath,
    depth = 'immediates',
    enabled = true,
    staleTime = REPO_BROWSER_LIST_STALE_TIME_MS,
    listFn,
  } = options;

  const revision = useMemo(() => pegToRevisionArg(peg), [peg]);
  const queryKey = useMemo(
    () => getRepoBrowserListQueryKey(url, revision, credentials),
    [url, revision, credentials]
  );

  const query = useQuery({
    queryKey,
    // `svn list` is the one read with no `CancellableRequestOptions` on the IPC
    // surface, so there is no signal to forward here.
    queryFn: () =>
      readCachedList(url, revision, depth, credentials?.username ?? '', () =>
        listFn
          ? listFn(url, revision, depth, credentials ?? undefined)
          : window.api.svn.list(url, revision, depth, credentials ?? undefined)
      ),
    enabled: enabled && url.length > 0,
    staleTime,
    gcTime: REPO_BROWSER_GC_TIME_MS,
    // Matches the existing route: an auth failure must surface immediately
    // rather than being retried three times against a server that will refuse.
    retry: false,
  });

  const scope = useMemo(
    () => resolveScope(repoPath, workingCopyRepoPaths ?? []),
    [repoPath, workingCopyRepoPaths]
  );

  const listing = query.data?.data;

  const entries = useMemo(() => {
    if (!listing) return [];
    return mergeEntries({
      entries: toRepoRelativeEntries(listing.entries, repoPath),
      repoPath,
      scope,
      statusByPath,
      externalPaths,
      presenceByPath,
    });
  }, [listing, repoPath, scope, statusByPath, externalPaths, presenceByPath]);

  const error = describeError(query.error);

  return {
    entries,
    scope,
    totalCount: listing?.entries.length ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: error && !isRepoBrowserAuthError(query.error) ? error : null,
    needsAuth: isRepoBrowserAuthError(query.error),
    partial: listing?.partial === true,
    fromCache: query.data?.source === 'cache',
    cachedAt: query.data?.cachedAt ?? null,
    cacheAgeMs: query.data?.age ?? 0,
    refetch: () => {
      void query.refetch();
    },
  };
}
