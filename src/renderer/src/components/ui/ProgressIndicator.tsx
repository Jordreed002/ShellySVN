import { useState, useEffect, useMemo } from 'react'
import { X, Download, Upload, CheckCircle, AlertCircle, Clock } from 'lucide-react'

export interface ProgressIndicatorProps {
  /** Current operation status */
  status: 'running' | 'completed' | 'cancelled' | 'error'
  /** Current item being processed (e.g., "Downloading file.txt") */
  currentItem?: string
  /** Number of items completed so far */
  itemsCompleted?: number
  /** Total number of items */
  totalItems?: number
  /** Bytes transferred so far */
  bytesTransferred?: number
  /** Total bytes to transfer */
  totalBytes?: number
  /** Optional error message */
  error?: string
  /** Show cancel button */
  canCancel?: boolean
  /** Cancel callback */
  onCancel?: () => void
  /** Close callback (for completed/error state) */
  onClose?: () => void
  /** Operation type for icon */
  operationType?: 'download' | 'upload' | 'generic'
  /** Whether progress is indeterminate */
  indeterminate?: boolean
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number
  /** Custom class name */
  className?: string
  /** Compact mode (minimal UI) */
  compact?: boolean
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = bytes / Math.pow(k, i)
  
  // Show decimal for MB and larger
  if (i >= 2) {
    return `${size.toFixed(1)} ${units[i]}`
  }
  return `${Math.round(size)} ${units[i]}`
}

/**
 * Format seconds to human-readable time
 */
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
  } else {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
}

/**
 * Progress indicator component for sparse checkout and other operations.
 * Shows item count, size progress, and estimated time remaining.
 */
