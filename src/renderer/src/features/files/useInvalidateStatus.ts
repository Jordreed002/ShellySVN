import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useInvalidateStatus() {
  const queryClient = useQueryClient();

  return useCallback(
    (path: string) => {
      queryClient.invalidateQueries({ queryKey: ['fs:getDirectoryMetadata', path] });
      queryClient.invalidateQueries({ queryKey: ['fs:getStatus', path] });
      queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', path] });
      queryClient.invalidateQueries({ queryKey: ['fs:listDirectory', path] });

      const parts = path.split(/[/\\]/);
      for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join(path.includes('\\') ? '\\' : '/');
        if (parentPath) {
          queryClient.invalidateQueries({ queryKey: ['fs:getDirectoryMetadata', parentPath] });
          queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', parentPath] });
        }
      }
    },
    [queryClient]
  );
}
