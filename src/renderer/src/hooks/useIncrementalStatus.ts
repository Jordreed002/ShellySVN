import { useState, useCallback, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SvnStatusEntry, SvnStatusChar } from '@shared/types'

export interface IncrementalStatusProgress {
  phase: 'idle' | 'scanning' | 'processing' | 'complete' | 'error'
  filesScanned: number
  totalFiles?: number
  currentPath?: string
  startTime: number
  elapsedTime: number
  error?: string
}

export interface IncrementalStatusResult {
  entries: SvnStatusEntry[]
  addedCount: number
  modifiedCount: number
  deletedCount: number
  conflictedCount: number
  unversionedCount: number
  lockedCount: number
}

export interface StatusUpdateEvent {
  type: 'progress' | 'entry' | 'complete' | 'error'
  progress?: IncrementalStatusProgress
  entry?: SvnStatusEntry
  result?: IncrementalStatusResult
  error?: string
}

type StatusUpdateCallback = (event: StatusUpdateEvent) => void

interface IncrementalStatusOptions {
  /**
   * Path to scan
   */
  path: string
  
  /**
   * Whether to include unversioned files
   */
  includeUnversioned?: boolean
  
  /**
   * Whether to include external directories
   */
  includeExternals?: boolean
  
  /**
   * Depth of scanning ('empty', 'files', 'immediates', 'infinity')
   */
  depth?: 'empty' | 'files' | 'immediates' | 'infinity'
  
  /**
   * Maximum files to scan before pausing for UI update
   */
  batchSize?: number
  
  /**
   * Callback for status updates
   */
  onUpdate?: StatusUpdateCallback
  
  /**
   * Enable file system watching for auto-refresh
   */
  enableWatch?: boolean
  
  /**
   * Debounce interval for watch updates (ms)
   */
  watchDebounce?: number
}

/**
 * Hook for incremental/streaming SVN status updates
 * 
 * This hook provides real-time status updates as files are scanned,
 * allowing the UI to progressively display results instead of waiting
 * for the entire scan to complete.
 */
export function useIncrementalStatus(options: IncrementalStatusOptions) {
  const {
    path,
    includeUnversioned = true,
    includeExternals = true,
    depth = 'infinity',
    batchSize = 100,
    onUpdate,
    enableWatch = false,
    watchDebounce = 1000
  } = options
  
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<IncrementalStatusProgress>({
    phase: 'idle',
    filesScanned: 0,
    startTime: 0,
    elapsedTime: 0
  })
  const [result, setResult] = useState<IncrementalStatusResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const watchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const entriesRef = useRef<SvnStatusEntry[]>([])
  
  /**
   * Start incremental status scan
   */
  const startScan = useCallback(async () => {
    // Cancel any existing scan
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    abortControllerRef.current = new AbortController()
    entriesRef.current = []
    
    const startTime = Date.now()
    
    setProgress({
      phase: 'scanning',
      filesScanned: 0,
      startTime,
      elapsedTime: 0
    })
    setIsScanning(true)
    setResult(null)
    
    try {
      // First, get the raw status output
      const statusResult = await window.api.svn.status(path)
      
      if (abortControllerRef.current?.signal.aborted) {
        return
      }
      
      const entries = statusResult.entries || []
      const totalFiles = entries.length
      
      setProgress(prev => ({
        ...prev,
        phase: 'processing',
        totalFiles
      }))
      
      // Process entries in batches for smooth UI updates
      for (let i = 0; i < entries.length; i += batchSize) {
        if (abortControllerRef.current?.signal.aborted) {
          return
        }
        
        const batch = entries.slice(i, i + batchSize)
        
        // Add entries to our collection
        entriesRef.current.push(...batch)
        
        // Calculate counts
        const currentResult = calculateResult(entriesRef.current)
        setResult(currentResult)
        
        // Update progress
        const progressUpdate: IncrementalStatusProgress = {
          phase: 'processing',
          filesScanned: entriesRef.current.length,
          totalFiles,
          currentPath: batch[batch.length - 1]?.path,
          startTime,
          elapsedTime: Date.now() - startTime
        }
        
        setProgress(progressUpdate)
        
        // Notify callback
        onUpdate?.({
          type: 'progress',
          progress: progressUpdate
        })
        
        // Emit individual entries
        for (const entry of batch) {
          onUpdate?.({
            type: 'entry',
            entry
          })
        }
        
        // Yield to UI thread
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      
      // Complete
      const finalResult = calculateResult(entriesRef.current)
      const finalProgress: IncrementalStatusProgress = {
        phase: 'complete',
        filesScanned: entriesRef.current.length,
        totalFiles,
        startTime,
        elapsedTime: Date.now() - startTime
      }
      
      setProgress(finalProgress)
      setResult(finalResult)
      setIsScanning(false)
      
      // Update TanStack Query cache
      queryClient.setQueryData(['fs:getStatus', path], statusResult)
      queryClient.setQueryData(['fs:getDeepStatus', path], entriesRef.current)
      
      onUpdate?.({
        type: 'complete',
        result: finalResult,
        progress: finalProgress
      })
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        error: errorMessage
      }))
      setIsScanning(false)
      
      onUpdate?.({
        type: 'error',
        error: errorMessage
      })
    }
  }, [path, includeUnversioned, includeExternals, depth, batchSize, onUpdate, queryClient])
  
  /**
   * Cancel ongoing scan
   */
  const cancelScan = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    setProgress(prev => ({
      ...prev,
      phase: 'idle'
    }))
    setIsScanning(false)
  }, [])
  
  /**
   * Reset state
   */
  const reset = useCallback(() => {
    cancelScan()
    entriesRef.current = []
    setResult(null)
    setProgress({
      phase: 'idle',
      filesScanned: 0,
      startTime: 0,
      elapsedTime: 0
    })
  }, [cancelScan])
  
  // File system watching for auto-refresh
  useEffect(() => {
    if (!enableWatch || !path) return
    
    // Debounce function for rapid changes
    const debounce = <T extends (...args: unknown[]) => unknown>(fn: T, delay: number) => {
      let timeoutId: ReturnType<typeof setTimeout>
      return (...args: Parameters<T>) => {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => fn(...args), delay)
      }
    }
    
    const debouncedScan = debounce(() => {
      startScan()
    }, watchDebounce)
    
    const cleanup = window.api.fs.watch(path, debouncedScan, { watchSvnOnly: false })
    
    return () => {
      if (cleanup) cleanup()
    }
  }, [enableWatch, path, watchDebounce, startScan])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (watchTimeoutRef.current) {
        clearTimeout(watchTimeoutRef.current)
      }
    }
  }, [])
  
  return {
    progress,
    result,
    isScanning,
    entries: entriesRef.current,
    startScan,
    cancelScan,
    reset
  }
}

