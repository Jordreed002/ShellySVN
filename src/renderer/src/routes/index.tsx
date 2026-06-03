import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

const WelcomeScreen = lazy(() =>
  import('@renderer/components/WelcomeScreen').then((m) => ({ default: m.WelcomeScreen }))
);

export const Route = createFileRoute('/')({
  component: () => (
    <RouteErrorBoundary routeName="Welcome">
      <Suspense fallback={null}>
        <WelcomeScreen />
      </Suspense>
    </RouteErrorBoundary>
  ),
});
