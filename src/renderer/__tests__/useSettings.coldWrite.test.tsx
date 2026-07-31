/**
 * A write that arrives before the settings query has resolved must not erase
 * what is already on disk.
 *
 * `/files` records a recent path as it mounts, so on a cold start — a deep link,
 * or the app reopening onto that route — the very first `store.set` can land
 * before the first `store.get` has come back. Every writer merges onto the
 * current settings and persists the whole object, so if that merge base were the
 * defaults, the user's recent repositories and bookmarks would be written away.
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettings } from '../src/hooks/useSettings';

const STORED = {
  recentRepositories: ['/wc/acme-website', '/wc/intranet'],
  bookmarks: [{ path: '/wc/acme-website/src', name: 'website src', addedAt: 1 }],
  recentPaths: ['/wc/acme-website'],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSettings cold-start writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges onto the stored settings, not the defaults, when the cache is still cold', async () => {
    /* `get` never settles until we let it, so the write below is guaranteed to
       run first — the race this test exists for, made deterministic. */
    let releaseGet: (value: unknown) => void = () => undefined;
    const pendingGet = new Promise((resolve) => {
      releaseGet = resolve;
    });
    const set = vi.fn().mockResolvedValue(undefined);
    let getCalls = 0;
    window.api = {
      store: {
        get: vi.fn().mockImplementation(() => {
          getCalls += 1;
          return getCalls === 1 ? pendingGet : Promise.resolve(STORED);
        }),
        set,
      },
    } as unknown as Window['api'];

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });

    // Write before the first read has resolved.
    const write = act(async () => {
      await result.current.addRecentPath('/wc/globex-portal');
    });
    releaseGet(STORED);
    await write;

    await waitFor(() => expect(set).toHaveBeenCalled());
    const [, persisted] = set.mock.calls[0] as [string, typeof STORED];

    // The new path is recorded...
    expect(persisted.recentPaths[0]).toBe('/wc/globex-portal');
    // ...and nothing else was written away.
    expect(persisted.recentRepositories).toEqual(STORED.recentRepositories);
    expect(persisted.bookmarks).toEqual(STORED.bookmarks);
  });

  it('keeps existing bookmarks when one is added before the first read resolves', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    window.api = {
      store: { get: vi.fn().mockResolvedValue(STORED), set },
    } as unknown as Window['api'];

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.addBookmark('/wc/intranet/docs', 'intranet docs');
    });

    const [, persisted] = set.mock.calls[0] as [string, typeof STORED];
    expect(persisted.bookmarks).toHaveLength(2);
    expect(persisted.recentRepositories).toEqual(STORED.recentRepositories);
  });
});
