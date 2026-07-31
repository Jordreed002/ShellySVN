import type { SvnInfoResult, SvnRepoEntry, SvnStatusEntry, SvnStatusResult } from '@shared/types';

import type {
  LocalPresence,
  RepoEntry,
  RepoRollup,
  RepoScope,
  RepoStatusCode,
  WorkingCopyState,
} from './types';

export { deriveProblems } from './problemDerivation';

/**
 * Mapping between what the SVN IPC layer returns and what the browser renders.
 *
 * These are pure so the interesting rules — above all "local status only exists
 * inside a working copy" — are testable without an Electron main process.
 */

/** Status characters we render. Anything else is treated as unremarkable. */
const RENDERABLE_STATUS = new Set<RepoStatusCode>([
  'M',
  'A',
  'D',
  'C',
  'R',
  'X',
  '?',
  'I',
  '!',
  '~',
]);

function toStatusCode(value: string | undefined): RepoStatusCode | undefined {
  if (!value) return undefined;
  const code = value as RepoStatusCode;
  return RENDERABLE_STATUS.has(code) ? code : undefined;
}

/**
 * Whether a repository path sits inside one of the working copies we know about.
 *
 * This is the gate for every local fact on screen. `svn ls` can describe any
 * path on the server; `svn status` only means something under a checkout.
 */
export function resolveScope(repoPath: string, workingCopyRepoPaths: readonly string[]): RepoScope {
  return workingCopyRepoPaths.some((root) => containsPath(root, repoPath))
    ? 'working-copy'
    : 'repository';
}

/**
 * Does `root` contain `candidate`, treating both as repository-relative paths?
 *
 * Compares on segment boundaries, because a prefix test is wrong in exactly the
 * case a monorepo makes common: `clients/acme` must not be judged to contain
 * `clients/acme-corp/website`. A `root` of `''` is the repository root and so
 * contains everything.
 */
export function containsPath(root: string, candidate: string): boolean {
  if (root === '') return true;
  return candidate === root || candidate.startsWith(`${root}/`);
}

/**
 * Which repository paths have something on disk, given the checkouts we know of.
 *
 * This is how the browser marks the *exception*. In a repository holding dozens
 * of clients, "not checked out" is the normal state, and labelling it would be
 * noise; so a path with nothing beneath it is simply absent from this map.
 *
 *   `full`   — this path is a checkout root.
 *   `sparse` — a checkout lives somewhere below this path, so part of the
 *              subtree is on disk and part is not.
 *
 * Deliberately derived from the checkout list alone, not from a listing: the
 * result is needed as an *input* to building the entries it annotates. Paths
 * *inside* a checkout are omitted because there the answer is `svn status`,
 * which is both more specific and more useful.
 */
export function presenceFromCheckouts(
  checkoutRepoPaths: readonly string[]
): Map<string, LocalPresence> {
  const presence = new Map<string, LocalPresence>();

  // Checkout roots first, so `full` always beats the `sparse` below.
  for (const path of checkoutRepoPaths) {
    // A checkout of the whole repository has no root to mark — every path is
    // inside it, and `resolveScope` reports that far more directly.
    if (path) presence.set(path, 'full');
  }

  for (const path of checkoutRepoPaths) {
    const segments = path.split('/').filter(Boolean);
    // Every ancestor except the path itself and the repository root.
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = segments.slice(0, depth).join('/');
      if (!presence.has(ancestor)) presence.set(ancestor, 'sparse');
    }
  }

  return presence;
}

/** Index status entries by their repository-relative path for O(1) join. */
export function indexStatusByPath(
  status: SvnStatusResult | undefined,
  toRepoPath: (localPath: string) => string | null
): Map<string, SvnStatusEntry> {
  const index = new Map<string, SvnStatusEntry>();
  for (const entry of status?.entries ?? []) {
    const repoPath = toRepoPath(entry.path);
    if (repoPath) index.set(repoPath, entry);
  }
  return index;
}

function rollupFrom(entry: SvnStatusEntry | undefined): RepoRollup | undefined {
  if (!entry?.isDirectory) return undefined;
  const changed = entry.childChangeCount ?? 0;
  if (changed === 0) return undefined;
  // The backend gives a single recursive count; conflicts are surfaced
  // separately by the caller when it has the detail to do so.
  return { modified: changed, added: 0, deleted: 0, conflicted: 0 };
}

export interface MergeEntriesOptions {
  /** Directory listing from `svn list`. */
  entries: readonly SvnRepoEntry[];
  /** Repository-relative path of the directory being listed. */
  repoPath: string;
  /** Whether this directory is inside a checkout. Gates every local fact. */
  scope: RepoScope;
  /** Status entries keyed by repository-relative path, if a working copy exists. */
  statusByPath?: Map<string, SvnStatusEntry>;
  /** Paths carrying `svn:externals`, keyed by repository-relative path. */
  externalPaths?: Map<string, { pegged: boolean }>;
  /** Repository-relative paths present on disk, with how completely. */
  presenceByPath?: Map<string, LocalPresence>;
}

/**
 * Join a server listing with local state.
 *
 * When `scope` is 'repository' no local fields are attached at all — not even
 * empty ones — so a component cannot accidentally render a status for a path
 * that was never checked out.
 */
