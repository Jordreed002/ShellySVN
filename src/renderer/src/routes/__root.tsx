import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Suspense } from 'react';
import { Layout } from '@renderer/components/Layout';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

export const Route = createRootRoute({
  component: () => (
    <Layout>
      <RouteErrorBoundary routeName="Application">
        <Suspense fallback={<div className="loading">Loading...</div>}>
          <Outlet />
        </Suspense>
      </RouteErrorBoundary>
    </Layout>
  ),
});
