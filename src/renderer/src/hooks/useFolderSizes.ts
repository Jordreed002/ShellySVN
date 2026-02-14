import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { SvnStatusEntry } from '@shared/types'

/**
 * Hook to calculate folder sizes for directories in a file list
 * Only calculates when showFolderSizes is true
 */
export function useFolderSizes(
  entries: SvnStatusEntry[],
  enabled: boolean = false
) {
  // Extract folder paths
  const folderPaths = useMemo(() => {
    if (!enabled) return []
    return entries
      .filter(e => e.isDirectory)
      .map(e => e.path)
  }, [entries, enabled])

  const { data: folderSizes, isLoading, error } = useQuery({
    queryKey: ['fs:getFolderSizes', folderPaths.join(',')],
    queryFn: async () => {
      if (folderPaths.length === 0) return {}
      return window.api.fs.getFolderSizes(folderPaths)
    },
    enabled: enabled && folderPaths.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes - folder sizes don't change often
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false
  })

  return {
    folderSizes: folderSizes || {},
    isLoadingFolderSizes: isLoading,
    folderSizesError: error
  }
}

/**
 * Format file/folder size for display
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  return `${i > 0 ? size.toFixed(1) : size.toFixed(0)} ${units[i]}`
}
