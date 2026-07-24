import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIncrementalStatus } from '../src/hooks/useIncrementalStatus';
import { useSvnActions } from '../src/hooks/useSvnActions';

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      confirmDestructiveOps: false,
      integration: {
        shellExtensionEnabled: false,
        iconOverlaysEnabled: false,
      },
    },
  }),
}));

const svnStatus = vi.fn();
const svnUpdateWithProgress = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      svn: {
        status: svnStatus,
        updateWithProgress: svnUpdateWithProgress,
        cancelUpdate: vi.fn(),
        cancelOperation: vi.fn(),
      },
      shell: {
        updateOverlay: vi.fn(),
      },
      notification: {
        show: vi.fn(),
      },
    },
  });
});

describe('background scanning and active SVN operations', () => {
  it('allows explicit SVN operations while a background status scan is pending', async () => {
    let resolveStatus: (value: { path: string; entries: []; revision: number }) => void = () => {};
    svnStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      })
    );
    svnUpdateWithProgress.mockResolvedValue({ success: true, revision: 1234 });

    const { result } = renderHook(
      () => ({
        scan: useIncrementalStatus({ path: '/repo', batchSize: 25 }),
        actions: useSvnActions(),
      }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      void result.current.scan.startScan();
    });

    await waitFor(() => {
      expect(result.current.scan.isScanning).toBe(true);
    });
    expect(svnStatus).toHaveBeenCalledWith('/repo', {
      signal: expect.any(AbortSignal),
    });

    let updateResult: Awaited<ReturnType<ReturnType<typeof useSvnActions>['update']>> | undefined;
    await act(async () => {
      updateResult = await result.current.actions.update('/repo');
    });

    expect(svnUpdateWithProgress).toHaveBeenCalledWith('/repo', expect.any(Function));
    expect(updateResult).toEqual({ success: true, revision: 1234 });
    expect(result.current.scan.isScanning).toBe(true);

    await act(async () => {
      resolveStatus({ path: '/repo', entries: [], revision: 1 });
    });

    await waitFor(() => {
      expect(result.current.scan.progress.phase).toBe('complete');
    });
  });
});
