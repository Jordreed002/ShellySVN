import { useQuery } from '@tanstack/react-query';

export interface WorkingCopyContext {
  repositoryRoot: string;
  workingCopyRoot: string;
  relativePath: string;
}

export function useWorkingCopyContext(localPath: string | null | undefined) {
  const query = useQuery({
    queryKey: ['svn:info', localPath],
    queryFn: async (): Promise<WorkingCopyContext | null> => {
      if (!localPath) return null;

      try {
        const info = await window.api.svn.info(localPath);

        if (!info.workingCopyRoot || !info.repositoryRoot) {
          return null;
        }

        const relativePath = localPath.slice(info.workingCopyRoot.length).replace(/^[/\\]+/, '');

        return {
          repositoryRoot: info.repositoryRoot,
          workingCopyRoot: info.workingCopyRoot,
          relativePath,
        };
      } catch (_error) {
        return null;
      }
    },
    enabled: !!localPath && localPath !== 'DRIVES://',
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  return query;
}
