import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnLogEntry } from '@shared/types';
import {
  DEFAULT_LOG_SORT,
  EMPTY_LOG_FILTERS,
} from '@renderer/utils/logFilters';
import {
  BUILTIN_VIEW_IDS,
  LOG_SORT_KEY,
  LOG_VIEWS_KEY,
  defaultLogViews,
  derivePrimaryAuthor,
  loadLogSortState,
  loadSavedLogViews,
  missingBuiltinViews,
  normalizeWcKey,
  parseLogViewsStore,
  parseSavedLogView,
  resolveLogViewFilters,
  saveLogSortState,
  saveSavedLogViews,
  type SavedLogView,
} from '../logViews';

const entries: SvnLogEntry[] = [
  {
    revision: 10,
    author: 'alice',
    date: '2026-08-20T10:00:00.000Z',
    message: 'First',
    paths: [],
  },
  {
    revision: 11,
    author: 'alice',
    date: '2026-08-21T10:00:00.000Z',
    message: 'Second',
    paths: [],
  },
  {
    revision: 12,
    author: 'bob',
    date: '2026-08-22T10:00:00.000Z',
    message: 'Third',
    paths: [],
  },
];

/** Minimal valid view payload for parse tests. */
const viewPayload = {
  id: 'view-1',
  name: 'Mine',
  filters: { ...EMPTY_LOG_FILTERS, author: 'alice' },
  sort: { key: 'date', direction: 'asc' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('logViews — parsing', () => {
  it('accepts a well-formed view', () => {
    const view = parseSavedLogView(viewPayload);
    expect(view).not.toBeNull();
    expect(view?.name).toBe('Mine');
    expect(view?.filters.author).toBe('alice');
    expect(view?.sort).toEqual({ key: 'date', direction: 'asc' });
  });

  it('drops malformed entries instead of failing the whole list', () => {
    expect(parseSavedLogView({ id: 'x' })).toBeNull(); // missing name
    expect(parseSavedLogView({ ...viewPayload, filters: { author: 5 } })).toBeNull();
    expect(parseSavedLogView({ ...viewPayload, sort: { key: 'nope' } })).not.toBeNull(); // falls back to default sort
    expect(parseSavedLogView('nope')).toBeNull();
  });

  it('reads the versioned wrapper and migrates the legacy bare record', () => {
    const wrapped = parseLogViewsStore({
      version: 1,
      byRoot: { '/wc/a': [viewPayload] },
    });
    expect(wrapped['/wc/a']).toHaveLength(1);

    const legacy = parseLogViewsStore({ '/wc/a': [viewPayload] });
    expect(legacy['/wc/a']).toHaveLength(1);
    expect(legacy).toEqual(wrapped);

    expect(parseLogViewsStore('nonsense')).toEqual({});
  });

  it('normalises working-copy keys (trailing separators)', () => {
    expect(normalizeWcKey('/wc/a/')).toBe('/wc/a');
    expect(normalizeWcKey('/wc/a//')).toBe('/wc/a');
  });
});

describe('logViews — store round-trip', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    // Back the store mock with a map so set/get behave like real persistence.
    const data = new Map<string, unknown>();
    window.api.store.get = vi.fn(async (key: string) => data.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves and reloads views for a working copy, isolated per root', async () => {
    await saveSavedLogViews('/wc/a', [parseSavedLogView(viewPayload) as SavedLogView]);

    const stored = await window.api.store.get<unknown>(LOG_VIEWS_KEY);
    expect(parseLogViewsStore(stored)['/wc/a']).toHaveLength(1);

    const loaded = await loadSavedLogViews('/wc/a');
    expect(loaded.map((view) => view.name)).toEqual(['Mine']);

    // A different working copy starts empty.
    expect(await loadSavedLogViews('/wc/b')).toEqual([]);
  });

  it('overwrites the list for the same root but keeps other roots', async () => {
    await saveSavedLogViews('/wc/a', [parseSavedLogView(viewPayload) as SavedLogView]);
    await saveSavedLogViews('/wc/b', [
      { ...parseSavedLogView(viewPayload)!, id: 'view-2', name: 'Other' },
    ]);
    await saveSavedLogViews('/wc/a', []);

    const byRoot = parseLogViewsStore(await window.api.store.get<unknown>(LOG_VIEWS_KEY));
    expect(byRoot['/wc/a']).toBeUndefined();
    expect(byRoot['/wc/b']).toHaveLength(1);
  });

  it('degrades gracefully when storage throws', async () => {
    (window.api.store.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await expect(loadSavedLogViews('/wc/a')).resolves.toEqual([]);
  });
});

describe('logViews — sort persistence', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    const data = new Map<string, unknown>();
    window.api.store.get = vi.fn(async (key: string) => data.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    });
  });

  it('round-trips the per-working-copy sort preference', async () => {
    await saveLogSortState('/wc/a', { key: 'author', direction: 'asc' });
    expect(await loadLogSortState('/wc/a')).toEqual({ key: 'author', direction: 'asc' });
    expect(await loadLogSortState('/wc/b')).toBeNull();
  });

  it('rejects a corrupted payload to the default', async () => {
    await window.api.store.set(LOG_SORT_KEY, { '/wc/a': { key: 'date', direction: 'nope' } });
    expect(await loadLogSortState('/wc/a')).toBeNull();
    expect(DEFAULT_LOG_SORT).toEqual({ key: 'revision', direction: 'desc' });
  });
});

