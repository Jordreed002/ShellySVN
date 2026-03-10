import { createFileRoute } from '@tanstack/react-router';
import { FileExplorer } from '@renderer/components/FileExplorer';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

export const Route = createFileRoute('/files/')({
  component: () => (
    <RouteErrorBoundary routeName="File Explorer">
      <FileExplorer />
    </RouteErrorBoundary>
  ),
  validateSearch: (search: Record<string, unknown>) => {
    return {
      path: (search.path as string) || '/',
    };
  },
});
