import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fsGetDeepStatus,
  fsGetDirectoryMetadata,
  fsGetStatus,
  fsListDirectory,
  svnChildCommits,
} from '@renderer/lib/queryKeys';

type InvalidationScope = 'status' | 'directory' | 'all';

interface InvalidateWorkingCopyViewsOptions {
  includeParents?: boolean;
  scope?: InvalidationScope;
}

function getParentPaths(path: string): string[] {
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(separator);
  const parents: string[] = [];

  for (let index = parts.length - 1; index > 0; index--) {
    const parentPath = parts.slice(0, index).join(separator);
    if (parentPath) {
      parents.push(parentPath);
    }
  }

  return parents;
}

export function invalidateWorkingCopyViews(
  queryClient: QueryClient,
  path: string | null | undefined,
  options: InvalidateWorkingCopyViewsOptions = {}
): void {
  if (!path) return;

  const { includeParents = true, scope = 'all' } = options;
  const targetPaths = Array.from(new Set([path, ...(includeParents ? getParentPaths(path) : [])]));
  const shouldInvalidateDirectory = scope === 'directory' || scope === 'all';
  const shouldInvalidateStatus = scope === 'status' || scope === 'all';

  for (const targetPath of targetPaths) {
    if (shouldInvalidateDirectory) {
      queryClient.invalidateQueries({ queryKey: fsGetDirectoryMetadata(targetPath) });
      queryClient.invalidateQueries({ queryKey: fsListDirectory(targetPath) });
      // Carries the last-activity column and which children are excluded from
      // the checkout, so it goes stale whenever the listing does.
      queryClient.invalidateQueries({ queryKey: svnChildCommits(targetPath) });
    }

    if (shouldInvalidateStatus) {
      queryClient.invalidateQueries({ queryKey: fsGetStatus(targetPath) });
      queryClient.invalidateQueries({ queryKey: fsGetDeepStatus(targetPath) });
    }
  }
}

export function useInvalidateStatus() {
  const queryClient = useQueryClient();

  return useCallback(
    (path: string) => {
      invalidateWorkingCopyViews(queryClient, path);
    },
    [queryClient]
  );
}
