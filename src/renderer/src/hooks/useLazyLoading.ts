import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SvnStatusEntry } from '@shared/types'

/**
 * Configuration for large repo handling
 */
interface LargeRepoConfig {
  /** Number of items to load per chunk (default: 500) */
  chunkSize: number
  /** Threshold to consider repo as "large" (default: 10000) */
  largeRepoThreshold: number
  /** Prefetch margin in pixels (default: 500) */
  prefetchMargin: number
  /** Enable progressive loading indicator */
  showProgressIndicator: boolean
  /** Debounce scroll events (ms) */
  scrollDebounce: number
}

const DEFAULT_CONFIG: LargeRepoConfig = {
  chunkSize: 500,
  largeRepoThreshold: 10000,
  prefetchMargin: 500,
  showProgressIndicator: true,
  scrollDebounce: 16 // ~60fps
}

/**
 * Chunked data structure
 */
interface DataChunk<T> {
  id: string
  items: T[]
  startIndex: number
  endIndex: number
  loadedAt: number
}

/**
 * State for lazy-loaded data
 */
interface LazyDataState<T> {
  /** All known items (may be partially loaded) */
  items: T[]
  /** Loaded chunks */
  chunks: Map<string, DataChunk<T>>
  /** Total count (may differ from items.length for remote data) */
  totalCount: number
  /** Loading state */
  isLoading: boolean
  /** Error state */
  error: string | null
  /** Has more data to load */
  hasMore: boolean
  /** Currently loading chunk index */
  loadingChunkIndex: number
}

/**
 * Hook for lazy loading large datasets with chunking
 */
export function useLazyDataLoader<T>(
  fetchFn: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>,
  config: Partial<LargeRepoConfig> = {}
) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  const [state, setState] = useState<LazyDataState<T>>({
    items: [],
    chunks: new Map(),
    totalCount: 0,
    isLoading: false,
    error: null,
    hasMore: true,
    loadingChunkIndex: -1
  })
  
  const abortControllerRef = useRef<AbortController | null>(null)
  
  /**
   * Load a specific chunk
   */
  const loadChunk = useCallback(async (chunkIndex: number) => {
    // Check if already loading or loaded
    if (state.isLoading || state.chunks.has(`chunk-${chunkIndex}`)) {
      return
    }
    
    // Abort any existing load
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    
    const offset = chunkIndex * cfg.chunkSize
    
    setState(prev => ({
      ...prev,
      isLoading: true,
      loadingChunkIndex: chunkIndex,
      error: null
    }))
    
    try {
      const result = await fetchFn(offset, cfg.chunkSize)
      
      const chunk: DataChunk<T> = {
        id: `chunk-${chunkIndex}`,
        items: result.items,
        startIndex: offset,
        endIndex: offset + result.items.length - 1,
        loadedAt: Date.now()
      }
      
      setState(prev => {
        // Merge items
        const newItems = [...prev.items]
        for (let i = 0; i < result.items.length; i++) {
          newItems[offset + i] = result.items[i]
        }
        
        const newChunks = new Map(prev.chunks)
        newChunks.set(chunk.id, chunk)
        
        return {
          ...prev,
          items: newItems,
          chunks: newChunks,
          totalCount: result.total,
          isLoading: false,
          loadingChunkIndex: -1,
          hasMore: offset + result.items.length < result.total
        }
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        loadingChunkIndex: -1,
        error: error instanceof Error ? error.message : 'Failed to load data'
      }))
    }
  }, [fetchFn, cfg.chunkSize, state.isLoading, state.chunks])
  
  /**
   * Load initial data
   */
  const loadInitial = useCallback(async () => {
    await loadChunk(0)
  }, [loadChunk])
  
  /**
   * Load more data (next chunk)
   */
  const loadMore = useCallback(async () => {
    if (!state.hasMore || state.isLoading) return
    
    const nextChunkIndex = Math.floor(state.items.filter(Boolean).length / cfg.chunkSize)
    await loadChunk(nextChunkIndex)
  }, [state.hasMore, state.isLoading, state.items, cfg.chunkSize, loadChunk])
  
  /**
   * Ensure data is loaded for a specific index range
   */
  const ensureRangeLoaded = useCallback(async (startIndex: number, endIndex: number) => {
    const startChunk = Math.floor(startIndex / cfg.chunkSize)
    const endChunk = Math.floor(endIndex / cfg.chunkSize)
    
    const chunksToLoad: number[] = []
    for (let i = startChunk; i <= endChunk; i++) {
      if (!state.chunks.has(`chunk-${i}`)) {
        chunksToLoad.push(i)
      }
    }
    
    // Load chunks sequentially
    for (const chunkIndex of chunksToLoad) {
      await loadChunk(chunkIndex)
    }
  }, [cfg.chunkSize, state.chunks, loadChunk])
  
  /**
   * Reset and reload
   */
  const reset = useCallback(() => {
    setState({
      items: [],
      chunks: new Map(),
      totalCount: 0,
      isLoading: false,
      error: null,
      hasMore: true,
      loadingChunkIndex: -1
    })
  }, [])
  
  /**
   * Check if repo is considered "large"
   */
  const isLarge = useMemo(() => {
    return state.totalCount >= cfg.largeRepoThreshold
  }, [state.totalCount, cfg.largeRepoThreshold])
  
  return {
    ...state,
    isLarge,
    loadInitial,
    loadMore,
    loadChunk,
    ensureRangeLoaded,
    reset
  }
}

/**
 * Hook for virtualized list with lazy loading
 */