export function mergeEntries({
  entries,
  scope,
  statusByPath,
  externalPaths,
  presenceByPath,
}: MergeEntriesOptions): RepoEntry[] {
  return entries.map((entry) => {
    const base: RepoEntry = {
      name: entry.name,
      path: entry.path,
      url: entry.url,
      kind: entry.kind,
      revision: entry.revision,
      author: entry.author,
      date: entry.date,
      size: entry.size,
    };

    const external = externalPaths?.get(entry.path);
    if (external) {
      base.isExternal = true;
      base.externalPegged = external.pegged;
    }

    // Presence is a local fact but is meaningful even outside a checkout —
    // it is how we mark the exception ("this one IS checked out") rather than
    // labelling the many that are not.
    const presence = presenceByPath?.get(entry.path);
    if (presence && presence !== 'none') base.presence = presence;

    if (scope !== 'working-copy') return base;

    const status = statusByPath?.get(entry.path);
    if (status) {
      base.status = toStatusCode(status.status);
      base.rollup = rollupFrom(status);
      if (status.lock) {
        base.lock = {
          owner: status.lock.owner,
          comment: status.lock.comment,
          created: status.lock.date,
        };
      }
    }
    return base;
  });
}

/**
 * A working copy spans a *range* of revisions, not a single one: updating a
 * subtree moves only that subtree. Surfacing the range is the point.
 */
export function deriveMixedRevisions(
  entries: readonly SvnStatusEntry[],
  fallback: number
): { lowest: number; highest: number } {
  const revisions = entries
    .map((entry) => entry.revision)
    .filter((revision): revision is number => typeof revision === 'number' && revision > 0);

  if (revisions.length === 0) return { lowest: fallback, highest: fallback };
  return { lowest: Math.min(...revisions), highest: Math.max(...revisions) };
}

/** True when the working copy holds more than one revision — worth telling the user. */
export function isMixedRevision(state: Pick<WorkingCopyState, 'mixedRevisions'>): boolean {
  return state.mixedRevisions.lowest !== state.mixedRevisions.highest;
}

export function summariseRollup(entries: readonly SvnStatusEntry[]): RepoRollup {
  let modified = 0;
  let added = 0;
  let deleted = 0;
  let conflicted = 0;
  for (const entry of entries) {
    switch (entry.status) {
      case 'M':
      case 'R':
        modified += 1;
        break;
      case 'A':
        added += 1;
        break;
      // A pending delete and a missing item are changes with consequences: the
      // status bar counts them, so the band has to as well or the same working
      // copy reads as "0 local changes" in one place and "1 change" in another.
      case 'D':
      case '!':
        deleted += 1;
        break;
      case 'C':
        conflicted += 1;
        break;
      default:
        break;
    }
  }
  return { modified, added, deleted, conflicted };
}

export interface BuildWorkingCopyStateOptions {
  info: SvnInfoResult;
  localPath: string;
  repoPath: string;
  status: SvnStatusResult | undefined;
  headRevision: number;
  incomingRevisions: number;
  eligibleRevisions: number;
  /** `svn info` does not report depth, so the caller supplies it from settings or `svn info --xml`. */
  depth?: WorkingCopyState['depth'];
}

export function buildWorkingCopyState({
  info,
  localPath,
  repoPath,
  status,
  headRevision,
  incomingRevisions,
  eligibleRevisions,
  depth = 'unknown',
}: BuildWorkingCopyStateOptions): WorkingCopyState {
  const entries = status?.entries ?? [];
  const baseRevision = info.revision ?? 0;
  return {
    localPath,
    repoPath,
    url: info.url ?? '',
    baseRevision,
    headRevision,
    mixedRevisions: deriveMixedRevisions(entries, baseRevision),
    rollup: summariseRollup(entries),
    eligibleRevisions,
    incomingRevisions,
    depth,
  };
}

/**
 * Parse an `svn:externals` property value into the child paths it defines.
 *
 * Externals are the one place a directory listing lies by omission: `svn list`
 * shows `vendor` as an ordinary directory when in fact its content comes from
 * somewhere else entirely, at a revision that may not move with the rest of the
 * tree. `svn:externals` is a *repository* property, so this is knowable without
 * a checkout — which is why it is the only local-looking flag the browser shows
 * outside a working copy.
 *
 * Both syntaxes are accepted, because repositories in the wild contain both:
 *
 *   old (pre-1.5)  `LOCALPATH [-r REV] URL`
 *   new (1.5+)     `[-r REV] URL[@PEG] LOCALPATH`
 *
 * `dirPath` is the repository-relative path the property is set on; the returned
 * keys are full repository-relative paths so they join straight onto a listing.
 */
export function parseExternalsProperty(
  value: string,
  dirPath: string
): Map<string, { pegged: boolean }> {
  const externals = new Map<string, { pegged: boolean }>();

  for (const rawLine of value.split(/\r?\n/)) {
    // Blank lines and `#` comments are both legal in an externals definition.
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const tokens = line.split(/\s+/);
    let revisionFlag = false;
    const rest: string[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      // `-r REV` and `-rREV` are both accepted by Subversion.
      if (token === '-r' || token === '--revision') {
        revisionFlag = true;
        index += 1;
        continue;
      }
      if (/^-r\d+$/.test(token)) {
        revisionFlag = true;
        continue;
      }
      rest.push(token);
    }

    if (rest.length < 2) continue;

    const [first, second] = rest;
    const isUrl = (token: string): boolean =>
      /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ||
      token.startsWith('^/') ||
      token.startsWith('^../') ||
      token.startsWith('//') ||
      token.startsWith('/') ||
      token.startsWith('../');

    // Which token is the URL tells us which syntax this line uses.
    const newSyntax = isUrl(first);
    const url = newSyntax ? first : second;
    const local = newSyntax ? second : first;
    if (!url || !local) continue;

    const pegged = revisionFlag || /@\d+$/.test(url);
    const normalisedLocal = local.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!normalisedLocal || normalisedLocal.startsWith('..')) continue;

    externals.set(dirPath ? `${dirPath}/${normalisedLocal}` : normalisedLocal, { pegged });
  }

  return externals;
}
