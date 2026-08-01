/**
 * Coverage for the branch-list hook (Layer B). Previously untested (0%), this
 * drives the SVN list → branch/tag derivation, the not-found tolerance, the
 * persisted-store seed + write-back, the disabled state, and the invalidator.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

import { useBranchList, useInvalidateBranches } from '../useBranches';
import type { SvnListResult, ElectronAPI } from '@shared/types';

const mockSvnList = vi.fn();
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();

const ROOT = 'https://svn.example.com/repo';

function listResult(
  url: string,
  entries: Array<{ name: string; kind: 'file' | 'dir'; revision?: number }>
): SvnListResult {
  return {
    path: url,
    entries: entries.map((entry) => ({
      name: entry.name,
      path: `${url}/${entry.name}`,
      url: `${url}/${entry.name}`,
      kind: entry.kind,
      revision: entry.revision ?? 1,
      author: 'alice',
      date: '2024-01-01',
      ...(entry.kind === 'file' ? { size: 10 } : {}),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreGet.mockResolvedValue(undefined);
  mockStoreSet.mockResolvedValue(undefined);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      svn: { list: mockSvnList },
      store: { get: mockStoreGet, set: mockStoreSet },
    } as Partial<ElectronAPI>,
  });
});

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useBranchList', () => {
  it('fetches branches and tags, deriving trunkUrl and the youngest revision', async () => {
    mockSvnList.mockImplementation((url: string) => {
      if (url.endsWith('/branches'))
        return Promise.resolve(listResult(`${ROOT}/branches`, [{ name: 'feature', kind: 'dir', revision: 42 }]));
      if (url.endsWith('/tags'))
        return Promise.resolve(listResult(`${ROOT}/tags`, [{ name: 'v1', kind: 'dir', revision: 7 }]));
      return Promise.reject(new Error('unexpected url'));
    });

    const { result } = renderHook(() => useBranchList(ROOT), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({ trunkUrl: `${ROOT}/trunk`, youngestRev: 42 });
    expect(result.current.data?.branches).toHaveLength(1);
    expect(result.current.data?.tags).toHaveLength(1);
    expect(result.current.data?.branches[0]).toMatchObject({ name: 'feature', revision: 42, author: 'alice' });
  });

  it('keeps only directories, dropping files', async () => {
    mockSvnList.mockImplementation((url: string) => {
      if (url.endsWith('/branches'))
        return Promise.resolve(
          listResult(`${ROOT}/branches`, [
            { name: 'feature', kind: 'dir' },
            { name: 'README.md', kind: 'file' },
          ])
        );
      return Promise.resolve(listResult(url.endsWith('/tags') ? `${ROOT}/tags` : url, []));
    });

    const { result } = renderHook(() => useBranchList(ROOT), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.branches.map((b) => b.name)).toEqual(['feature']);
    expect(result.current.data?.tags).toEqual([]);
  });

  it('treats a missing branches/tags directory (not-found) as empty rather than erroring', async () => {
    mockSvnList.mockResolvedValue({ error: 'not found', commandError: { category: 'not-found' } });

    const { result } = renderHook(() => useBranchList(ROOT), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ branches: [], tags: [], youngestRev: 0 });
  });

  it('surfaces non-not-found errors as a query failure', async () => {
    mockSvnList.mockResolvedValue({ error: 'network down', commandError: { category: 'network' } });

    const { result } = renderHook(() => useBranchList(ROOT), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('does not fetch when no branch root url is given', () => {
    renderHook(() => useBranchList(null), { wrapper: wrapperFor(createTestQueryClient()) });

    expect(mockSvnList).not.toHaveBeenCalled();
    expect(mockStoreGet).not.toHaveBeenCalled();
  });

  it('seeds the cache from the persisted store for instant display', async () => {
    const persisted = { trunkUrl: `${ROOT}/trunk`, branches: [], tags: [], youngestRev: 99 };
    mockStoreGet.mockResolvedValue(persisted);
    // Keep the network fetch pending so the seeded value is what we observe.
    mockSvnList.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useBranchList(ROOT), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toEqual(persisted));
    expect(mockStoreGet).toHaveBeenCalledWith(`shellysvn:branches:${ROOT}`);
  });

  it('writes a successful fetch back to the persisted store', async () => {
    mockSvnList.mockImplementation((url: string) =>
      Promise.resolve(
        listResult(url, url.endsWith('/branches') ? [{ name: 'feature', kind: 'dir' }] : [])
      )
    );

    const { result } = renderHook(() => useBranchList(ROOT), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(mockStoreSet).toHaveBeenCalledWith(
        `shellysvn:branches:${ROOT}`,
        expect.objectContaining({ trunkUrl: `${ROOT}/trunk` })
      )
    );
  });
});

describe('useInvalidateBranches', () => {
  it('invalidates the branch-root query, triggering a refetch', async () => {
    mockSvnList.mockImplementation((url: string) => Promise.resolve(listResult(url, [])));
    const queryClient = createTestQueryClient();
    const wrapper = wrapperFor(queryClient);

    const { result: branchResult } = renderHook(() => useBranchList(ROOT), { wrapper });
    await waitFor(() => expect(branchResult.current.isSuccess).toBe(true));
    expect(mockSvnList).toHaveBeenCalledTimes(2); // branches + tags

    const { result: invalidate } = renderHook(() => useInvalidateBranches(), { wrapper });
    act(() => {
      invalidate.current(ROOT);
    });

    await waitFor(() => expect(mockSvnList).toHaveBeenCalledTimes(4)); // refetch branches + tags
  });
});
