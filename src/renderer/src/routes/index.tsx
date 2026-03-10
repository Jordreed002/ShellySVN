import { createFileRoute } from '@tanstack/react-router';
import { WelcomeScreen } from '@renderer/components/WelcomeScreen';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';

export const Route = createFileRoute('/')({
  component: () => (
    <RouteErrorBoundary routeName="Welcome">
      <WelcomeScreen />
    </RouteErrorBoundary>
  ),
});
