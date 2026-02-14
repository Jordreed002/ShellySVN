import { createFileRoute } from '@tanstack/react-router'
import { FileExplorer } from '@renderer/components/FileExplorer'

export const Route = createFileRoute('/files/')({
  component: FileExplorer,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      path: (search.path as string) || '/'
    }
  }
})