export function ProgressIndicator({
  status,
  currentItem,
  itemsCompleted = 0,
  totalItems = 0,
  bytesTransferred = 0,
  totalBytes = 0,
  error,
  canCancel = true,
  onCancel,
  onClose,
  operationType = 'generic',
  indeterminate = false,
  estimatedTimeRemaining,
  className = '',
  compact = false
}: ProgressIndicatorProps) {
  const [startTime] = useState(Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)
  
  // Update elapsed time every second while running
  useEffect(() => {
    if (status !== 'running') return
    
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    
    return () => clearInterval(interval)
  }, [status, startTime])
  
  // Calculate progress percentage
  const progress = useMemo(() => {
    if (indeterminate) return undefined
    
    // Prefer byte-based progress if available
    if (totalBytes > 0) {
      return Math.min(100, (bytesTransferred / totalBytes) * 100)
    }
    
    // Fall back to item-based progress
    if (totalItems > 0) {
      return Math.min(100, (itemsCompleted / totalItems) * 100)
    }
    
    return undefined
  }, [indeterminate, bytesTransferred, totalBytes, itemsCompleted, totalItems])
  
  // Calculate estimated time if not provided
  const calculatedEta = useMemo(() => {
    if (estimatedTimeRemaining !== undefined) return estimatedTimeRemaining
    if (status !== 'running' || elapsedTime < 2) return undefined
    
    // Estimate based on item progress
    if (totalItems > 0 && itemsCompleted > 0) {
      const rate = itemsCompleted / elapsedTime // items per second
      const remaining = totalItems - itemsCompleted
      return Math.ceil(remaining / rate)
    }
    
    // Estimate based on byte progress
    if (totalBytes > 0 && bytesTransferred > 0) {
      const rate = bytesTransferred / elapsedTime // bytes per second
      const remaining = totalBytes - bytesTransferred
      return Math.ceil(remaining / rate)
    }
    
    return undefined
  }, [estimatedTimeRemaining, status, elapsedTime, totalItems, itemsCompleted, totalBytes, bytesTransferred])
  
  // Truncate long filenames
  const truncateText = (text: string, maxLen = 40): string => {
    if (text.length <= maxLen) return text
    const name = text.split(/[/\\]/).pop() || text
    if (name.length >= maxLen) return '...' + name.slice(-maxLen + 3)
    return '...' + name
  }
  
  const isRunning = status === 'running'
  const isComplete = status === 'completed'
  const isCancelled = status === 'cancelled'
  const hasError = status === 'error'
  
  const Icon = operationType === 'download' 
    ? Download 
    : operationType === 'upload' 
      ? Upload 
      : Download
  
  // Compact mode
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {isRunning && (
          <>
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            {totalItems > 0 && (
              <span className="text-xs text-text-secondary">
                {itemsCompleted}/{totalItems}
              </span>
            )}
            {canCancel && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="p-1 hover:bg-bg-tertiary rounded"
                title="Cancel"
              >
                <X className="w-3 h-3 text-text-muted" />
              </button>
            )}
          </>
        )}
        {isComplete && <CheckCircle className="w-4 h-4 text-success" />}
        {hasError && <AlertCircle className="w-4 h-4 text-error" />}
        {isCancelled && <X className="w-4 h-4 text-warning" />}
      </div>
    )
  }
  
  return (
    <div className={`bg-bg-secondary border border-border rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-tertiary">
        <div className="flex items-center gap-3">
          {isRunning && (
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          )}
          {isComplete && <CheckCircle className="w-5 h-5 text-success" />}
          {hasError && <AlertCircle className="w-5 h-5 text-error" />}
          {isCancelled && <X className="w-5 h-5 text-warning" />}
          
          <span className="text-sm font-medium text-text">
            {isRunning && 'Processing...'}
            {isComplete && 'Complete'}
            {hasError && 'Error'}
            {isCancelled && 'Cancelled'}
          </span>
        </div>
        
        {(isComplete || hasError || isCancelled) && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-sm"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* Error message */}
        {hasError && error && (
          <div className="flex items-start gap-2 text-sm text-error bg-error/10 rounded p-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}
        
        {/* Progress bar */}
        {(isRunning || isComplete) && (
          <div className="space-y-1.5">
            <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden">
              {progress !== undefined ? (
                <div 
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out
                    ${isComplete ? 'bg-success' : 'bg-accent'}`}
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
              ) : (
                <div className="absolute inset-y-0 w-1/3 bg-accent rounded-full animate-indeterminate-progress" />
              )}
            </div>
            
            {/* Progress stats */}
            <div className="flex justify-between text-xs text-text-muted">
              <span>
                {progress !== undefined ? `${Math.round(progress)}%` : 'Processing...'}
              </span>
              {elapsedTime > 0 && isRunning && (
                <span>{formatTime(elapsedTime)} elapsed</span>
              )}
            </div>
          </div>
        )}
        
        {/* Item and size counters */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {/* Item count */}
          {totalItems > 0 && (
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-text-muted" />
              <span className="text-text-secondary">
                <span className="font-mono text-text">{itemsCompleted}</span>
                <span className="text-text-muted"> of </span>
                <span className="font-mono text-text">{totalItems}</span>
                <span className="text-text-muted ml-1">items</span>
              </span>
            </div>
          )}
          
          {/* Size */}
          {totalBytes > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-text-secondary">
                <span className="font-mono text-text">{formatBytes(bytesTransferred)}</span>
                <span className="text-text-muted"> / </span>
                <span className="font-mono text-text">{formatBytes(totalBytes)}</span>
              </span>
            </div>
          )}
          
          {/* Estimated time remaining */}
          {calculatedEta && calculatedEta > 0 && isRunning && (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-text-muted" />
              <span className="text-text-secondary">
                ~{formatTime(calculatedEta)} remaining
              </span>
            </div>
          )}
        </div>
        
        {/* Current item */}
        {currentItem && isRunning && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Current
            </label>
            <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-md">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
              <span 
                className="text-sm text-text-secondary font-mono truncate"
                title={currentItem}
              >
                {truncateText(currentItem)}
              </span>
            </div>
          </div>
        )}
      </div>
      
      {/* Footer with cancel button */}
      {isRunning && canCancel && onCancel && (
        <div className="px-4 py-3 border-t border-border bg-bg-tertiary">
          <button
            onClick={onCancel}
            className="btn btn-secondary w-full"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Hook to calculate and track progress over time.
 * Returns estimated time remaining based on progress rate.
 */
export function useProgressTracker(
  itemsCompleted: number,
  totalItems: number,
  isRunning: boolean
) {
  const [estimatedTime, setEstimatedTime] = useState<number | undefined>()
  const [startTime, setStartTime] = useState<number | undefined>()
  
  useEffect(() => {
    if (isRunning && !startTime) {
      setStartTime(Date.now())
    } else if (!isRunning) {
      setStartTime(undefined)
      setEstimatedTime(undefined)
    }
  }, [isRunning, startTime])
  
  useEffect(() => {
    if (!isRunning || !startTime || itemsCompleted === 0) {
      return
    }
    
    const elapsed = (Date.now() - startTime) / 1000
    if (elapsed < 1) return // Wait at least 1 second
    
    const rate = itemsCompleted / elapsed
    const remaining = totalItems - itemsCompleted
    const eta = Math.ceil(remaining / rate)
    
    setEstimatedTime(eta)
  }, [isRunning, startTime, itemsCompleted, totalItems])
  
  return { estimatedTime, startTime }
}

export default ProgressIndicator
