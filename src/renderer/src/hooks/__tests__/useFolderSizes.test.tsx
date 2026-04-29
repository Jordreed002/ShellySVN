import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnStatusEntry } from '@shared/types';

import {
  chunkFolderPaths,
  createFolderSizeQueryKey,
  FOLDER_SIZE_BATCH_SIZE,
  MAX_FOLDER_SIZE_PATHS,
  useFolderSizes,
} from '../useFolderSizes';

const getFolderSizes = vi.fn();

function entry(path: string, isDirectory = true): SvnStatusEntry {
  return {
    path,
    status: ' ',
    isDirectory,
  };
}

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
        getFolderSizes,
      },
    },
  });
});

describe('useFolderSizes', () => {
  it('chunks folder paths into bounded batches', () => {
    const paths = Array.from({ length: FOLDER_SIZE_BATCH_SIZE + 1 }, (_, index) => `/repo/${index}`);

    expect(chunkFolderPaths(paths)).toEqual([
      paths.slice(0, FOLDER_SIZE_BATCH_SIZE),
      paths.slice(FOLDER_SIZE_BATCH_SIZE),
    ]);
  });

  it('creates a bounded query key without joining full paths', () => {
    const paths = Array.from({ length: 1000 }, (_, index) => `/very/long/path/${index}`);
    const key = createFolderSizeQueryKey(paths);

    expect(key[0]).toBe('fs:getFolderSizes');
    expect(key[1]).toBe(paths.length);
    expect(String(key[2]).length).toBeLessThan(16);
    expect(JSON.stringify(key)).not.toContain('/very/long/path/999');
  });

  it('requests folder sizes in batches and caps the number of paths', async () => {
    const entries = Array.from({ length: MAX_FOLDER_SIZE_PATHS + 25 }, (_, index) =>
      entry(`/repo/folder-${index}`)
    );
    getFolderSizes.mockImplementation(async (paths: string[]) =>
      Object.fromEntries(paths.map((path) => [path, path.length]))
    );

    const { result } = renderHook(() => useFolderSizes(entries, true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingFolderSizes).toBe(false);
    });

    expect(getFolderSizes).toHaveBeenCalledTimes(
      Math.ceil(MAX_FOLDER_SIZE_PATHS / FOLDER_SIZE_BATCH_SIZE)
    );
    expect(getFolderSizes.mock.calls.flatMap(([paths]) => paths)).toHaveLength(MAX_FOLDER_SIZE_PATHS);
    expect(result.current.folderSizes['/repo/folder-0']).toBe('/repo/folder-0'.length);
    expect(result.current.folderSizes['/repo/folder-524']).toBeUndefined();
  });

  it('does not request sizes when disabled', () => {
    renderHook(() => useFolderSizes([entry('/repo/src')], false), {
      wrapper: createWrapper(),
    });

    expect(getFolderSizes).not.toHaveBeenCalled();
  });
});
