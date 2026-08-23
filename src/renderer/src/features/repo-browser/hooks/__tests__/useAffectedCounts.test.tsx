/**
 * The lazy completion of affected-path counts (#69): loaded tree data first,
 * `svn list --depth infinity` for the directories never listed, "at least"
 * wording while either is unresolved.
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoEntry } from '../../types';
import { useAffectedCounts } from '../useAffectedCounts';
import type { RemoteOpItem } from '../../lib/remoteOps';

function entry(path: string, kind: 'file' | 'dir' = 'file'): RepoEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    url: `https://svn.example.com/repo/${path}`,
    kind,
    revision: 1,
    author: 'dev',
    date: '2026-08-01T00:00:00Z',
  };
}

const ITEMS: RemoteOpItem[] = [
  { path: 'loaded', name: 'loaded', url: 'https://svn.example.com/repo/loaded', kind: 'dir' },
  { path: 'unloaded', name: 'unloaded', url: 'https://svn.example.com/repo/unloaded', kind: 'dir' },
];

const listFn = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAffectedCounts', () => {
  it('counts loaded subtrees directly and leaves unloaded directories to the server', () => {
    const { result } = renderHook(() =>
      useAffectedCounts(ITEMS, {
        rootUrl: 'https://svn.example.com/repo',
        childrenByPath: { loaded: [entry('loaded/x.ts'), entry('loaded/y.ts')] },
        childCountByPath: { unloaded: 50 },
        listFn,
      }),
      { wrapper: createWrapper() }
    );

    // 2 known descendants from cache; `unloaded` pending on the server.
    expect(result.current.counts).toEqual({ direct: 2, knownDescendants: 2, unloadedDirs: 1 });
  });

  it('folds the lazy listing in and clears the counting state', async () => {
    listFn.mockImplementation(async (url: string) => ({
      path: url,
      entries: Array.from({ length: 47 }, (_, index) => ({
        name: `f${index}.ts`,
        path: `${url}/f${index}.ts`,
        url: `${url}/f${index}.ts`,
        kind: 'file' as const,
        revision: 1,
        author: 'dev',
        date: '2026-08-01T00:00:00Z',
      })),
    }));

    const { result } = renderHook(() =>
      useAffectedCounts(ITEMS, {
        rootUrl: 'https://svn.example.com/repo',
        childrenByPath: { loaded: [entry('loaded/x.ts')] },
        listFn,
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.counts.unloadedDirs).toBe(0));
    expect(result.current.counts.knownDescendants).toBe(1 + 47);
    expect(result.current.isCounting).toBe(false);
    expect(listFn).toHaveBeenCalledWith('https://svn.example.com/repo/unloaded', 'HEAD');
  });

  it('keeps the "at least" wording when the server cannot be reached', async () => {
    listFn.mockRejectedValue(new Error('E175002: connection refused'));

    const { result } = renderHook(() =>
      useAffectedCounts(ITEMS, {
        rootUrl: 'https://svn.example.com/repo',
        childrenByPath: { loaded: [entry('loaded/x.ts')] },
        listFn,
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isCounting).toBe(false));
    expect(result.current.counts.unloadedDirs).toBe(1);
  });
});
