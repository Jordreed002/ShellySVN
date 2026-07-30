import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { lazy, Suspense, useCallback } from 'react';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

/**
 * The browser is a whole feature — tree, contents, diff/blame/log and its
 * dialogs. Loading it eagerly puts all of that in the initial chunk for users
 * who never open it, so it is split out behind the route.
 */
const RepoBrowserScreen = lazy(() =>
  import('@renderer/features/repo-browser/RepoBrowserScreen').then((module) => ({
    default: module.RepoBrowserScreen,
  }))
);

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
  const navigate = useNavigate();

  /**
   * When the browser discovers that the path being viewed is inside one of the
   * user's checkouts, record it in the URL.
   *
   * Otherwise that fact stays trapped inside the feature, and the rest of the
   * shell contradicts it — the footer saying "working copy · status from disk"
   * while the status bar says "No working copy open". `replace` keeps this out
   * of the back stack: it is a refinement of where you already are, not a move.
   */
  const handleWorkingCopyBound = useCallback(
    (localPath: string | null) => {
      if ((localPath ?? undefined) === search.localPath) return;
      void navigate({
        to: '/repo-browser',
        search: { url: search.url, localPath: localPath ?? undefined },
        replace: true,
      });
    },
    [navigate, search.localPath, search.url]
  );

  return (
    <RouteErrorBoundary routeName="Repository Browser">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Loading repository browser…
          </div>
        }
      >
        <RepoBrowserScreen
          url={search.url}
          localPath={search.localPath}
          onWorkingCopyBound={handleWorkingCopyBound}
        />
      </Suspense>
    </RouteErrorBoundary>
  );
}
