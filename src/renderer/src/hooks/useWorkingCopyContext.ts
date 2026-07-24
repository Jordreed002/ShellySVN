import { useQuery } from '@tanstack/react-query';
import { DEFAULT_QUERY_STALE_TIME_MS } from '@shared/constants';

export interface WorkingCopyContext {
  repositoryRoot: string;
  repositoryUuid: string;
  workingCopyRoot: string;
  mappingLocalPath: string;
  workingCopyUrl: string;
  derived: boolean;
}

export function useWorkingCopyContext(localPath: string | null | undefined) {
  const query = useQuery({
    queryKey: ['svn:info', localPath],
    queryFn: async (): Promise<WorkingCopyContext | null> => {
      if (!localPath) return null;

      try {
        const context = await window.api.svn.getWorkingCopyContext(localPath);

        if (!context) {
          return null;
        }

        return {
          repositoryRoot: context.repositoryRoot,
          repositoryUuid: context.repositoryUuid,
          workingCopyRoot: context.workingCopyRoot,
          mappingLocalPath: context.localPath,
          workingCopyUrl: context.url,
          derived: context.derived,
        };
      } catch {
        return null;
      }
    },
    enabled: !!localPath && localPath !== 'DRIVES://',
    staleTime: DEFAULT_QUERY_STALE_TIME_MS,
    retry: 1,
  });

  return query;
}
