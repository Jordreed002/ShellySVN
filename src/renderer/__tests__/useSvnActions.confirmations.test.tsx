import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseSettings = vi.fn();
const mockConfirmAppAction = vi.fn();

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings(),
}));

vi.mock('../src/utils/dialogs', () => ({
  confirmAppAction: (...args: unknown[]) => mockConfirmAppAction(...args),
  promptAppInput: vi.fn(),
}));

import { useFileExplorerActions, useSvnActions } from '../src/hooks/useSvnActions';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSvnActions risky action confirmations', () => {
  const svnApi = {
    update: vi.fn().mockResolvedValue({ success: true }),
    commit: vi.fn().mockResolvedValue({ success: true, revision: 42 }),
    revert: vi.fn().mockResolvedValue({ success: true }),
    add: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    cleanup: vi.fn().mockResolvedValue({ success: true }),
    lock: vi.fn().mockResolvedValue({ success: true }),
    resolve: vi.fn().mockResolvedValue({ success: true }),
    unlock: vi.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSettings.mockReturnValue({
      settings: {
        confirmDestructiveOps: true,
        integration: {
          shellExtensionEnabled: false,
          iconOverlaysEnabled: false,
        },
      },
    });
    mockConfirmAppAction.mockResolvedValue(true);
    window.api = {
      svn: svnApi,
      shell: { updateOverlay: vi.fn() },
    } as unknown as Window['api'];
  });

  it('cancels risky operations before calling SVN when confirmation is rejected', async () => {
    mockConfirmAppAction.mockResolvedValue(false);
    const { result } = renderHook(() => useSvnActions(), { wrapper: createWrapper() });

    let response: Awaited<ReturnType<typeof result.current.revert>> | undefined;
    await act(async () => {
      response = await result.current.revert(['C:\\wc\\file.txt']);
    });

    expect(response).toEqual({ success: false, message: 'Revert cancelled' });
    expect(svnApi.revert).not.toHaveBeenCalled();
  });

  it('confirms revert, delete, cleanup, force unlock, and resolve before running SVN', async () => {
    const { result } = renderHook(() => useSvnActions(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.revert(['C:\\wc\\file.txt']);
      await result.current.delete(['C:\\wc\\file.txt']);
      await result.current.cleanup('C:\\wc');
      await result.current.unlock('C:\\wc\\file.txt', true);
      await result.current.resolve('C:\\wc\\file.txt', 'mine-full');
    });

    expect(mockConfirmAppAction).toHaveBeenCalledTimes(5);
    expect(svnApi.revert).toHaveBeenCalledWith(['C:\\wc\\file.txt']);
    expect(svnApi.delete).toHaveBeenCalledWith(['C:\\wc\\file.txt']);
    expect(svnApi.cleanup).toHaveBeenCalledWith('C:\\wc');
    expect(svnApi.unlock).toHaveBeenCalledWith('C:\\wc\\file.txt', true);
    expect(svnApi.resolve).toHaveBeenCalledWith('C:\\wc\\file.txt', 'mine-full');
  });

  it('skips confirmations when destructive confirmations are disabled', async () => {
    mockUseSettings.mockReturnValue({
      settings: {
        confirmDestructiveOps: false,
        integration: {
          shellExtensionEnabled: false,
          iconOverlaysEnabled: false,
        },
      },
    });
    const { result } = renderHook(() => useSvnActions(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.delete(['C:\\wc\\file.txt']);
    });

    expect(mockConfirmAppAction).not.toHaveBeenCalled();
    expect(svnApi.delete).toHaveBeenCalledWith(['C:\\wc\\file.txt']);
  });

  it('returns a structured failure when SVN actions throw', async () => {
    svnApi.update.mockRejectedValueOnce(new Error('svn update failed'));
    const { result } = renderHook(() => useSvnActions(), { wrapper: createWrapper() });

    let response: Awaited<ReturnType<typeof result.current.update>> | undefined;
    await act(async () => {
      response = await result.current.update('C:\\wc');
    });

    expect(response).toEqual({ success: false, message: 'svn update failed' });
    expect(result.current.lastError).toBe('svn update failed');
  });

  it('returns a structured failure when SVN reports unsuccessful results', async () => {
    svnApi.commit.mockResolvedValueOnce({ success: false });
    const { result } = renderHook(() => useSvnActions(), { wrapper: createWrapper() });

    let response: Awaited<ReturnType<typeof result.current.commit>> | undefined;
    await act(async () => {
      response = await result.current.commit(['C:\\wc\\file.txt'], 'message');
    });

    expect(response).toEqual({ success: false, message: 'Commit failed' });
  });

  it('reports committed revision and refreshes status after successful file explorer commits', async () => {
    svnApi.commit.mockResolvedValueOnce({ success: true, revision: 123 });
    const onRefresh = vi.fn();
    const { result } = renderHook(
      () => useFileExplorerActions('C:\\wc', null, onRefresh, new Set()),
      { wrapper: createWrapper() }
    );

    let response: Awaited<ReturnType<typeof result.current.handleSubmitCommit>> | undefined;
    await act(async () => {
      response = await result.current.handleSubmitCommit(['C:\\wc\\file.txt'], 'message');
    });

    expect(response).toEqual({ success: true, revision: 123 });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('refreshes file explorer status after resolving a selected conflict', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(
      () =>
        useFileExplorerActions(
          'C:\\wc',
          {
            path: 'C:\\wc\\conflict.txt',
            name: 'conflict.txt',
            status: 'C',
            isDirectory: false,
          },
          onRefresh
        ),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.handleResolveSelected('mine-full');
    });

    expect(svnApi.resolve).toHaveBeenCalledWith('C:\\wc\\conflict.txt', 'mine-full');
    expect(onRefresh).toHaveBeenCalled();
  });
});
