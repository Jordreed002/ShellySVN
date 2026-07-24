import type { QueryClient } from '@tanstack/react-query';

import type { SvnMutationNotification } from '@shared/types';

export function invalidateAfterSvnMutation(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  notification: SvnMutationNotification
): Promise<unknown> {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => {
      const scope = String(queryKey[0] || '');
      const localMutation = notification.localPaths.length > 0;
      const repositoryMutation = notification.repositoryUrls.length > 0;
      return (
        (localMutation &&
          (scope.startsWith('svn:') ||
            scope.startsWith('sidebar:') ||
            scope.startsWith('fs:') ||
            scope === 'diagnostics')) ||
        (repositoryMutation &&
          (scope === 'repo-browser' ||
            scope === 'repo:list' ||
            scope === 'branches' ||
            scope.startsWith('svn:list') ||
            scope === 'svn:info' ||
            scope === 'svn:log'))
      );
    },
  });
}
