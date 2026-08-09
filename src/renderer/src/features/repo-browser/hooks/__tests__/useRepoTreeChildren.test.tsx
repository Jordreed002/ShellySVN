/**
 * Coverage for the useRepoTreeChildren hook orchestration (was 0%). The adapter
 * pipeline (mergeEntries/resolveScope/toRepoRelativeEntries) is covered by
 * adapters.test.ts; cachedSvnRead is mocked here so we can drive the per-path
 * query outcomes and exercise selectPaths (cap/dedup), deferred paths, per-path
 * errors, and the disabled/empty-root gates.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

import type { SvnRepoEntry } from '@shared/types';

const mockReadCachedList = vi.hoisted(() => vi.fn());
vi.mock('@renderer/utils/cachedSvnRead', () => ({ readCachedList: mockReadCachedList }));

import { useRepoTreeChildren } from '../useRepoTreeChildren';

const ROOT = 'https://svn.example.com/repo';
const HEAD = { kind: 'head' } as const;

function entriesFor(url: string): SvnRepoEntry[] {
  return [
    {
      name: 'a.ts',
      path: `${url}/a.ts`,
      url: `${url}/a.ts`,
      kind: 'file',
      revision: 1,
      author: 'al',
      date: '2024-01-01',
    },
    {
      name: 'sub',
      path: `${url}/sub`,
      url: `${url}/sub`,
      kind: 'dir',
      revision: 2,
      author: 'bo',
      date: '2024-01-02',
    },
  ];
}

function ok(url: string) {
  return Promise.resolve({ data: { path: url, entries: entriesFor(url) } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadCachedList.mockImplementation((url: string) => ok(url));
});

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}
function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRepoTreeChildren', () => {
  it('lists children for each expanded path', async () => {
    const { result } = renderHook(
      () => useRepoTreeChildren(['trunk/src'], HEAD, { rootUrl: ROOT }),
      { wrapper: wrapperFor(createClient()) }
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.childrenByPath['trunk/src']).toHaveLength(2);
    expect(result.current.childCountByPath['trunk/src']).toBe(2);
    expect(result.current.errorsByPath['trunk/src']).toBeUndefined();
  });

  it('caps concurrent paths, deferring the oldest beyond the ceiling', async () => {
    const { result } = renderHook(
      () => useRepoTreeChildren(['p1', 'p2', 'p3'], HEAD, { rootUrl: ROOT, maxPaths: 2 }),
      { wrapper: wrapperFor(createClient()) }
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Most-recent two win (p2, p3); p1 is deferred and not fetched.
    expect(result.current.deferredPaths.has('p1')).toBe(true);
    expect(result.current.deferredPaths.has('p2')).toBe(false);
    expect(result.current.deferredPaths.has('p3')).toBe(false);
    expect(result.current.childrenByPath['p2']).toHaveLength(2);
    expect(result.current.childrenByPath['p1']).toBeUndefined();
  });

  it('reports a per-path error without blanking sibling subtrees', async () => {
    mockReadCachedList.mockImplementation((url: string) =>
      url.endsWith('/bad') ? Promise.reject(new Error('svn: E160013')) : ok(url)
    );

    const { result } = renderHook(
      () => useRepoTreeChildren(['trunk/good', 'trunk/bad'], HEAD, { rootUrl: ROOT, maxPaths: 5 }),
      { wrapper: wrapperFor(createClient()) }
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.childrenByPath['trunk/good']).toHaveLength(2);
    expect(result.current.errorsByPath['trunk/bad']).toContain('E160013');
    expect(result.current.childrenByPath['trunk/bad']).toBeUndefined();
  });

  it('does not fetch when disabled or the root url is empty', () => {
    const { result: disabled } = renderHook(
      () => useRepoTreeChildren(['trunk/src'], HEAD, { rootUrl: ROOT, enabled: false }),
      { wrapper: wrapperFor(createClient()) }
    );
    expect(mockReadCachedList).not.toHaveBeenCalled();
    expect(disabled.current.childrenByPath['trunk/src']).toBeUndefined();

    const { result: empty } = renderHook(
      () => useRepoTreeChildren(['trunk/src'], HEAD, { rootUrl: '' }),
      { wrapper: wrapperFor(createClient()) }
    );
    expect(mockReadCachedList).not.toHaveBeenCalled();
    expect(empty.current.childrenByPath['trunk/src']).toBeUndefined();
  });

  it('de-duplicates repeated paths into a single fetch', async () => {
    const { result } = renderHook(
      () => useRepoTreeChildren(['trunk/src', 'trunk/src'], HEAD, { rootUrl: ROOT }),
      { wrapper: wrapperFor(createClient()) }
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockReadCachedList).toHaveBeenCalledTimes(1);
    expect(result.current.childrenByPath['trunk/src']).toHaveLength(2);
  });
});
