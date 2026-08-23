import React, { type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnLogEntry } from '@shared/types';
import { LOG_SORT_KEY, LOG_VIEWS_KEY } from '@renderer/lib/logViews';
import { useLogViewState } from '../useLogViewState';

const entries: SvnLogEntry[] = [
  {
    revision: 30,
    author: 'alice',
    date: '2026-08-20T10:00:00.000Z',
    message: 'Fix checkout',
    paths: [{ action: 'M', path: '/trunk/src/checkout.ts' }],
  },
  {
    revision: 31,
    author: 'bob',
    date: '2026-08-21T10:00:00.000Z',
    message: 'Merge feature-x',
    paths: [{ action: 'M', path: '/trunk/src/merge.ts' }],
  },
  {
    revision: 32,
    author: 'alice',
    date: '2026-08-22T10:00:00.000Z',
    message: 'Refactor logs',
    paths: [{ action: 'M', path: '/trunk/src/log.tsx' }],
  },
];

function setupStore() {
  const data = new Map<string, unknown>();
  window.api.store.get = vi.fn(async (key: string) => data.get(key));
  window.api.store.set = vi.fn(async (key: string, value: unknown) => {
    data.set(key, value);
  });
  return data;
}

/**
 * The hook's optimistic delete seam uses `useMutation` (#92), which needs a
 * QueryClientProvider — the app mounts one at the root (main.tsx).
 */
function renderLogViewHook(options: Parameters<typeof useLogViewState>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useLogViewState(options), { wrapper });
}