/**
 * Calculate result statistics from entries
 */
function calculateResult(entries: SvnStatusEntry[]): IncrementalStatusResult {
  let addedCount = 0
  let modifiedCount = 0
  let deletedCount = 0
  let conflictedCount = 0
  let unversionedCount = 0
  let lockedCount = 0
  
  for (const entry of entries) {
    switch (entry.status) {
      case 'A':
        addedCount++
        break
      case 'M':
      case 'R':
        modifiedCount++
        break
      case 'D':
        deletedCount++
        break
      case 'C':
        conflictedCount++
        break
      case '?':
        unversionedCount++
        break
    }
    
    if (entry.lock) {
      lockedCount++
    }
  }
  
  return {
    entries,
    addedCount,
    modifiedCount,
    deletedCount,
    conflictedCount,
    unversionedCount,
    lockedCount
  }
}

/**
 * Get status icon and color based on status character
 */
export function getStatusDisplay(status: SvnStatusChar): {
  icon: string
  color: string
  label: string
} {
  switch (status) {
    case 'A':
      return { icon: '➕', color: 'text-green-500', label: 'Added' }
    case 'C':
      return { icon: '⚠️', color: 'text-red-500', label: 'Conflicted' }
    case 'D':
      return { icon: '🗑️', color: 'text-red-400', label: 'Deleted' }
    case 'I':
      return { icon: '🚫', color: 'text-gray-400', label: 'Ignored' }
    case 'M':
      return { icon: '✏️', color: 'text-yellow-500', label: 'Modified' }
    case 'R':
      return { icon: '🔄', color: 'text-blue-500', label: 'Replaced' }
    case 'X':
      return { icon: '🔗', color: 'text-purple-500', label: 'External' }
    case '?':
      return { icon: '❓', color: 'text-gray-500', label: 'Unversioned' }
    case '!':
      return { icon: '❌', color: 'text-red-600', label: 'Missing' }
    case '~':
      return { icon: '⛔', color: 'text-orange-500', label: 'Obstructed' }
    default:
      return { icon: '✓', color: 'text-green-600', label: 'Normal' }
  }
}

/**
 * Format elapsed time for display
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}
