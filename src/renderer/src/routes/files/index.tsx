import { createFileRoute } from '@tanstack/react-router';
import { FileExplorer } from '@renderer/components/FileExplorer';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

export interface FilesSearch {
  path: string;
  dialog?: 'problems';
}

export const Route = createFileRoute('/files/')({
  component: () => (
    <RouteErrorBoundary routeName="File Explorer">
      <FileExplorer />
    </RouteErrorBoundary>
  ),
  validateSearch: (search: Record<string, unknown>): FilesSearch => {
    return {
      path: (search.path as string) || '/',
      dialog: search.dialog === 'problems' ? ('problems' as const) : undefined,
    };
  },
});
