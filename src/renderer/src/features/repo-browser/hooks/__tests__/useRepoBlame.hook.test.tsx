/**
 * Coverage for the useRepoBlame hook body. The sibling useRepoBlame.test.ts
 * covers the pure toBlameLine mapper; this drives the live hook: line mapping +
 * uncommitted count, partial flag, resolved vs thrown errors, auth detection,
 * the disabled/empty-url gate, and refetch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

import type { SvnBlameLine, ElectronAPI } from '@shared/types';
import { useRepoBlame } from '../useRepoBlame';

const mockBlame = vi.fn();
const URL = 'https://svn.example.com/repo/trunk/file.ts';

function blameLine(overrides: Partial<SvnBlameLine>): SvnBlameLine {
  return { revision: 0, author: 'unknown', date: '', lineNumber: 1, content: 'x', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { svn: { blame: mockBlame } } as Partial<ElectronAPI>,
  });
});

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
}
function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRepoBlame hook', () => {
  it('maps committed and uncommitted lines and counts the uncommitted', async () => {
    mockBlame.mockResolvedValue({
      lines: [
        blameLine({ revision: 42, author: 'alice', date: '2024-01-01', lineNumber: 1, content: 'a' }),
        blameLine({ revision: 0, author: 'unknown', lineNumber: 2, content: 'b' }),
        blameLine({ revision: 7, author: 'bob', date: '2024-01-02', lineNumber: 3, content: 'c' }),
      ],
    });

    const { result } = renderHook(() => useRepoBlame(URL), { wrapper: wrapperFor(createClient()) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lines).toEqual([
      { revision: 42, author: 'alice', date: '2024-01-01', lineNumber: 1, content: 'a' },
      { revision: null, author: '', date: '', lineNumber: 2, content: 'b' },
      { revision: 7, author: 'bob', date: '2024-01-02', lineNumber: 3, content: 'c' },
    ]);
    expect(result.current.uncommittedCount).toBe(1);
    expect(result.current.error).toBeNull();
    expect(result.current.partial).toBe(false);
  });

  it('surfaces a partial annotation flag', async () => {
    mockBlame.mockResolvedValue({ lines: [], partial: true });

    const { result } = renderHook(() => useRepoBlame(URL), { wrapper: wrapperFor(createClient()) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.partial).toBe(true);
    expect(result.current.lines).toEqual([]);
  });

  it('reports a resolved SVN error field and keeps lines empty', async () => {
    mockBlame.mockResolvedValue({ lines: [], error: 'svn: E160013: path not found' });

    const { result } = renderHook(() => useRepoBlame(URL), { wrapper: wrapperFor(createClient()) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('svn: E160013: path not found');
    expect(result.current.lines).toEqual([]);
    expect(result.current.needsAuth).toBe(false);
  });

  it('reports a thrown query error via describeError', async () => {
    mockBlame.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useRepoBlame(URL), { wrapper: wrapperFor(createClient()) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network down');
    expect(result.current.needsAuth).toBe(false);
  });

  it('flags an authentication failure and suppresses the generic error', async () => {
    mockBlame.mockResolvedValue({ lines: [], error: 'svn: E215004: Authentication required' });

    const { result } = renderHook(() => useRepoBlame(URL), { wrapper: wrapperFor(createClient()) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.needsAuth).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when disabled or the url is empty', () => {
    const { result: disabled } = renderHook(() => useRepoBlame(URL, { enabled: false }), {
      wrapper: wrapperFor(createClient()),
    });
    expect(mockBlame).not.toHaveBeenCalled();
    expect(disabled.current.loading).toBe(false);

    const { result: empty } = renderHook(() => useRepoBlame('', { enabled: true }), {
      wrapper: wrapperFor(createClient()),
    });
    expect(mockBlame).not.toHaveBeenCalled();
    expect(empty.current.lines).toEqual([]);
  });

  it('refetches the blame annotation', async () => {
    mockBlame.mockResolvedValue({ lines: [blameLine({ revision: 1, lineNumber: 1, content: 'a' })] });

    const { result } = renderHook(() => useRepoBlame(URL), { wrapper: wrapperFor(createClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockBlame).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(mockBlame).toHaveBeenCalledTimes(2));
  });
});