describe('logViews — built-in views (#67)', () => {
  it('derives the primary author from the log', () => {
    expect(derivePrimaryAuthor(entries)).toBe('alice');
    expect(derivePrimaryAuthor([])).toBeNull();
  });

  it('ships My commits (when derivable), Last 7 days and Merge-free', () => {
    const views = defaultLogViews(entries);
    expect(views.map((view) => view.id)).toEqual([
      BUILTIN_VIEW_IDS.myCommits,
      BUILTIN_VIEW_IDS.last7Days,
      BUILTIN_VIEW_IDS.mergeFree,
    ]);
    expect(views.every((view) => view.builtin)).toBe(true);

    const mine = views[0];
    expect(mine.filters.author).toBe('alice');

    // Without a log to derive an author from, My commits is omitted.
    expect(defaultLogViews([]).map((view) => view.id)).toEqual([
      BUILTIN_VIEW_IDS.last7Days,
      BUILTIN_VIEW_IDS.mergeFree,
    ]);
  });

  it('resolves the Last-7-days preset at apply time so it never goes stale', () => {
    const view = defaultLogViews(entries).find((v) => v.id === BUILTIN_VIEW_IDS.last7Days)!;
    const now = new Date('2026-08-23T12:00:00.000Z');

    const filters = resolveLogViewFilters(view, now);
    expect(filters.dateFrom).toBe('2026-08-16');
    expect(filters.dateTo).toBe('');

    const nextWeek = resolveLogViewFilters(view, new Date('2026-08-30T12:00:00.000Z'));
    expect(nextWeek.dateFrom).toBe('2026-08-23');
  });

  it('Merge-free excludes merge-like messages', () => {
    const view = defaultLogViews(entries).find((v) => v.id === BUILTIN_VIEW_IDS.mergeFree)!;
    const filters = resolveLogViewFilters(view);
    const mergeEntry = { ...entries[0], message: 'MERGE branch x to trunk' };
    const plainEntry = { ...entries[0], message: 'Routine fix' };
    const predicate = (entry: SvnLogEntry) =>
      !new RegExp(filters.notMessage, 'i').test(entry.message);
    expect(predicate(mergeEntry)).toBe(false);
    expect(predicate(plainEntry)).toBe(true);
  });

  it('restore-defaults reports only the missing built-ins', () => {
    const views = defaultLogViews(entries);
    const kept = views.filter((view) => view.id !== BUILTIN_VIEW_IDS.myCommits);
    expect(missingBuiltinViews(kept, entries).map((view) => view.id)).toEqual([
      BUILTIN_VIEW_IDS.myCommits,
    ]);
    expect(missingBuiltinViews(views, entries)).toEqual([]);
  });
});