describe('useLogViewState', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    setupStore();
    window.api.dialog.saveFile = vi.fn().mockResolvedValue('/tmp/out.csv');
    window.api.fs.writeFile = vi.fn().mockResolvedValue({ success: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it('debounces text input before filtering large logs', async () => {
    vi.useFakeTimers();
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 200,
    });

    act(() => result.current.updateFilter('search', 'alice'));
    // Not yet applied — the debounce window is still open.
    expect(result.current.filteredEntries).toHaveLength(3);

    act(() => vi.advanceTimersByTime(250));
    expect(result.current.filteredEntries.map((e) => e.revision)).toEqual([32, 30]);
  });

  it('reports invalid regex and keeps other filters working', async () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    act(() => {
      result.current.updateFilter('useRegex', true);
      result.current.updateFilter('message', '[oops');
    });

    expect(result.current.regexError).toMatch(/^Message:/);
    expect(result.current.filteredEntries).toHaveLength(3);

    act(() => result.current.updateFilter('message', 'Refactor'));
    expect(result.current.filteredEntries.map((e) => e.revision)).toEqual([32]);
    expect(result.current.regexError).toBeNull();
  });

  it('sorts and persists the column choice per working copy', async () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    act(() => result.current.toggleSort('author'));
    expect(result.current.sort).toEqual({ key: 'author', direction: 'asc' });
    expect(result.current.filteredEntries.map((e) => e.author)).toEqual([
      'alice',
      'alice',
      'bob',
    ]);

    await waitFor(() =>
      expect(window.api.store.set).toHaveBeenCalledWith(LOG_SORT_KEY, {
        '/wc': { key: 'author', direction: 'asc' },
      })
    );
  });

  it('restores a persisted sort preference on mount', async () => {
    await window.api.store.set(LOG_SORT_KEY, { '/wc': { key: 'date', direction: 'asc' } });
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    await waitFor(() => expect(result.current.sort).toEqual({ key: 'date', direction: 'asc' }));
    expect(result.current.filteredEntries.map((e) => e.revision)).toEqual([30, 31, 32]);
  });

  it('seeds the built-in views once a log is loaded, without persisting them', async () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    await waitFor(() => expect(result.current.views.length).toBeGreaterThanOrEqual(2));
    const names = result.current.views.map((view) => view.name);
    expect(names).toContain('My commits');
    expect(names).toContain('Last 7 days');
    expect(names).toContain('Merge-free');
    // Seeding is in-memory only; the user's store stays untouched.
    expect(window.api.store.set).not.toHaveBeenCalledWith(LOG_VIEWS_KEY, expect.anything());
  });

  it('saves, applies, renames and deletes named views', async () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    // Let the initial store read settle (built-ins seeded) before editing.
    await waitFor(() => expect(result.current.views.length).toBeGreaterThan(0));

    act(() => result.current.updateFilter('author', 'bob'));
    act(() => result.current.toggleSort('date'));

    let saved: unknown = null;
    await act(async () => {
      saved = await result.current.saveCurrentView('Bob only');
    });
    const savedView = saved as { id: string };
    expect(savedView).not.toBeNull();

    await waitFor(() =>
      expect(window.api.store.set).toHaveBeenCalledWith(
        LOG_VIEWS_KEY,
        expect.objectContaining({
          version: 1,
          byRoot: expect.objectContaining({
            '/wc': expect.arrayContaining([expect.objectContaining({ name: 'Bob only' })]),
          }),
        })
      )
    );
    // The saved view is part of the current state.
    expect(result.current.views.some((view) => view.id === savedView.id)).toBe(true);

    // Applying a clean view replaces the filters and sort.
    const view = result.current.views.find((v) => v.id === savedView.id)!;
    act(() => result.current.applyView(view));
    expect(result.current.filters.author).toBe('bob');
    expect(result.current.sort).toEqual({ key: 'date', direction: 'desc' });

    // Round-trip from storage.
    const { result: second } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });
    await waitFor(() => expect(second.current.views.map((v) => v.name)).toContain('Bob only'));
    // Stored views suppress re-seeding: no duplicated built-ins appear.
    expect(second.current.views.filter((v) => v.name === 'Merge-free')).toHaveLength(1);
    expect(second.current.views.filter((v) => v.name === 'Bob only')).toHaveLength(1);

    await act(async () => {
      await result.current.renameView(view.id, 'Bob fixed');
    });
    expect(result.current.views.find((v) => v.id === view.id)?.name).toBe('Bob fixed');

    await act(async () => {
      await result.current.deleteView(view.id);
    });
    expect(result.current.views.some((v) => v.id === view.id)).toBe(false);
  });

  it('refuses to save a view while a regex is invalid', async () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    act(() => {
      result.current.updateFilter('useRegex', true);
      result.current.updateFilter('search', '(');
    });
    let saved: unknown = 'unset';
    await act(async () => {
      saved = await result.current.saveCurrentView('Broken');
    });
    expect(saved).toBeNull();
    // No view named "Broken" was created (built-ins may be seeded, but never this).
    expect(result.current.views.some((view) => view.name === 'Broken')).toBe(false);
  });

  it('exports the current filtered set through the save dialog', async () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    act(() => result.current.updateFilter('search', 'alice'));

    let exportResult: { status: string } | null = null;
    await act(async () => {
      exportResult = await result.current.exportEntries('csv');
    });

    expect(exportResult!.status).toBe('saved');
    expect(window.api.dialog.saveFile).toHaveBeenCalled();
    const [, content] = (window.api.fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    // Only the two alice commits, not bob's merge.
    expect(content).toContain('30,2026-08-20T10:00:00.000Z,alice,');
    expect(content).not.toContain(',bob,');
    expect(result.current.exportNotice).toMatch(/Saved \/tmp\/out\.csv/);
  });

  it('opens the show-changes target for a revision and guards bad input', () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    act(() => result.current.requestShowChanges(31));
    expect(result.current.diffTarget).toEqual({ path: '/wc', revision: 31 });

    act(() => result.current.closeDiff());
    expect(result.current.diffTarget).toBeNull();

    act(() => result.current.requestShowChanges(0));
    act(() => result.current.requestShowChanges(Number.NaN));
    expect(result.current.diffTarget).toBeNull();
  });

  it('rolls a deleted view back into the list when the store write fails (#92)', async () => {
    const { result } = renderLogViewHook({
      path: '/wc',
      entries,
      storageKey: '/wc',
      debounceMs: 0,
    });

    await waitFor(() => expect(result.current.views.length).toBeGreaterThan(0));
    const before = [...result.current.views];
    const victim = before[0];

    (window.api.store.set as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('store unavailable')
    );

    await act(async () => {
      await result.current.deleteView(victim.id);
    });

    // The exact pre-delete list is restored — rollback, not a refetch.
    await waitFor(() =>
      expect(result.current.views.map((view) => view.id)).toEqual(before.map((view) => view.id))
    );
  });
});
