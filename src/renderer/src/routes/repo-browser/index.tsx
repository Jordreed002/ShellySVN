import { createFileRoute } from '@tanstack/react-router'
import { RepoBrowserContent } from './RepoBrowserContent'

export const Route = createFileRoute('/repo-browser/')({
  component: RepoBrowserContent,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      url: (search.url as string) || ''
    }
  }
})