export function useLazyVirtualList<T>(
  containerRef: React.RefObject<HTMLElement>,
  items: T[],
  options: {
    estimateSize?: (index: number) => number
    overscan?: number
    onLoadMore?: () => void
    hasMore?: boolean
    isLoading?: boolean
    loadThreshold?: number
  } = {}
) {
  const {
    estimateSize = () => 32,
    overscan = 5,
    onLoadMore,
    hasMore = false,
    isLoading = false,
    loadThreshold = 10
  } = options
  
  const virtualizer = useVirtualizer({
    count: hasMore ? items.length + 1 : items.length,
    getScrollElement: () => containerRef.current,
    estimateSize,
    overscan
  })
  
  const lastItem = virtualizer.getVirtualItems().at(-1)
  
  // Trigger load more when approaching end
  useEffect(() => {
    if (
      hasMore &&
      !isLoading &&
      lastItem &&
      lastItem.index >= items.length - loadThreshold &&
      onLoadMore
    ) {
      onLoadMore()
    }
  }, [hasMore, isLoading, lastItem, items.length, loadThreshold, onLoadMore])
  
  return {
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    scrollToIndex: virtualizer.scrollToIndex,
    scrollToOffset: virtualizer.scrollToOffset
  }
}

/**
 * Hook for optimized large file list handling
 */
export function useLargeFileList(
  path: string,
  fetchFiles: (path: string) => Promise<SvnStatusEntry[]>
) {
  const [files, setFiles] = useState<SvnStatusEntry[]>([])
  const [filteredFiles, setFilteredFiles] = useState<SvnStatusEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'date'>('name')
  const [sortAsc, setSortAsc] = useState(true)
  
  // Load files
  const loadFiles = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await fetchFiles(path)
      setFiles(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files')
    } finally {
      setIsLoading(false)
    }
  }, [path, fetchFiles])
  
  // Filter and sort files
  useEffect(() => {
    let result = [...files]
    
    // Apply filter
    if (filter) {
      const lowerFilter = filter.toLowerCase()
      result = result.filter(file => 
        file.path.toLowerCase().includes(lowerFilter) ||
        file.status.toLowerCase().includes(lowerFilter)
      )
    }
    
    // Apply sort
    result.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'name':
          comparison = a.path.localeCompare(b.path)
          break
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
        case 'date':
          comparison = (a.date || '').localeCompare(b.date || '')
          break
      }
      return sortAsc ? comparison : -comparison
    })
    
    setFilteredFiles(result)
  }, [files, filter, sortBy, sortAsc])
  
  // Group files by directory for faster display
  const groupedFiles = useMemo(() => {
    const groups: Map<string, SvnStatusEntry[]> = new Map()
    
    for (const file of filteredFiles) {
      const parts = file.path.split(/[/\\]/)
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
      
      if (!groups.has(dir)) {
        groups.set(dir, [])
      }
      groups.get(dir)!.push(file)
    }
    
    return groups
  }, [filteredFiles])
  
  // Get stats
  const stats = useMemo(() => {
    let modified = 0
    let added = 0
    let deleted = 0
    let conflicted = 0
    let unversioned = 0
    
    for (const file of files) {
      switch (file.status) {
        case 'M':
        case 'R':
          modified++
          break
        case 'A':
          added++
          break
        case 'D':
          deleted++
          break
        case 'C':
          conflicted++
          break
        case '?':
          unversioned++
          break
      }
    }
    
    return { modified, added, deleted, conflicted, unversioned, total: files.length }
  }, [files])
  
  return {
    files,
    filteredFiles,
    groupedFiles,
    isLoading,
    error,
    filter,
    setFilter,
    sortBy,
    setSortBy,
    sortAsc,
    setSortAsc,
    stats,
    loadFiles,
    isLarge: files.length >= 10000
  }
}

/**
 * Hook for directory tree with lazy loading
 */
export function useLazyDirectoryTree(
  _rootPath: string,
  fetchDirectory: (path: string) => Promise<{ name: string; path: string; isDirectory: boolean }[]>
) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadedDirectories, setLoadedDirectories] = useState<Map<string, { name: string; path: string; isDirectory: boolean }[]>>(new Map())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  
  const toggleExpand = useCallback(async (path: string) => {
    if (expandedPaths.has(path)) {
      setExpandedPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
      return
    }
    
    // Load children if not loaded
    if (!loadedDirectories.has(path)) {
      setLoadingPaths(prev => new Set(prev).add(path))
      
      try {
        const children = await fetchDirectory(path)
        setLoadedDirectories(prev => new Map(prev).set(path, children))
      } catch (error) {
        console.error(`Failed to load directory ${path}:`, error)
        return
      } finally {
        setLoadingPaths(prev => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    }
    
    setExpandedPaths(prev => new Set(prev).add(path))
  }, [expandedPaths, loadedDirectories, fetchDirectory])
  
  const getChildren = useCallback((path: string) => {
    return loadedDirectories.get(path) || []
  }, [loadedDirectories])
  
  const isLoading = useCallback((path: string) => {
    return loadingPaths.has(path)
  }, [loadingPaths])
  
  const isExpanded = useCallback((path: string) => {
    return expandedPaths.has(path)
  }, [expandedPaths])
  
  const expandAll = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      await toggleExpand(path)
    }
  }, [toggleExpand])
  
  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])
  
  return {
    expandedPaths,
    toggleExpand,
    getChildren,
    isLoading,
    isExpanded,
    expandAll,
    collapseAll
  }
}

export default useLazyDataLoader
