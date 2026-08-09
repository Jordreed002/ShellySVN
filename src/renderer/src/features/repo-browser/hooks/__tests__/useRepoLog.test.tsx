/**
 * Coverage for useRepoLog (was 22% functions). The pure issue-reference
 * helpers are exercised directly; the hook is driven via renderHook to cover
 * entry mapping + de-dup, the partial flag, bugtraq issue resolution, auth vs
 * generic errors, paging, and the disabled/empty gate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

import type { ElectronAPI } from '@shared/types';
import { buildBugtraqUrl, extractIssueReference, useRepoLog } from '../useRepoLog';

describe('extractIssueReference', () => {
  it('returns undefined when there is no logregex', () => {
    expect(extractIssueReference('fixes #42', null)).toBeUndefined();
    expect(extractIssueReference('fixes #42', undefined)).toBeUndefined();
    expect(extractIssueReference('fixes #42', '  \n  ')).toBeUndefined();
  });

  it('extracts via a single capture-group regex', () => {
    expect(extractIssueReference('Fixes #42', '#(\\d+)')).toBe('42');
  });

  it('falls back to the whole match when there is no capture group', () => {
    expect(extractIssueReference('ISSUE-42', 'ISSUE-\\d+')).toBe('ISSUE-42');
  });

  it('uses the two-regex form: find the block, then the id inside it', () => {
    const logregex = '\\[([^\\]]+)\\]\n([A-Z]+-\\d+)';
    const id = extractIssueReference('Refs: [JIRA-100, JIRA-200]', logregex);
    expect(id).toBe('JIRA-100');
  });

  it('returns undefined when the pattern does not match', () => {
    expect(extractIssueReference('nothing here', '#(\\d+)')).toBeUndefined();
  });

  it('returns undefined for a malformed regex instead of throwing', () => {
    expect(extractIssueReference('x', '(?:')).toBeUndefined();
  });
});

describe('buildBugtraqUrl', () => {
  it('returns null without a template', () => {
    expect(buildBugtraqUrl(null, '42')).toBeNull();
  });

  it('substitutes and URL-encodes the issue id', () => {
    expect(buildBugtraqUrl('https://t/%BUGID%', 'a b')).toBe('https://t/a%20b');
  });
});

const mockLog = vi.fn();
const mockPropget = vi.fn();

interface RawEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  paths?: string[];
}
function page(entries: RawEntry[], partial = false) {
  return { entries, partial };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPropget.mockResolvedValue({ value: '' });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { svn: { log: mockLog, propget: mockPropget } } as Partial<ElectronAPI>,
  });
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

const URL = 'https://svn.example.com/repo/trunk';
const HEAD = { kind: 'head' } as const;

describe('useRepoLog hook', () => {
  it('maps log entries and counts changed paths', async () => {
    mockLog.mockResolvedValueOnce(
      page([
        { revision: 3, author: 'a', date: 'd3', message: 'r3' },
        { revision: 2, author: 'b', date: 'd2', message: 'r2' },
      ])
    );

    const { result } = renderHook(() => useRepoLog(URL, HEAD, { pageSize: 100 }), {
      wrapper: wrapperFor(createClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries.map((e) => e.revision)).toEqual([3, 2]);
    expect(result.current.entries[0]).toMatchObject({ author: 'a', changedPaths: 0 });
    expect(result.current.partial).toBe(false);
  });

  it('surfaces a partial flag from a truncated page', async () => {
    mockLog.mockResolvedValueOnce(
      page([{ revision: 5, author: 'a', date: 'd', message: 'm', paths: ['f1', 'f2'] }], true)
    );

    const { result } = renderHook(() => useRepoLog(URL, HEAD), {
      wrapper: wrapperFor(createClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries[0].changedPaths).toBe(2);
    expect(result.current.partial).toBe(true);
  });

  it('attaches an issue reference when a bugtraq logregex resolves', async () => {
    mockPropget.mockImplementation(async (_url: string, name: string) => ({
      value: name === 'bugtraq:logregex' ? '#(\\d+)' : '',
    }));
    mockLog.mockResolvedValueOnce(
      page([{ revision: 1, author: 'a', date: 'd', message: 'Fixes #7' }])
    );

    const { result } = renderHook(() => useRepoLog(URL, HEAD), {
      wrapper: wrapperFor(createClient()),
    });

    await waitFor(() => expect(result.current.entries.length).toBe(1));
    expect(result.current.entries[0].issue).toBe('7');
  });

  it('surfaces an auth error as needsAuth and suppresses the generic message', async () => {
    mockLog.mockRejectedValue(new Error('svn: Authentication required'));

    const { result } = renderHook(() => useRepoLog(URL, HEAD), {
      wrapper: wrapperFor(createClient()),
    });

    await waitFor(() => expect(result.current.needsAuth).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('surfaces a non-auth error as a message', async () => {
    mockLog.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useRepoLog(URL, HEAD), {
      wrapper: wrapperFor(createClient()),
    });

    await waitFor(() => expect(result.current.error).toBe('network down'));
    expect(result.current.needsAuth).toBe(false);
  });

  it('does not fetch when disabled or the url is empty', () => {
    renderHook(() => useRepoLog(URL, HEAD, { enabled: false }), {
      wrapper: wrapperFor(createClient()),
    });
    renderHook(() => useRepoLog('', HEAD), { wrapper: wrapperFor(createClient()) });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('fetches the next page and de-duplicates the overlapping revision', async () => {
    mockLog.mockResolvedValueOnce(
      page([
        { revision: 4, author: 'a', date: 'd', message: 'r4' },
        { revision: 3, author: 'b', date: 'd', message: 'r3' },
      ])
    );

    const { result } = renderHook(() => useRepoLog(URL, HEAD, { pageSize: 2 }), {
      wrapper: wrapperFor(createClient()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasNextPage).toBe(true);

    // Page 2 overlaps r3 (page boundaries can overlap by one).
    mockLog.mockResolvedValueOnce(
      page([
        { revision: 3, author: 'b', date: 'd', message: 'r3' },
        { revision: 2, author: 'c', date: 'd', message: 'r2' },
      ])
    );
    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.entries.map((e) => e.revision)).toEqual([4, 3, 2]));
  });

  it('reports build status as an unsupported capability', async () => {
    mockLog.mockResolvedValueOnce(page([]));

    const { result } = renderHook(() => useRepoLog(URL, HEAD), {
      wrapper: wrapperFor(createClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unsupported.some((u) => u.capability === 'log:build-status')).toBe(true);
  });
});
