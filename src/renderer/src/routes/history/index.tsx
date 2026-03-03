import { createFileRoute } from '@tanstack/react-router'
import { CommitHistory } from '@renderer/components/CommitHistory'
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary'

export const Route = createFileRoute('/history/')({
  component: () => (
    <RouteErrorBoundary routeName="History">
      <CommitHistory />
    </RouteErrorBoundary>
  ),
  validateSearch: (search: Record<string, unknown>) => {
    return {
      path: (search.path as string) || '/'
    }
  }
})
