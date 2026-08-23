import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchUpdateProvider, useBatchUpdate } from '../BatchUpdateProvider';
import { confirmAppAction } from '@renderer/utils/dialogs';

const testState = vi.hoisted(() => ({
  paths: ['/wc-a', '/wc-b', '/wc-c'] as string[],
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

/**
 * Status/info mocks: BASE 1, HEAD 2 for everything, with `dirtyPaths`
 * controlling which working copies carry local changes.
 */
function successfulReads(dirtyPaths: string[] = []) {
  const svn = window.api.svn;
  vi.mocked(svn.status).mockImplementation(async (path) => ({
    path,
    revision: 1,
    entries: dirtyPaths.includes(path)
      ? [{ path: `${path}/file.txt`, status: 'M', isDirectory: false }]
      : [],
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

function updateResolves() {
  return vi.fn().mockImplementation((path: string) =>
    Object.assign(Promise.resolve({ success: true, revision: 2 }), {
      operationId: `update-${path}`,
    })
  ) as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.paths = ['/wc-a', '/wc-b', '/wc-c'];
  window.api = {
    svn: {
      status: vi.fn(),
      info: vi.fn(),
      infoUrl: vi.fn(),
      log: vi.fn(),
      updateWithProgress: vi.fn(),
      cancelUpdate: vi.fn().mockResolvedValue({ success: true }),
      getActiveWorkingCopyMutations: vi.fn().mockResolvedValue([]),
      onWorkingCopyMutationStateChanged: vi.fn(() => () => undefined),
    },
  } as unknown as Window['api'];
  vi.mocked(confirmAppAction).mockResolvedValue(true);
});

describe('updatePaths (sidebar "Update All" entry point)', () => {
  it('measures only the requested paths and runs the eligible ones', async () => {
    successfulReads();
    const updateWithProgress = updateResolves();
    window.api.svn.updateWithProgress = updateWithProgress;

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.updatePaths(['/wc-a', '/wc-b']));

    expect(updateWithProgress).toHaveBeenCalledTimes(2);
    const updatedPaths = updateWithProgress.mock.calls.map((call) => call[0]);
    expect(updatedPaths).toEqual(['/wc-a', '/wc-b']);
    // The untouched working copy was never measured.
    expect(window.api.svn.info).not.toHaveBeenCalledWith('/wc-c', expect.anything());
    await waitFor(() => expect(result.current.summary.completed).toBe(2));
  });

  it('skips members already at HEAD', async () => {
    successfulReads();
    // /wc-a is at HEAD.
    vi.mocked(window.api.svn.info).mockImplementation(
      async (path) =>
        ({
          path,
          url: `https://example.test/repo/${path.slice(1)}`,
          repositoryRoot: 'https://example.test/repo',
          revision: path === '/wc-a' ? 2 : 1,
        }) as never
    );
    const updateWithProgress = updateResolves();
    window.api.svn.updateWithProgress = updateWithProgress;

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.updatePaths(['/wc-a', '/wc-b']));

    expect(updateWithProgress).toHaveBeenCalledTimes(1);
    expect(updateWithProgress.mock.calls[0][0]).toBe('/wc-b');
  });

  it('asks one confirmation for the whole dirty set and includes them when confirmed', async () => {
    successfulReads(['/wc-a', '/wc-b']);
    const updateWithProgress = updateResolves();
    window.api.svn.updateWithProgress = updateWithProgress;

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.updatePaths(['/wc-a', '/wc-b', '/wc-c']));

    expect(confirmAppAction).toHaveBeenCalledTimes(1);
    expect(confirmAppAction).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Update 2 working copies with local changes?' })
    );
    expect(updateWithProgress).toHaveBeenCalledTimes(3);
  });

  it('excludes dirty members when the confirmation is declined', async () => {
    successfulReads(['/wc-a']);
    vi.mocked(confirmAppAction).mockResolvedValue(false);
    const updateWithProgress = updateResolves();
    window.api.svn.updateWithProgress = updateWithProgress;

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.updatePaths(['/wc-a', '/wc-b']));

    expect(updateWithProgress).toHaveBeenCalledTimes(1);
    expect(updateWithProgress.mock.calls[0][0]).toBe('/wc-b');
  });

  it('does nothing for paths that cannot be measured', async () => {
    const svn = window.api.svn;
    vi.mocked(svn.status).mockResolvedValue({ path: '/wc-a', revision: 1, entries: [] });
    vi.mocked(svn.info).mockRejectedValue(new Error('not a working copy'));
    vi.mocked(svn.infoUrl).mockResolvedValue({ revision: 2 } as never);
    const updateWithProgress = updateResolves();
    window.api.svn.updateWithProgress = updateWithProgress;

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.updatePaths(['/wc-a']));

    expect(updateWithProgress).not.toHaveBeenCalled();
    expect(result.current.items.find((item) => item.path === '/wc-a')?.blockedKind).toBe('missing');
  });

  it('refuses to start while a batch is already in flight', async () => {
    successfulReads();
    let finish!: (result: unknown) => void;
    window.api.svn.updateWithProgress = vi.fn().mockImplementation(
      () =>
        Object.assign(
          new Promise((resolve) => {
            finish = resolve;
          }),
          { operationId: 'update-busy' }
        )
    ) as never;

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    let first!: Promise<void>;
    act(() => {
      first = result.current.updatePaths(['/wc-a']);
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('running'));
    await act(async () => result.current.updatePaths(['/wc-b']));
    expect(window.api.svn.updateWithProgress).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ success: true, revision: 2 });
      await first;
    });
  });
});

describe('updateAll', () => {
  it('covers every configured working copy', async () => {
    successfulReads();
    const updateWithProgress = updateResolves();
    window.api.svn.updateWithProgress = updateWithProgress;

    const { result } = renderHook(() => useBatchUpdate(), { wrapper: wrapper() });
    await act(async () => result.current.updateAll());

    expect(updateWithProgress).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.summary.completed).toBe(3));
  });
});
