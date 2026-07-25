import { createElement, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { SvnStatusChar } from '@shared/types';
import { getStatusDisplay, useIncrementalStatus } from '../useIncrementalStatus';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('getStatusDisplay', () => {
  it('returns display metadata for every SVN status character', () => {
    const expectedLabels: Record<SvnStatusChar, string> = {
      ' ': 'Normal',
      A: 'Added',
      C: 'Conflicted',
      D: 'Deleted',
      I: 'Ignored',
      M: 'Modified',
      R: 'Replaced',
      X: 'External',
      '?': 'Unversioned',
      '!': 'Missing',
      '~': 'Obstructed',
      O: 'Remote Only',
    };

    for (const [status, label] of Object.entries(expectedLabels)) {
      expect(getStatusDisplay(status as SvnStatusChar)).toEqual(expect.objectContaining({ label }));
    }
  });
});

describe('useIncrementalStatus', () => {
  it('invalidates fs status caches without writing incompatible data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const setQueryData = vi.spyOn(queryClient, 'setQueryData');
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const status = vi.fn().mockResolvedValue({
      entries: [{ path: 'C:/repo/file.txt', status: 'M', isDirectory: false }],
      startRevision: 1,
      endRevision: 1,
    });
    window.api = { svn: { status } } as unknown as Window['api'];

    const { result } = renderHook(() => useIncrementalStatus({ path: 'C:/repo' }), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.startScan();
    });
    await waitFor(() => expect(result.current.progress.phase).toBe('complete'));

    expect(setQueryData).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['fs:getStatus', 'C:/repo'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['fs:getDeepStatus', 'C:/repo'],
    });
  });

  it('keeps startScan stable when the update callback changes', () => {
    const queryClient = new QueryClient();
    const firstUpdate = vi.fn();
    const { result, rerender } = renderHook(
      ({ onUpdate }) => useIncrementalStatus({ path: 'C:/repo', onUpdate }),
      {
        initialProps: { onUpdate: firstUpdate },
        wrapper: createWrapper(queryClient),
      }
    );
    const initialStartScan = result.current.startScan;

    rerender({ onUpdate: vi.fn() });

    expect(result.current.startScan).toBe(initialStartScan);
  });
});
