import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileExplorerDirectoryData } from '../src/components/files/useFileExplorerDirectoryData';

const listDirectory = vi.fn();
const getDirectoryMetadata = vi.fn();
const getDeepStatus = vi.fn();
const childCommits = vi.fn();

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
  childCommits.mockResolvedValue({});
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: {
        getDeepStatus,
        getDirectoryMetadata,
        listDirectory,
      },
      svn: {
        childCommits,
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

  it('does not run checkout-only reads against a folder navigated to from a checkout', async () => {
    // While the new folder's metadata loads, TanStack serves the previous
    // folder's — gating on it would fire `svn status`/`svn info` at a path
    // Subversion rejects with E155007.
    listDirectory.mockResolvedValue([{ path: '/plain/a.txt', name: 'a.txt', isDirectory: false }]);
    getDirectoryMetadata.mockImplementation(async (requested: string) =>
      requested === '/repo'
        ? { isVersioned: true, parentPath: '/', statusData: { entries: [] }, svnInfo: null }
        : { isVersioned: false, parentPath: '/', statusData: { entries: [] }, svnInfo: null }
    );
    getDeepStatus.mockResolvedValue([]);
    childCommits.mockResolvedValue({});

    const { rerender } = renderHook(({ path }: { path: string }) => useFileExplorerDirectoryData(path), {
      wrapper: createWrapper(),
      initialProps: { path: '/repo' },
    });

    await waitFor(() => expect(getDeepStatus).toHaveBeenCalledWith('/repo'));

    rerender({ path: '/plain' });

    await waitFor(() => expect(getDirectoryMetadata).toHaveBeenCalledWith('/plain', true));
    await waitFor(() => expect(getDeepStatus).toHaveBeenCalledTimes(1));

    expect(getDeepStatus).not.toHaveBeenCalledWith('/plain');
    expect(childCommits).not.toHaveBeenCalledWith('/plain');
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
