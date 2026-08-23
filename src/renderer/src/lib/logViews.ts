/**
 * Saved log filter views, per working copy (#67), plus the per-working-copy
 * column sort preference (#66).
 *
 * Same pattern as `lib/shortcutStore.ts` / `lib/savedComparisons.ts`: a
 * versioned key on the `window.api.store` bridge, strict validation of
 * whatever comes back, graceful degradation to an empty list. The current
 * payload is `{ version: 1, byRoot: Record<wcKey, SavedLogView[]> }`; a
 * legacy payload that stored the bare record is still understood and
 * converted on load.
 */

import {
  DEFAULT_LOG_SORT,
  EMPTY_LOG_FILTERS,
  parseLogFilterState,
  parseLogSortState,
  type LogFilterState,
  type LogSortState,
} from '@renderer/utils/logFilters';
import type { SvnLogEntry } from '@shared/types';

export const LOG_VIEWS_KEY = 'shellysvn:log-views:v1';
export const LOG_SORT_KEY = 'shellysvn:log-sort:v1';

/** One named view: filter state + sort, restored verbatim on apply. */
export interface SavedLogView {
  id: string;
  name: string;
  filters: LogFilterState;
  sort: LogSortState;
  /** Shipped with the app; deletable, restorable via `defaultLogViews`. */
  builtin?: boolean;
  /** Dynamic date window resolved at apply time so "Last 7 days" stays true. */
  datePreset?: 'last-7-days';
  createdAt: string;
  updatedAt: string;
}

export type LogViewsByRoot = Record<string, SavedLogView[]>;

interface LogViewsStore {
  version: 1;
  byRoot: LogViewsByRoot;
}

/** Normalise a working-copy root for use as a storage key. */
export function normalizeWcKey(root: string): string {
  return root.trim().replace(/[/\\]+$/, '') || root;
}

export function newLogViewId(): string {
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate one unknown payload as a saved view. */
export function parseSavedLogView(value: unknown): SavedLogView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, name, filters, sort, builtin, datePreset, createdAt, updatedAt } =
    value as Record<string, unknown>;
  if (typeof id !== 'string' || !id) return null;
  if (typeof name !== 'string' || !name.trim()) return null;

  const parsedFilters = parseLogFilterState(filters);
  if (!parsedFilters) return null;

  const parsedSort = parseLogSortState(sort) ?? DEFAULT_LOG_SORT;

  if (datePreset !== undefined && datePreset !== 'last-7-days') return null;

  return {
    id,
    name: name.trim(),
    filters: parsedFilters,
    sort: parsedSort,
    ...(builtin === true ? { builtin: true } : {}),
    ...(datePreset === 'last-7-days' ? { datePreset } : {}),
    createdAt: typeof createdAt === 'string' ? createdAt : new Date().toISOString(),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date().toISOString(),
  };
}

export function parseSavedLogViews(value: unknown): SavedLogView[] {
  if (!Array.isArray(value)) return [];
  const views: SavedLogView[] = [];
  for (const entry of value) {
    const view = parseSavedLogView(entry);
    if (view) views.push(view);
  }
  return views;
}

/**
 * Validate a whole-store payload. The current shape is the versioned wrapper;
 * a legacy bare `Record<root, unknown[]>` is converted. Anything else is
 * empty — malformed entries are dropped, not fatal.
 */
export function parseLogViewsStore(value: unknown): LogViewsByRoot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  let byRoot: unknown = record;
  if (record.version === 1 && record.byRoot && typeof record.byRoot === 'object') {
    byRoot = record.byRoot;
  }

  const result: LogViewsByRoot = {};
  for (const [root, views] of Object.entries(byRoot as Record<string, unknown>)) {
    if (!root || typeof root !== 'string') continue;
    const parsed = parseSavedLogViews(views);
    if (parsed.length > 0) result[normalizeWcKey(root)] = parsed;
  }
  return result;
}

function toLogViewsStore(byRoot: LogViewsByRoot): LogViewsStore {
  return { version: 1, byRoot };
}

export async function loadSavedLogViews(wcRoot: string): Promise<SavedLogView[]> {
  try {
    const stored = await window.api?.store?.get<unknown>(LOG_VIEWS_KEY);
    return parseLogViewsStore(stored)[normalizeWcKey(wcRoot)] ?? [];
  } catch {
    return [];
  }
}

