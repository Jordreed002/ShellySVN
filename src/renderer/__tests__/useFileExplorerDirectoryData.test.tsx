import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileExplorerDirectoryData } from '../src/components/files/useFileExplorerDirectoryData';

const listDirectory = vi.fn();
const getDirectoryMetadata = vi.fn();
const getDeepStatus = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
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
      fs: {
        getDeepStatus,
        getDirectoryMetadata,
        listDirectory,
      },
    },
  });
});

describe('useFileExplorerDirectoryData', () => {
  it('loads local files, metadata, and deep status for versioned paths', async () => {
    const files = [{ path: 'C:/repo/file.txt', name: 'file.txt', isDirectory: false }];
    const statusData = { entries: [] };
    const svnInfo = {
      repositoryRoot: 'https://svn.example.com/repo',
      url: 'https://svn.example.com/repo/trunk',
      workingCopyRoot: 'C:/repo',
    };
    const workingCopyContext = {
      repositoryRoot: 'https://fallback.example.com/repo',
      url: 'https://fallback.example.com/repo/trunk',
      workingCopyRoot: 'C:/repo',
    };

    listDirectory.mockResolvedValue(files);
    getDirectoryMetadata.mockResolvedValue({
      isVersioned: true,
      parentPath: 'C:/',
      statusData,
      svnInfo,
      workingCopyContext,
      workingCopyUpgradeStatus: { required: false },
    });
    getDeepStatus.mockResolvedValue([{ path: 'C:/repo', status: 'M' }]);

    const { result } = renderHook(() => useFileExplorerDirectoryData('C:/repo'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.deepStatusData).toEqual([{ path: 'C:/repo', status: 'M' }]));

    expect(result.current.rawFiles).toBe(files);
    expect(result.current.statusData).toBe(statusData);
    expect(result.current.svnInfo).toBe(svnInfo);
    expect(result.current.workingCopyContext).toBe(workingCopyContext);
    expect(result.current.effectiveRepoRoot).toBe('https://svn.example.com/repo');
    expect(result.current.effectiveUrl).toBe('https://svn.example.com/repo/trunk');
    expect(getDirectoryMetadata).toHaveBeenCalledWith('C:/repo', true);
    expect(getDeepStatus).toHaveBeenCalledWith('C:/repo');
  });

  it('does not request metadata or deep status for the drives root', async () => {
    listDirectory.mockResolvedValue([]);

    const { result } = renderHook(() => useFileExplorerDirectoryData('DRIVES://'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoadingFiles).toBe(false));

    expect(result.current.isVersioned).toBe(false);
    expect(result.current.parentPath).toBeNull();
    expect(getDirectoryMetadata).not.toHaveBeenCalled();
    expect(getDeepStatus).not.toHaveBeenCalled();
  });
});
