/**
 * The renderer's one registry of React Query keys.
 *
 * Before this module, every key was an inline literal next to its `useQuery`,
 * which worked until two facts about a repository could change underneath the
 * cache: `svn relocate` re-points a working copy at a new repository URL, and
 * `svn switch` re-points it at a different directory of the same repository.
 * Queries keyed by the *old* URL then kept serving stale listings, logs and
 * branch lists indefinitely, because nothing knew which literals embedded a
 * URL and which embedded a local path.
 *
 * The registry fixes that by making the two coordinates explicit:
 *
 *  - **URL-keyed families** (`svn:info` on a URL, `repo:list`, `svn:tree`,
 *    `branches`, `svn:list:*`, the `repo-browser` feature root) describe a
 *    location on a server. When that location is relocated or switched away
 *    from, they are *dropped* — `removeQueries` — because no future read can
 *    legitimately repopulate them.
 *  - **Working-copy-path-keyed families** (`svn:status`, `svn:log` on a path,
 *    the `fs:*` directory reads, …) describe a directory on disk. After
 *    relocate/switch the same path holds new content, so they are *invalidated*
 *    and refetched.
 *
 * {@link resetRepositoryQueries} is the one entry point for that rule and runs
 * on every successful relocate/switch.
 *
 * The factories reproduce the literal arrays the app already used, verbatim, so
 * existing cache entries stay valid — this is a registry, not a migration.
 */

import type { QueryClient } from '@tanstack/react-query';

/* ────────────────────────────── key families ─────────────────────────────── */

/**
 * `svn info` — keyed by either a working-copy path or a repository URL,
 * whichever the caller asked about.
 */
export function svnInfo(target: string) {
  return ['svn:info', target] as const;
}

/** `svn log` for a local path; `limit` distinguishes the RevisionGraph read. */
export function svnLog(path: string, limit?: number) {
  return limit === undefined ? (['svn:log', path] as const) : (['svn:log', path, limit] as const);
}

/** `svn status` — the bare key doubles as the family-wide invalidation prefix. */
export function svnStatus(path?: string) {
  return path === undefined ? (['svn:status'] as const) : (['svn:status', path] as const);
}

/** `svn diff` of one local path against BASE. */
export function svnDiff(path: string) {
  return ['svn:diff', path] as const;
}

/**
 * Lazy tree loader's cached `svn list` tree, keyed by the root URL (plus the
 * credential id, so switching auth is not a cache hit).
 */
export function svnTree(rootUrl: string, credentialId?: string) {
  return ['svn:tree', rootUrl, credentialId] as const;
}

/** Last-changed revision per child of a working-copy directory. */
export function svnChildCommits(path?: string) {
  return path === undefined
    ? (['svn:childCommits'] as const)
    : (['svn:childCommits', path] as const);
}

export function svnShelveList(workingCopyPath: string) {
  return ['svn:shelve:list', workingCopyPath] as const;
}

export function svnChangelistList(path: string) {
  return ['svn:changelist:list', path] as const;
}

export function svnLockList(workingCopyPath: string) {
  return ['svn:lockList', workingCopyPath] as const;
}

export function svnLockInfo(path: string) {
  return ['svn:lockInfo', path] as const;
}

export function svnWorkingCopyUpgradeStatus(path: string) {
  return ['svn:workingCopyUpgradeStatus', path] as const;
}

export function svnWorkingCopyProblems(path: string) {
  return ['svn:working-copy-problems', path] as const;
}

/**
 * `svn list` reads the file-explorer performs through its persistent cache —
 * the same shape `features/files/authQueryKeys.ts` builds inline.
 */
export function svnList(
  scope: 'online' | 'remote',
  url: string,
  authPresence: 'stored' | 'anonymous'
) {
  return [`svn:list:${scope}`, url, authPresence] as const;
}

/** Repository-level listing behind the classic repository browser. */
export function repoList(url: string) {
  return ['repo:list', url] as const;
}

/** Shelves of a working copy, as the repository-browser view reads them. */
export function repoBrowserShelves(localPath: string | null) {
  return ['repo-browser:shelves', localPath] as const;
}

/** Stored credentials for a repository root / authentication realm. */
export function authSession(url: string) {
  return ['auth', url] as const;
}

/** Branch/tag candidates under a branch root URL. */
export function branches(branchRootUrl: string) {
  return ['branches', branchRootUrl] as const;
}

/** `svn --version` & friends; per working copy, or the family-wide prefix. */
export function diagnostics(path?: string) {
  return path === undefined ? (['diagnostics'] as const) : (['diagnostics', path] as const);
}

export function workingCopyHealth(path: string) {
  return ['working-copy-health', path] as const;
}

/* ─────────────────────────── filesystem families ─────────────────────────── */

export function fsListDirectory(path?: string) {
  return path === undefined
    ? (['fs:listDirectory'] as const)
    : (['fs:listDirectory', path] as const);
}

export function fsGetStatus(path: string) {
  return ['fs:getStatus', path] as const;
}

export function fsGetDeepStatus(path: string) {
  return ['fs:getDeepStatus', path] as const;
}

export function fsGetDirectoryMetadata(path: string) {
  return ['fs:getDirectoryMetadata', path] as const;
}

