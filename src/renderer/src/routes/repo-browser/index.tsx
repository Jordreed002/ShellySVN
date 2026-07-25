import { createFileRoute, useSearch } from '@tanstack/react-router';
import { RepoBrowserContent } from './-RepoBrowserContent';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

export const Route = createFileRoute('/repo-browser/')({
  component: RepoBrowserRoute,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      url: (search.url as string) || '',
      localPath: typeof search.localPath === 'string' ? search.localPath : undefined,
    };
  },
});

function RepoBrowserRoute() {
  const search = useSearch({ from: '/repo-browser/' });
  return (
    <RouteErrorBoundary routeName="Repository Browser">
      <RepoBrowserContent localPath={search.localPath} />
    </RouteErrorBoundary>
  );
}
