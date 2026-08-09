import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ElectronAPI, SvnListResult } from '@shared/types';
import { useLazyTreeLoader } from '../../src/hooks/useLazyTreeLoader';

const ROOT_URL = 'https://svn.example.com/large-repo/trunk';
const LARGE_ROOT_ENTRY_COUNT = 20000;
const LARGE_CHILD_ENTRY_COUNT = 5000;
const PREFETCH_DIRECTORY_COUNT = 100;

const PERFORMANCE_TARGETS = {
  INITIAL_ROOT_LOAD_MS: 2500,
  NODE_EXPANSION_MS: 1000,
  PREFETCH_SCHEDULING_MS: 750,
};

const mockSvnList = vi.fn();

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient = createQueryClient()) {
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

function createListResult(path: string, entryCount: number): SvnListResult {
  return {
    path,
    entries: Array.from({ length: entryCount }, (_, index) => {
      const kind = index % 4 === 0 ? 'dir' : 'file';
      const name = `${kind}-${index.toString().padStart(5, '0')}`;

      return {
        name,
        path: `${path}/${name}`,
        url: `${path}/${name}`,
        kind,
        revision: 100000 - index,
        author: `author-${index % 13}`,
        date: '2026-04-30T10:00:00.000000Z',
        ...(kind === 'file' ? { size: 1024 + index } : {}),
      };
    }),
  };
}

function measureTime<T>(fn: () => T): { result: T; durationMs: number } {
  const startedAt = performance.now();
  const result = fn();
  return {
    result,
    durationMs: performance.now() - startedAt,
  };
}

async function measureAsyncTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const startedAt = performance.now();
  const result = await fn();
  return {
    result,
    durationMs: performance.now() - startedAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      svn: {
        list: mockSvnList,
      },
    } as Partial<ElectronAPI>,
  });
});

describe('Repository browser lazy-loading performance benchmarks', () => {
  it('loads a large immediate-depth repository listing within budget', async () => {
    mockSvnList.mockResolvedValue(createListResult(ROOT_URL, LARGE_ROOT_ENTRY_COUNT));

    const { wrapper } = createWrapper();

    const { result, durationMs } = await measureAsyncTime(async () => {
      const hook = renderHook(() => useLazyTreeLoader(ROOT_URL), { wrapper });

      await waitFor(() => {
        expect(hook.result.current.isLoading).toBe(false);
      });

      return hook.result;
    });

    console.log(
      `[PERF] Repo browser root lazy load (${LARGE_ROOT_ENTRY_COUNT} entries): ${durationMs.toFixed(2)}ms`
    );
    expect(result.current.roots).toHaveLength(LARGE_ROOT_ENTRY_COUNT);
    expect(result.current.nodes.size).toBe(LARGE_ROOT_ENTRY_COUNT);
    expect(mockSvnList).toHaveBeenCalledWith(ROOT_URL, undefined, 'immediates', undefined);
    expect(durationMs).toBeLessThan(PERFORMANCE_TARGETS.INITIAL_ROOT_LOAD_MS);
  });

  it('expands a large repository folder on demand within budget', async () => {
    const rootResult = createListResult(ROOT_URL, 1000);
    const firstDirectory = rootResult.entries.find((entry) => entry.kind === 'dir');
    expect(firstDirectory).toBeDefined();

    mockSvnList
      .mockResolvedValueOnce(rootResult)
      .mockResolvedValueOnce(createListResult(firstDirectory!.url, LARGE_CHILD_ENTRY_COUNT));

    const { wrapper } = createWrapper();
    const hook = renderHook(() => useLazyTreeLoader(ROOT_URL), { wrapper });

    await waitFor(() => {
      expect(hook.result.current.isLoading).toBe(false);
    });

    const { durationMs } = await measureAsyncTime(async () => {
      await act(async () => {
        await hook.result.current.loadNode(firstDirectory!.url);
      });

      await waitFor(() => {
        expect(hook.result.current.nodes.get(firstDirectory!.url)?.isLoaded).toBe(true);
      });
    });

    console.log(
      `[PERF] Repo browser node expansion (${LARGE_CHILD_ENTRY_COUNT} children): ${durationMs.toFixed(2)}ms`
    );
    expect(hook.result.current.nodes.size).toBe(1000 + LARGE_CHILD_ENTRY_COUNT);
    expect(mockSvnList).toHaveBeenNthCalledWith(
      2,
      firstDirectory!.url,
      undefined,
      'immediates',
      undefined
    );
    expect(durationMs).toBeLessThan(PERFORMANCE_TARGETS.NODE_EXPANSION_MS);
  });

  it('schedules prefetches for many repository folders without blocking rendering', () => {
    mockSvnList.mockResolvedValue(createListResult(`${ROOT_URL}/prefetched`, 25));

    const { wrapper } = createWrapper();
    const hook = renderHook(() => useLazyTreeLoader(''), { wrapper });
    const directories = createListResult(ROOT_URL, PREFETCH_DIRECTORY_COUNT).entries.filter(
      (entry) => entry.kind === 'dir'
    );

    const { durationMs } = measureTime(() => {
      for (const directory of directories) {
        hook.result.current.prefetchNode(directory.url);
      }
    });

    console.log(
      `[PERF] Repo browser prefetch scheduling (${directories.length} directories): ${durationMs.toFixed(2)}ms`
    );
    expect(mockSvnList).toHaveBeenCalledTimes(directories.length);
    expect(durationMs).toBeLessThan(PERFORMANCE_TARGETS.PREFETCH_SCHEDULING_MS);
  });
});
