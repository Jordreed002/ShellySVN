import { createFileRoute } from '@tanstack/react-router'
import { RepoBrowserContent } from './RepoBrowserContent'
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary'

export const Route = createFileRoute('/repo-browser/')({
  component: () => (
    <RouteErrorBoundary routeName="Repository Browser">
      <RepoBrowserContent />
    </RouteErrorBoundary>
  ),
  validateSearch: (search: Record<string, unknown>) => {
    return {
      url: (search.url as string) || ''
    }
  }
})
