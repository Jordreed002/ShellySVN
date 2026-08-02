import { createFileRoute } from '@tanstack/react-router';
import { FileExplorer } from '@renderer/components/FileExplorer';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

export const Route = createFileRoute('/files/')({
  component: () => (
    <RouteErrorBoundary routeName="File Explorer">
      <FileExplorer />
    </RouteErrorBoundary>
  ),
  validateSearch: (
    search: Record<string, unknown>
  ): { path: string; dialog?: 'problems' } => {
    return {
      path: typeof search.path === 'string' && search.path ? search.path : '/',
      dialog:
        typeof search.dialog === 'string' && search.dialog === 'problems'
          ? ('problems' as const)
          : undefined,
    };
  },
});
