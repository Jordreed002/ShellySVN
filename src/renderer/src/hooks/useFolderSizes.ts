import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SvnStatusEntry } from '@shared/types';

export const FOLDER_SIZE_BATCH_SIZE = 50;
export const MAX_FOLDER_SIZE_PATHS = 500;

export function chunkFolderPaths(
  folderPaths: string[],
  batchSize: number = FOLDER_SIZE_BATCH_SIZE
): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < folderPaths.length; index += batchSize) {
    chunks.push(folderPaths.slice(index, index + batchSize));
  }
  return chunks;
}

function hashFolderPaths(folderPaths: string[]): string {
  let hash = 5381;
  for (const path of folderPaths) {
    for (let index = 0; index < path.length; index++) {
      hash = (hash * 33) ^ path.charCodeAt(index);
    }
  }
  return (hash >>> 0).toString(36);
}

export function createFolderSizeQueryKey(folderPaths: string[]) {
  return ['fs:getFolderSizes', folderPaths.length, hashFolderPaths(folderPaths)] as const;
}

/**
 * Hook to calculate folder sizes for directories in a file list
 * Only calculates when showFolderSizes is true
 */
export function useFolderSizes(entries: SvnStatusEntry[], enabled: boolean = false) {
  // Extract folder paths
  const folderPaths = useMemo(() => {
    if (!enabled) return [];
    return entries
      .filter((e) => e.isDirectory)
      .slice(0, MAX_FOLDER_SIZE_PATHS)
      .map((e) => e.path);
  }, [entries, enabled]);

  const queryKey = useMemo(() => createFolderSizeQueryKey(folderPaths), [folderPaths]);

  const {
    data: folderSizes,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (folderPaths.length === 0) return {};

      const sizes: Record<string, number> = {};
      for (const batch of chunkFolderPaths(folderPaths)) {
        if (signal.aborted) {
          throw new Error('Folder size calculation cancelled');
        }

        Object.assign(sizes, await window.api.fs.getFolderSizes(batch));
      }

      return sizes;
    },
    enabled: enabled && folderPaths.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes - folder sizes don't change often
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });

  return {
    folderSizes: folderSizes || {},
    isLoadingFolderSizes: isLoading,
    folderSizesError: error,
  };
}

/**
 * Format file/folder size for display
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${i > 0 ? size.toFixed(1) : size.toFixed(0)} ${units[i]}`;
}
