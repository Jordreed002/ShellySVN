import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchUpdateProvider, useBatchUpdate } from '../BatchUpdateProvider';

const testState = vi.hoisted(() => ({
  paths: ['/wc-a', '/wc-b', '/wc-c'],
  mutationListener: null as ((paths: string[]) => void) | null,
}));

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { recentRepositories: testState.paths } }),
}));

vi.mock('@renderer/utils/dialogs', () => ({
  confirmAppAction: vi.fn().mockResolvedValue(true),
}));

vi.mock('@renderer/utils/mutationInvalidation', () => ({
  invalidateAfterSvnMutation: vi.fn().mockResolvedValue(undefined),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <BatchUpdateProvider>{children}</BatchUpdateProvider>
      </QueryClientProvider>
    );
  };
}

function successfulReads() {
  const svn = window.api.svn;
  vi.mocked(svn.status).mockImplementation(async (path) => ({
    path,
    revision: 1,
    entries: [],
  }));
  vi.mocked(svn.info).mockImplementation(
    async (path) =>
      ({
        path,
        url: `https://example.test/repo/${path.slice(1)}`,
        repositoryRoot: 'https://example.test/repo',
        revision: 1,
      }) as never
  );
  vi.mocked(svn.infoUrl).mockResolvedValue({ revision: 2 } as never);
  vi.mocked(svn.log).mockResolvedValue({ entries: [{ revision: 2 }] } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.paths = ['/wc-a', '/wc-b', '/wc-c'];
  testState.mutationListener = null;
  window.api = {
    svn: {
      status: vi.fn(),
      info: vi.fn(),
      infoUrl: vi.fn(),
      log: vi.fn(),
      updateWithProgress: vi.fn(),
      cancelUpdate: vi.fn().mockResolvedValue({ success: true }),
      getActiveWorkingCopyMutations: vi.fn().mockResolvedValue([]),
      onWorkingCopyMutationStateChanged: vi.fn((listener) => {
        testState.mutationListener = listener;
        return () => undefined;
      }),
    },
  } as unknown as Window['api'];
  successfulReads();
});

describe('BatchUpdateProvider', () => {
  it('starts queued updates immediately and never exceeds two concurrent operations', async () => {
    let active = 0;
    let peak = 0;
    const updated = new Set<string>();
    const resolvers = new Map<string, (result: unknown) => void>();
    vi.mocked(window.api.svn.info).mockImplementation(
      async (path) =>
        ({
          path,
          url: `https://example.test/repo/${path.slice(1)}`,
          repositoryRoot: 'https://example.test/repo',
          revision: updated.has(path) ? 2 : 1,
        }) as never
    );
    vi.mocked(window.api.svn.updateWithProgress).mockImplementation((path) => {
      active += 1;
      peak = Math.max(peak, active);
      const operation = new Promise((resolve) =>
        resolvers.set(path, (value) => {
          updated.add(path);
          resolve(value);
        })
      ).finally(() => {
        active -= 1;
      });
      return Object.assign(operation, { operationId: `update-${path}` }) as never;
    });

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.checkAll());
    expect(result.current.summary.selected).toBe(3);

    let batch!: Promise<void>;
    act(() => {
      batch = result.current.startSelected();
    });
    await waitFor(() => expect(window.api.svn.updateWithProgress).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);

    await act(async () => {
      resolvers.get('/wc-a')?.({ success: true, revision: 2 });
    });
    await waitFor(() => expect(window.api.svn.updateWithProgress).toHaveBeenCalledTimes(3));
    await act(async () => {
      resolvers.get('/wc-b')?.({ success: true, revision: 2 });
      resolvers.get('/wc-c')?.({ success: true, revision: 2 });
      await batch;
    });

    expect(peak).toBe(2);
    expect(result.current.summary.completed).toBe(3);
    expect(result.current.items.every((entry) => entry.incomingCount === 0)).toBe(true);
  });

  it('keeps a cancelled operation active until the child reports cancellation', async () => {
    testState.paths = ['/wc-a'];
    let finish!: (result: unknown) => void;
    vi.mocked(window.api.svn.updateWithProgress).mockImplementation(() => {
      const operation = new Promise((resolve) => {
        finish = resolve;
      });
      return Object.assign(operation, { operationId: 'update-target' }) as never;
    });

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.checkAll());
    act(() => void result.current.startSelected());
    await waitFor(() => expect(result.current.items[0].status).toBe('running'));

    await act(async () => result.current.cancelItem('/wc-a'));
    expect(window.api.svn.cancelUpdate).toHaveBeenCalledWith('update-target');
    expect(result.current.items[0]).toMatchObject({
      status: 'running',
      cancellationRequested: true,
    });

    await act(async () =>
      finish({ success: false, revision: null, error: 'SVN update cancelled' })
    );
    await waitFor(() => expect(result.current.items[0].status).toBe('cancelled'));
  });

  it('requires a new measurement after an external mutation completes', async () => {
    testState.paths = ['/wc-a'];
    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.checkAll());
    expect(result.current.items[0].selected).toBe(true);

    act(() => testState.mutationListener?.(['/wc-a/src/file.ts', '/wc-a']));
    expect(result.current.items[0]).toMatchObject({ status: 'blocked', selected: false });
    act(() => testState.mutationListener?.([]));
    expect(result.current.items[0]).toMatchObject({
      status: 'idle',
      selected: false,
      baseRevision: undefined,
      headRevision: undefined,
    });
  });

  it('accepts revision zero as a measured BASE and HEAD', async () => {
    testState.paths = ['/wc-a'];
    vi.mocked(window.api.svn.info).mockResolvedValue({
      path: '/wc-a',
      url: 'https://example.test/repo',
      repositoryRoot: 'https://example.test/repo',
      revision: 0,
    } as never);
    vi.mocked(window.api.svn.infoUrl).mockResolvedValue({ revision: 0 } as never);

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.checkAll());
    expect(result.current.items[0]).toMatchObject({
      baseRevision: 0,
      headRevision: 0,
      blockedKind: 'at-head',
      status: 'ready',
    });
  });

  it('hard-blocks a conflict created by an otherwise successful update', async () => {
    testState.paths = ['/wc-a'];
    let updated = false;
    vi.mocked(window.api.svn.status).mockImplementation(async (path) => ({
      path,
      revision: updated ? 2 : 1,
      entries: updated ? [{ path: `${path}/file.txt`, status: 'C', isDirectory: false }] : [],
    }));
    vi.mocked(window.api.svn.info).mockImplementation(
      async (path) =>
        ({
          path,
          url: 'https://example.test/repo',
          repositoryRoot: 'https://example.test/repo',
          revision: updated ? 2 : 1,
        }) as never
    );
    vi.mocked(window.api.svn.updateWithProgress).mockImplementation(() => {
      updated = true;
      return Object.assign(Promise.resolve({ success: true, revision: 2 }), {
        operationId: 'update-conflict',
      }) as never;
    });

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.checkAll());
    await act(async () => result.current.startSelected());

    expect(result.current.items[0]).toMatchObject({
      status: 'blocked',
      blockedKind: 'conflicted',
      selected: false,
    });
    await act(async () => result.current.retryFailed());
    expect(window.api.svn.updateWithProgress).toHaveBeenCalledOnce();
  });
});
