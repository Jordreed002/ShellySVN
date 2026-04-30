import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SvnStatusEntry } from '@shared/types';
import { useFolderSizes } from '../src/hooks/useFolderSizes';
import { useIncrementalStatus } from '../src/hooks/useIncrementalStatus';

const getFolderSizes = vi.fn();
const svnStatus = vi.fn();

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

function entry(path: string, overrides: Partial<SvnStatusEntry> = {}): SvnStatusEntry {
  return {
    path,
    status: ' ',
    isDirectory: true,
    ...overrides,
  };
}

function FolderSizeProbe({ entries }: { entries: SvnStatusEntry[] }) {
  const { isLoadingFolderSizes } = useFolderSizes(entries, true);

  return (
    <div>
      <span>rendered</span>
      <span>{isLoadingFolderSizes ? 'scanning' : 'idle'}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: {
        getFolderSizes,
      },
      svn: {
        status: svnStatus,
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('non-blocking scan behavior', () => {
  it('renders while folder-size scans are still pending', async () => {
    let resolveSizes: (sizes: Record<string, number>) => void = () => {};
    getFolderSizes.mockReturnValue(
      new Promise<Record<string, number>>((resolve) => {
        resolveSizes = resolve;
      })
    );
    const entries = Array.from({ length: 500 }, (_, index) => entry(`/repo/folder-${index}`));

    const startedAt = performance.now();
    render(<FolderSizeProbe entries={entries} />, { wrapper: createWrapper() });
    const renderDurationMs = performance.now() - startedAt;

    expect(screen.getByText('rendered')).toBeInTheDocument();
    expect(renderDurationMs).toBeLessThan(100);

    await waitFor(() => {
      expect(getFolderSizes).toHaveBeenCalled();
      expect(screen.getByText('scanning')).toBeInTheDocument();
    });

    resolveSizes({ '/repo/folder-0': 100 });

    await waitFor(() => {
      expect(screen.getByText('idle')).toBeInTheDocument();
    });
  });

  it('yields intermediate status-scan progress before completing large batches', async () => {
    const entries = Array.from({ length: 300 }, (_, index) =>
      entry(`/repo/file-${index}.ts`, {
        isDirectory: false,
        status: index % 2 === 0 ? 'M' : ' ',
      })
    );
    svnStatus.mockResolvedValue({ path: '/repo', entries, revision: 1 });
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const wrapper = createWrapper();
    const onUpdate = vi.fn();

    const { result } = renderHook(
      () =>
        useIncrementalStatus({
          path: '/repo',
          batchSize: 100,
          onUpdate,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.startScan();
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'progress',
        progress: expect.objectContaining({ filesScanned: 100 }),
      })
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(result.current.progress.phase).toBe('complete');
    expect(result.current.result?.entries).toHaveLength(300);
  });
});
