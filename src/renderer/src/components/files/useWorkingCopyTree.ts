/**
 * Data for the working-copy folder tree — the pane between the sidebar and the
 * file list on `/files`.
 *
 * Design source: `prototypes/12-browser.html` (`.treepane` / `renderTree`). The
 * rendering is the repository browser's `RepoTree`; this hook only supplies its
 * props, so the two trees stay one component.
 *
 * Three deliberate choices:
 *
 * 1. **Lazy, one directory at a time.** Only expanded directories are listed,
 *    each through `fs:listDirectory` under the *same* query key the file list
 *    and the Miller columns already use, so opening a folder in the tree costs
 *    nothing extra once you have looked at it. A monorepo checkout is never
 *    walked up front.
 * 2. **A ceiling on concurrent listings.** Expanding a deep branch can nominate
 *    dozens of directories at once; beyond `MAX_TREE_DIRECTORY_QUERIES` the most
 *    recently expanded paths win and the rest stay in `loadingPaths`.
 * 3. **No extra `svn` processes.** Roll-ups are derived from the deep status the
 *    file explorer has already fetched for the current directory. Where that
 *    scan does not reach, a folder simply carries no badge — which is the truth,
 *    not a zero.
 */

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { FileInfo, FsStatusResult, SvnStatusChar } from '@shared/types';

import type { RepoEntry, RepoRollup } from '../../features/repo-browser/types';

/** Matches the file list's own `fs:listDirectory` cache so the two share entries. */
const DIRECTORY_STALE_TIME = 5 * 60 * 1000;

/**
 * Ceiling on directories listed at once. Each listing is an IPC round trip that
 * touches the disk; beyond this the tail waits rather than stampeding.
 */
export const MAX_TREE_DIRECTORY_QUERIES = 24;

export interface UseWorkingCopyTreeOptions {
  /** Absolute path the tree is rooted at — normally the working-copy root. */
  rootPath: string;
  /** Absolute paths whose children should be listed. Must include `rootPath`. */
  expandedPaths: ReadonlySet<string>;
  /** Recursive status for the current directory, when the explorer has it. */
  deepStatus?: FsStatusResult;
  /** Immediates-depth status for the current directory. Fills in before the deep scan lands. */
  shallowStatus?: FsStatusResult;
  /** Repository URL of `rootPath`, used to build entry URLs. */
  rootUrl?: string;
  enabled?: boolean;
}

export interface UseWorkingCopyTreeResult {
  /** `RepoTree.roots` — a single entry for the working-copy root. */
  roots: RepoEntry[];
  /** `RepoTree.childrenByPath`; `undefined` means "not listed yet". */
  childrenByPath: Readonly<Record<string, RepoEntry[] | undefined>>;
  /** `RepoTree.childCountByPath` — subfolders each listed directory holds. */
  childCountByPath: Readonly<Record<string, number | undefined>>;
  /** `RepoTree.loadingPaths` — expanded directories still being listed or deferred. */
  loadingPaths: ReadonlySet<string>;
  /** The root listing itself has not arrived yet. */
  isLoading: boolean;
}

/** Forward slashes, no trailing separator — the shape status paths are compared in. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function basename(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function detectSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

/**
 * Directories from `rootPath` down to `targetPath`, inclusive, when the target
 * sits inside the root. Used to reveal where the file list currently is.
 */
export function buildAncestorChain(rootPath: string, targetPath: string): string[] {
  if (!rootPath || !targetPath) return [];
  const root = normalizePath(rootPath);
  const target = normalizePath(targetPath);
  if (target === root) return [rootPath];
  if (!target.startsWith(`${root}/`)) return [rootPath];

  const separator = detectSeparator(targetPath);
  // The first link is `rootPath` verbatim so it matches the root entry's own
  // path; descendants accumulate from the trimmed form, which is `''` when the
  // root is the filesystem root and yields `/foo` rather than `//foo`.
  const chain = [rootPath];
  let accumulated = rootPath.replace(/[\\/]+$/, '');
  for (const segment of target.slice(root.length).split('/').filter(Boolean)) {
    accumulated = `${accumulated}${separator}${segment}`;
    chain.push(accumulated);
  }
  return chain;
}

/** True when `candidate` is `rootPath` or lives beneath it. */
export function isInsideRoot(rootPath: string, candidate: string): boolean {
  const root = normalizePath(rootPath);
  const path = normalizePath(candidate);
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Stable, de-duplicated, capped list of directories to list. Iterated from the
 * end so the most recently expanded paths — the ones on screen — get the budget.
 */
function selectPaths(paths: readonly string[], maxPaths: number): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (let index = paths.length - 1; index >= 0; index -= 1) {
    const path = paths[index];
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    picked.push(path);
    if (picked.length >= maxPaths) break;
  }
  // Sorted so React Query sees an order-independent set across renders.
  return picked.toSorted();
}

/** Statuses that are not pending changes and must never inflate a roll-up. */
function isChange(status: SvnStatusChar): boolean {
  return status !== ' ' && status !== '?' && status !== 'I' && status !== 'X' && status !== 'O';
}

function addToRollup(rollup: RepoRollup, status: SvnStatusChar): void {
  if (status === 'A') rollup.added += 1;
  else if (status === 'C') rollup.conflicted += 1;
  else rollup.modified += 1;
}