export function fsIsVersioned(path: string) {
  return ['fs:isVersioned', path] as const;
}

/* ─────────────────────────── app-global families ─────────────────────────── */

/** What the bundled `svn` binary can do — not tied to any one repository. */
export function svnCapabilities() {
  return ['svn:capabilities'] as const;
}

export function svnCommandTimeline() {
  return ['svn-command-timeline'] as const;
}

export function onboarding() {
  return ['onboarding'] as const;
}

export function appHomePath() {
  return ['app:homePath'] as const;
}

export function aiProviders() {
  return ['ai:providers'] as const;
}

export function aiRepositoryProfile(workingCopyPath: string) {
  return ['ai:repository-profile', workingCopyPath] as const;
}

/* ─────────────────────── prefix/segment predicates ───────────────────────── */

/** Slash-style, trailing-separator-free form used for all prefix comparison. */
function normaliseCacheSegment(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Compare a key segment with a URL or path prefix.
 *
 * Both sides are normalised (backslashes to slashes, trailing separators
 * trimmed) so a Windows key matches its macOS-shaped twin, and a segment
 * counts as touching the prefix when it *is* the prefix or lives underneath
 * it (`…/trunk` under `…`, `wc/sub` under `wc`).
 */
export function segmentTouchesPrefix(segment: string, prefix: string): boolean {
  const target = normaliseCacheSegment(segment);
  const root = normaliseCacheSegment(prefix);
  if (root === '') return false;
  return target === root || target.startsWith(`${root}/`);
}

/** Does any string segment of a query key touch the given URL or path? */
export function keyTouchesPrefix(queryKey: readonly unknown[], prefix: string): boolean {
  return queryKey.some(
    (segment) => typeof segment === 'string' && segmentTouchesPrefix(segment, prefix)
  );
}

/**
 * Scopes whose first coordinate is a working-copy path — used to tell "this
 * repository's reads failed" from an app-global query that happens to error.
 */
const PATH_KEYED_SCOPES: ReadonlySet<string> = new Set(
  [
    svnStatus(),
    svnLog(''),
    svnDiff(''),
    svnInfo(''),
    svnChildCommits(),
    svnShelveList(''),
    svnChangelistList(''),
    svnLockList(''),
    svnLockInfo(''),
    svnWorkingCopyUpgradeStatus(''),
    svnWorkingCopyProblems(''),
    repoBrowserShelves(''),
    aiRepositoryProfile(''),
    diagnostics(),
    workingCopyHealth(''),
    fsListDirectory(),
    fsGetStatus(''),
    fsGetDeepStatus(''),
    fsGetDirectoryMetadata(''),
    fsIsVersioned(''),
  ].map((key) => String(key[0]))
);

/** True when the scope's queries are keyed by a working-copy path. */
export function isPathKeyedScope(scope: unknown): boolean {
  return typeof scope === 'string' && PATH_KEYED_SCOPES.has(scope);
}

/**
 * A failed path-keyed query about this working copy — the predicate behind the
 * status bar's error cell and generic retry affordances.
 */
export function isFailedWorkingCopyQuery(
  queryKey: readonly unknown[],
  workingCopyPath: string,
  status: string
): boolean {
  return (
    status === 'error' &&
    isPathKeyedScope(queryKey[0]) &&
    keyTouchesPrefix(queryKey, workingCopyPath)
  );
}

/* ─────────────────────────── the reset entry point ───────────────────────── */

/** The QueryClient surface {@link resetRepositoryQueries} needs — easy to fake in tests. */
export interface RepositoryCacheClient {
  removeQueries: (filters: {
    predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
  }) => Promise<unknown> | unknown;
  invalidateQueries: (filters: {
    predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
  }) => Promise<unknown> | unknown;
}

export interface RepositoryCacheReset {
  /**
   * The repository URL (or branch URL) a working copy no longer points at.
   * Every query whose key touches this URL is dropped from the cache.
   */
  previousRepoUrl?: string | null;
  /**
   * The working copy that was relocated/switched. Path-keyed queries touching
   * it are invalidated, so mounted views refetch with the new reality.
   */
  workingCopyPath?: string | null;
}

/**
 * Reset the query caches after a successful `svn relocate` or `svn switch`.
 *
 * URL-keyed queries are removed: their key coordinates no longer exist, and a
 * stale entry served from the old URL is precisely the bug this prevents.
 * Path-keyed queries are invalidated: the path is still the path, but its
 * content now belongs to a different repository location and must be re-read.
 */
export function resetRepositoryQueries(
  queryClient: RepositoryCacheClient | Pick<QueryClient, 'removeQueries' | 'invalidateQueries'>,
  reset: RepositoryCacheReset
): void {
  const { previousRepoUrl, workingCopyPath } = reset;

  if (previousRepoUrl && previousRepoUrl.trim() !== '') {
    void queryClient.removeQueries({
      predicate: ({ queryKey }) => keyTouchesPrefix(queryKey, previousRepoUrl),
    });
  }

  if (workingCopyPath && workingCopyPath.trim() !== '') {
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) => keyTouchesPrefix(queryKey, workingCopyPath),
    });
  }
}
