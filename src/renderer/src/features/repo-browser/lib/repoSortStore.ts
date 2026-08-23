/**
 * Persistence for the repository browser's column sort (#68), per repository.
 *
 * Same bridge and same shape discipline as `lib/shortcutStore.ts`: one
 * versioned key in `window.api.store` holding a `root URL -> sort` map, and a
 * strict parser so a corrupt or foreign payload degrades to the default
 * rather than to a crash. Only whole `RepoSort` values are stored — there is
 * nothing to merge with defaults, unlike shortcut bindings.
 */

import type { RepoSort } from '../types';

export const REPO_BROWSER_SORT_KEY = 'shellysvn:repo-browser-sort:v1';

/** The sort every repository starts at until the user chooses otherwise. */
export const DEFAULT_REPO_SORT: RepoSort = { key: 'name', direction: 'asc' };

const SORT_KEYS: ReadonlySet<RepoSort['key']> = new Set([
  'name',
  'revision',
  'author',
  'date',
  'size',
  'status',
]);

/** Validate one unknown payload as a `RepoSort`; anything else is null. */
export function normalizeRepoSort(value: unknown): RepoSort | null {
  if (!value || typeof value !== 'object') return null;
  const { key, direction } = value as { key?: unknown; direction?: unknown };
  if (typeof key !== 'string' || !SORT_KEYS.has(key as RepoSort['key'])) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { key: key as RepoSort['key'], direction };
}

/** Validate the stored map (`rootUrl -> sort`); bad entries are dropped. */
export function parseRepoSortMap(value: unknown): Record<string, RepoSort> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, RepoSort> = {};
  for (const [rootUrl, sort] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeRepoSort(sort);
    if (normalized) result[rootUrl] = normalized;
  }
  return result;
}

/** Load every repository's persisted sort. Storage failures degrade to {}. */
export async function loadRepoSortMap(): Promise<Record<string, RepoSort>> {
  try {
    const stored = await window.api?.store?.get<unknown>(REPO_BROWSER_SORT_KEY);
    return parseRepoSortMap(stored);
  } catch {
    return {};
  }
}

/** The persisted sort for one repository, or null when it has none. */
export async function loadRepoSort(rootUrl: string): Promise<RepoSort | null> {
  const map = await loadRepoSortMap();
  return map[rootUrl] ?? null;
}

/**
 * Persist one repository's sort. Read-modify-write over the whole map: the
 * store bridge has no patch operation, and the map is small (one entry per
 * repository the user has browsed).
 */
export async function persistRepoSort(rootUrl: string, sort: RepoSort): Promise<void> {
  const map = await loadRepoSortMap();
  map[rootUrl] = sort;
  await window.api?.store?.set(REPO_BROWSER_SORT_KEY, map);
}

/** The next sort after clicking column `key`, given the current one. */
export function nextSortAfter(current: RepoSort, key: RepoSort['key']): RepoSort {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}