export async function saveSavedLogViews(wcRoot: string, views: SavedLogView[]): Promise<void> {
  const key = normalizeWcKey(wcRoot);
  const store = parseLogViewsStore(await window.api?.store?.get<unknown>(LOG_VIEWS_KEY));
  const next = { ...store, [key]: views };
  await window.api?.store?.set(LOG_VIEWS_KEY, toLogViewsStore(next));
}

// ---------------------------------------------------------------------------
// Per-working-copy sort preference (#66)
// ---------------------------------------------------------------------------

function parseLogSortRecord(value: unknown): Record<string, LogSortState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, LogSortState> = {};
  for (const [root, sort] of Object.entries(value as Record<string, unknown>)) {
    if (!root || typeof root !== 'string') continue;
    const parsed = parseLogSortState(sort);
    if (parsed) result[normalizeWcKey(root)] = parsed;
  }
  return result;
}

export async function loadLogSortState(wcRoot: string): Promise<LogSortState | null> {
  try {
    const stored = await window.api?.store?.get<unknown>(LOG_SORT_KEY);
    return parseLogSortRecord(stored)[normalizeWcKey(wcRoot)] ?? null;
  } catch {
    return null;
  }
}

export async function saveLogSortState(wcRoot: string, sort: LogSortState): Promise<void> {
  const key = normalizeWcKey(wcRoot);
  const stored = await window.api?.store?.get<unknown>(LOG_SORT_KEY);
  const next = { ...parseLogSortRecord(stored), [key]: sort };
  await window.api?.store?.set(LOG_SORT_KEY, next);
}

// ---------------------------------------------------------------------------
// Built-in views (#67)
// ---------------------------------------------------------------------------

export const BUILTIN_VIEW_IDS = {
  myCommits: 'builtin:my-commits',
  last7Days: 'builtin:last-7-days',
  mergeFree: 'builtin:merge-free',
} as const;

/**
 * The most frequent author across the loaded log — the best available stand-in
 * for "current user" (SVN credentials are not exposed per working copy).
 */
export function derivePrimaryAuthor(entries: readonly SvnLogEntry[]): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const author = (entry.author ?? '').trim();
    if (!author) continue;
    counts.set(author, (counts.get(author) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [author, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && author < best)) {
      best = author;
      bestCount = count;
    }
  }
  return best;
}

function builtinView(
  id: string,
  name: string,
  filters: LogFilterState,
  extra?: Partial<Pick<SavedLogView, 'datePreset'>>
): SavedLogView {
  const now = new Date().toISOString();
  return {
    id,
    name,
    filters,
    sort: { ...DEFAULT_LOG_SORT },
    builtin: true,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/**
 * Views shipped with the app. "My commits" only appears when an author can be
 * derived from the log; "Last 7 days" is a preset resolved at apply time so it
 * never goes stale; "Merge-free" excludes messages matching /merge/i.
 */
export function defaultLogViews(entries: readonly SvnLogEntry[]): SavedLogView[] {
  const views: SavedLogView[] = [];

  const author = derivePrimaryAuthor(entries);
  if (author) {
    views.push(
      builtinView(
        BUILTIN_VIEW_IDS.myCommits,
        'My commits',
        { ...EMPTY_LOG_FILTERS, author },
      )
    );
  }

  views.push(
    builtinView(BUILTIN_VIEW_IDS.last7Days, 'Last 7 days', { ...EMPTY_LOG_FILTERS }, {
      datePreset: 'last-7-days',
    })
  );

  views.push(
    builtinView(BUILTIN_VIEW_IDS.mergeFree, 'Merge-free', {
      ...EMPTY_LOG_FILTERS,
      useRegex: true,
      notMessage: '\\bmerge\\b',
    })
  );

  return views;
}

/** Effective filters for a view: dynamic presets are resolved against `now`. */
export function resolveLogViewFilters(view: SavedLogView, now?: Date): LogFilterState {
  if (view.datePreset !== 'last-7-days') return view.filters;
  const reference = now ?? new Date();
  const from = new Date(reference.getTime() - 7 * 24 * 60 * 60 * 1000);
  const isoDate = from.toISOString().slice(0, 10);
  return { ...view.filters, dateFrom: isoDate, dateTo: '' };
}

/** Built-in views missing from `views`, for "Restore default views". */
export function missingBuiltinViews(views: SavedLogView[], entries: readonly SvnLogEntry[]): SavedLogView[] {
  const present = new Set(views.map((view) => view.id));
  return defaultLogViews(entries).filter((view) => !present.has(view.id));
}