/**
 * Count changed descendants for every ancestor directory mentioned by the status
 * scans. Each changed item counts once per ancestor, matching the file list's
 * own folder change counts.
 */
function buildRollups(sources: ReadonlyArray<FsStatusResult | undefined>): Map<string, RepoRollup> {
  const rollups = new Map<string, RepoRollup>();

  for (const source of sources) {
    if (!source) continue;
    for (const entry of source.allEntries) {
      if (!isChange(entry.status)) continue;

      let parentPath = normalizePath(entry.fullPath);
      const counted = new Set<string>();
      while (parentPath) {
        const separatorIndex = parentPath.lastIndexOf('/');
        if (separatorIndex === -1) break;
        parentPath = parentPath.slice(0, separatorIndex);
        if (counted.has(parentPath)) continue;
        counted.add(parentPath);

        let rollup = rollups.get(parentPath);
        if (!rollup) {
          rollup = { modified: 0, added: 0, deleted: 0, conflicted: 0 };
          rollups.set(parentPath, rollup);
        }
        addToRollup(rollup, entry.status);
      }
    }
  }

  return rollups;
}

interface ToEntryInput {
  file: FileInfo;
  rootPath: string;
  rootUrl: string;
  rollups: Map<string, RepoRollup>;
}

function toRepoEntry({ file, rootPath, rootUrl, rollups }: ToEntryInput): RepoEntry {
  const normalized = normalizePath(file.path);
  const rollup = rollups.get(normalized);
  const relative = normalized.startsWith(`${normalizePath(rootPath)}/`)
    ? normalized.slice(normalizePath(rootPath).length + 1)
    : '';

  return {
    name: file.name,
    path: file.path,
    // The tree never renders the URL, but the shared contract requires one; an
    // empty string is honest when we have no repository URL for this checkout.
    url: rootUrl && relative ? `${rootUrl.replace(/\/+$/, '')}/${relative}` : rootUrl,
    kind: 'dir',
    // Repository facts a plain directory listing cannot know. The tree renders
    // none of them; inventing values here would leak into anything that did.
    revision: 0,
    author: '',
    date: '',
    ...(rollup ? { rollup } : {}),
  };
}

function sortByName(a: FileInfo, b: FileInfo): number {
  return a.name.localeCompare(b.name);
}

export function useWorkingCopyTree({
  rootPath,
  expandedPaths,
  deepStatus,
  shallowStatus,
  rootUrl = '',
  enabled = true,
}: UseWorkingCopyTreeOptions): UseWorkingCopyTreeResult {
  const requestedPaths = useMemo(
    () => Array.from(expandedPaths).filter((path) => isInsideRoot(rootPath, path)),
    [expandedPaths, rootPath]
  );
  // Newline-joined: absolute paths routinely contain spaces, never newlines.
  const requestedKey = requestedPaths.join('\n');

  const activePaths = useMemo(
    () => selectPaths(requestedPaths, MAX_TREE_DIRECTORY_QUERIES),
    // `requestedKey` is the value identity of `requestedPaths`; depending on the
    // array itself would rebuild the query list on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestedKey]
  );

  const deferredPaths = useMemo(() => {
    const active = new Set(activePaths);
    return new Set(requestedPaths.filter((path) => !active.has(path)));
  }, [requestedPaths, activePaths]);

  const results = useQueries({
    queries: activePaths.map((dirPath) => ({
      // Shared with the file list and the Miller columns — one listing per folder.
      queryKey: ['fs:listDirectory', dirPath],
      queryFn: () => window.api.fs.listDirectory(dirPath),
      enabled: enabled && !!dirPath && dirPath !== 'DRIVES://',
      staleTime: DIRECTORY_STALE_TIME,
      gcTime: DIRECTORY_STALE_TIME,
      retry: false,
    })),
  });

  const rollups = useMemo(
    () => buildRollups([deepStatus, shallowStatus]),
    [deepStatus, shallowStatus]
  );

  return useMemo(() => {
    const childrenByPath: Record<string, RepoEntry[] | undefined> = {};
    const childCountByPath: Record<string, number | undefined> = {};
    const loadingPaths = new Set<string>(deferredPaths);

    activePaths.forEach((dirPath, index) => {
      const result = results[index];
      if (!result) return;

      const listing = result.data;
      if (listing) {
        // A folder tree lists folders; files belong to the pane on the right.
        const directories = listing.filter((file) => file.isDirectory).toSorted(sortByName);
        childrenByPath[dirPath] = directories.map((file) =>
          toRepoEntry({ file, rootPath, rootUrl, rollups })
        );
        childCountByPath[dirPath] = directories.length;
      } else if (!result.isError) {
        loadingPaths.add(dirPath);
      }
      // An errored listing stays absent rather than rendering as an empty
      // folder, which would claim the directory holds nothing.
    });

    const rootRollup = rollups.get(normalizePath(rootPath));
    const roots: RepoEntry[] = rootPath
      ? [
          {
            name: basename(rootPath),
            path: rootPath,
            url: rootUrl,
            kind: 'dir',
            revision: 0,
            author: '',
            date: '',
            ...(rootRollup ? { rollup: rootRollup } : {}),
          },
        ]
      : [];

    return {
      roots,
      childrenByPath,
      childCountByPath,
      loadingPaths,
      isLoading: loadingPaths.has(rootPath),
    };
  }, [activePaths, results, deferredPaths, rootPath, rootUrl, rollups]);
}
