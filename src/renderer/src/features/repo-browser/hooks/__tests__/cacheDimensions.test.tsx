import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoListDepth } from '../useRepoListing';
import { useRepoListing } from '../useRepoListing';
import { useRepoProperties } from '../useRepoProperties';

const URL = 'https://svn.example.com/repo/trunk';
const PEG = { kind: 'head' } as const;

const proplist = vi.fn();
const listFn = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  proplist.mockImplementation(
    async (_url: string, options: { showInherited?: boolean } | undefined) => ({
      properties: [
        {
          name: 'custom:mode',
          value: options?.showInherited ? 'inherited' : 'local',
          inherited: options?.showInherited === true,
        },
      ],
    })
  );
  listFn.mockImplementation(
    async (_url: string, _revision: string, depth: RepoListDepth) => ({
      path: URL,
      entries: [
        {
          name: `${depth}.txt`,
          path: `${URL}/${depth}.txt`,
          url: `${URL}/${depth}.txt`,
          kind: 'file',
          revision: 1,
          author: 'dev',
          date: '2026-01-01T00:00:00Z',
        },
      ],
    })
  );

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { svn: { proplist } },
  });
});

describe('repository-browser query cache dimensions', () => {
  it('refetches properties when inherited-property visibility changes', async () => {
    const { result, rerender } = renderHook(
      ({ showInherited }) => useRepoProperties(URL, PEG, { showInherited }),
      {
        initialProps: { showInherited: false },
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => expect(result.current.properties[0]?.value).toBe('local'));
    expect(proplist).toHaveBeenCalledTimes(1);

    rerender({ showInherited: true });

    await waitFor(() => expect(result.current.properties[0]?.value).toBe('inherited'));
    expect(proplist).toHaveBeenCalledTimes(2);
    expect(proplist).toHaveBeenLastCalledWith(URL, {
      revision: 'HEAD',
      showInherited: true,
    });
  });

  it('refetches repository listings when depth changes', async () => {
    const { result, rerender } = renderHook(
      ({ depth }) => useRepoListing(URL, PEG, { depth, listFn }),
      {
        initialProps: { depth: 'empty' as RepoListDepth },
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => expect(result.current.entries[0]?.name).toBe('empty.txt'));
    expect(listFn).toHaveBeenCalledTimes(1);

    rerender({ depth: 'infinity' });

    await waitFor(() => expect(result.current.entries[0]?.name).toBe('infinity.txt'));
    expect(listFn).toHaveBeenCalledTimes(2);
    expect(listFn).toHaveBeenLastCalledWith(URL, 'HEAD', 'infinity', undefined);
  });
});
