import { createFileRoute } from '@tanstack/react-router'
import { CommitHistory } from '@renderer/components/CommitHistory'

export const Route = createFileRoute('/history/')({
  component: CommitHistory,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      path: (search.path as string) || '/'
    }
  }
})
