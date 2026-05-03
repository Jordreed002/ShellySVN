import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettings } from '../src/hooks/useSettings';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function mockSettingsStore(settings: Record<string, unknown> | null = null) {
  const set = vi.fn().mockResolvedValue(undefined);
  window.api = {
    store: {
      get: vi.fn().mockResolvedValue(settings),
      set,
    },
  } as unknown as Window['api'];
  return { set };
}

describe('useSettings navigation state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults startup action and navigation lists when settings are empty', async () => {
    mockSettingsStore(null);

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.startupAction).toBe('welcome');
    expect(result.current.settings.recentRepositories).toEqual([]);
    expect(result.current.settings.recentPaths).toEqual([]);
    expect(result.current.settings.bookmarks).toEqual([]);
  });

  it('deep-merges saved nested settings with current defaults', async () => {
    mockSettingsStore({
      diffMerge: {
        ignoreWhitespace: true,
      },
      proxySettings: {
        enabled: true,
        host: 'proxy.example.com',
      },
    });

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.diffMerge).toMatchObject({
      ignoreWhitespace: true,
      externalDiffTool: '',
      externalMergeTool: '',
      externalToolOverrides: [],
      contextLines: 3,
    });
    expect(result.current.settings.proxySettings).toMatchObject({
      enabled: true,
      host: 'proxy.example.com',
      port: 8080,
      bypassForLocal: true,
    });
  });

  it('preserves customized nested siblings during partial nested updates', async () => {
    const { set } = mockSettingsStore({
      diffMerge: {
        externalDiffTool: 'meld',
        externalMergeTool: 'kdiff3',
        externalToolOverrides: [],
        diffOnDoubleClick: true,
        ignoreWhitespace: false,
        ignoreEol: false,
        contextLines: 8,
      },
    });

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateSettings({
        diffMerge: {
          ignoreWhitespace: true,
        },
      });
    });

    expect(set).toHaveBeenLastCalledWith(
      'settings',
      expect.objectContaining({
        diffMerge: expect.objectContaining({
          externalDiffTool: 'meld',
          externalMergeTool: 'kdiff3',
          ignoreWhitespace: true,
          contextLines: 8,
        }),
      })
    );
  });

  it('moves recent repositories to the front, deduplicates them, and caps the list', async () => {
    const existing = Array.from({ length: 10 }, (_, index) => `C:\\repos\\repo-${index}`);
    const { set } = mockSettingsStore({
      startupAction: 'lastRepo',
      recentRepositories: existing,
    });

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addRecentRepo('C:\\repos\\repo-5');
    });
    expect(set).toHaveBeenLastCalledWith(
      'settings',
      expect.objectContaining({
        recentRepositories: [
          'C:\\repos\\repo-5',
          'C:\\repos\\repo-0',
          'C:\\repos\\repo-1',
          'C:\\repos\\repo-2',
          'C:\\repos\\repo-3',
          'C:\\repos\\repo-4',
          'C:\\repos\\repo-6',
          'C:\\repos\\repo-7',
          'C:\\repos\\repo-8',
          'C:\\repos\\repo-9',
        ],
      })
    );

    await act(async () => {
      await result.current.addRecentRepo('C:\\repos\\repo-new');
    });
    expect(set).toHaveBeenLastCalledWith(
      'settings',
      expect.objectContaining({
        recentRepositories: [
          'C:\\repos\\repo-new',
          'C:\\repos\\repo-5',
          'C:\\repos\\repo-0',
          'C:\\repos\\repo-1',
          'C:\\repos\\repo-2',
          'C:\\repos\\repo-3',
          'C:\\repos\\repo-4',
          'C:\\repos\\repo-6',
          'C:\\repos\\repo-7',
          'C:\\repos\\repo-8',
        ],
      })
    );
  });

  it('tracks recent paths separately from recent repositories and caps path history', async () => {
    const existing = Array.from({ length: 20 }, (_, index) => `C:\\repos\\repo\\path-${index}`);
    const { set } = mockSettingsStore({ recentPaths: existing });

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addRecentPath('C:\\repos\\repo\\path-new');
    });

    expect(set).toHaveBeenLastCalledWith(
      'settings',
      expect.objectContaining({
        recentPaths: ['C:\\repos\\repo\\path-new', ...existing.slice(0, 19)],
      })
    );
  });

  it('adds, deduplicates, caps, and removes bookmarks', async () => {
    const existing = Array.from({ length: 50 }, (_, index) => ({
      path: `C:\\repos\\repo\\bookmark-${index}`,
      name: `Bookmark ${index}`,
      addedAt: index,
    }));
    const { set } = mockSettingsStore({ bookmarks: existing });

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addBookmark('C:\\repos\\repo\\bookmark-5', 'Duplicate');
    });
    expect(set).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.addBookmark('C:\\repos\\repo\\new-bookmark', 'New Bookmark');
    });
    expect(set).toHaveBeenLastCalledWith(
      'settings',
      expect.objectContaining({
        bookmarks: [
          expect.objectContaining({
            path: 'C:\\repos\\repo\\new-bookmark',
            name: 'New Bookmark',
          }),
          ...existing.slice(0, 49),
        ],
      })
    );

    await act(async () => {
      await result.current.removeBookmark('C:\\repos\\repo\\bookmark-5');
    });
    expect(set).toHaveBeenLastCalledWith(
      'settings',
      expect.objectContaining({
        bookmarks: expect.not.arrayContaining([
          expect.objectContaining({ path: 'C:\\repos\\repo\\bookmark-5' }),
        ]),
      })
    );
  });
});
