import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

/**
 * Home is a briefing, not a splash: what needs attention, what is incoming, and
 * where you were last. Split out behind the route because it pulls in the
 * open/checkout/import dialogs, which most launches never touch.
 */
const HomeScreen = lazy(() =>
  import('@renderer/components/home/HomeScreen').then((m) => ({ default: m.HomeScreen }))
);

export const Route = createFileRoute('/')({
  component: () => (
    <RouteErrorBoundary routeName="Home">
      <Suspense fallback={null}>
        <HomeScreen />
      </Suspense>
    </RouteErrorBoundary>
  ),
});
