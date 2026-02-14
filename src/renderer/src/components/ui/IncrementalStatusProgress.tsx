import { useEffect, useMemo } from 'react'
import { Loader2, CheckCircle2, XCircle, FileSearch, Clock } from 'lucide-react'
import { useIncrementalStatus, formatElapsedTime } from '../../hooks/useIncrementalStatus'
import type { IncrementalStatusProgress } from '../../hooks/useIncrementalStatus'

interface StatusProgressBarProps {
  progress: IncrementalStatusProgress
  showDetails?: boolean
}

/**
 * Visual progress indicator for incremental status scans
 */
export function StatusProgressBar({ progress, showDetails = true }: StatusProgressBarProps) {
  const percentage = useMemo(() => {
    if (progress.totalFiles && progress.totalFiles > 0) {
      return Math.round((progress.filesScanned / progress.totalFiles) * 100)
    }
    return 0
  }, [progress.filesScanned, progress.totalFiles])
  
  const statusIcon = useMemo(() => {
    switch (progress.phase) {
      case 'scanning':
        return <FileSearch className="w-4 h-4 text-blue-500 animate-pulse" />
      case 'processing':
        return <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
      case 'complete':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-gray-400" />
    }
  }, [progress.phase])
  
  const statusText = useMemo(() => {
    switch (progress.phase) {
      case 'scanning':
        return 'Scanning files...'
      case 'processing':
        return `Processing ${progress.filesScanned.toLocaleString()} files`
      case 'complete':
        return `Completed - ${progress.filesScanned.toLocaleString()} files in ${formatElapsedTime(progress.elapsedTime)}`
      case 'error':
        return `Error: ${progress.error}`
      default:
        return 'Idle'
    }
  }, [progress])
  
  if (progress.phase === 'idle') {
    return null
  }
  
  return (
    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {statusText}
        </span>
      </div>
      
      {(progress.phase === 'scanning' || progress.phase === 'processing') && (
        <div className="space-y-1">
          <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
          
          {showDetails && (
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{progress.filesScanned.toLocaleString()} / {progress.totalFiles?.toLocaleString() || '...'}</span>
              <span>{formatElapsedTime(progress.elapsedTime)}</span>
            </div>
          )}
          
          {progress.currentPath && showDetails && (
            <div className="text-xs text-slate-400 dark:text-slate-500 truncate">
              {progress.currentPath}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface IncrementalStatusWidgetProps {
  path: string
  onComplete?: () => void
  autoStart?: boolean
  showDetails?: boolean
}

/**
 * Full widget with status scanning and progress display
 */
export function IncrementalStatusWidget({ 
  path, 
  onComplete, 
  autoStart = false,
  showDetails = true 
}: IncrementalStatusWidgetProps) {
  const { progress, result, isScanning, startScan, cancelScan } = useIncrementalStatus({
    path,
    onUpdate: (event) => {
      if (event.type === 'complete' && onComplete) {
        onComplete()
      }
    }
  })
  
  useEffect(() => {
    if (autoStart && path) {
      startScan()
    }
  }, [autoStart, path, startScan])
  
  if (progress.phase === 'idle' && !result) {
    return (
      <button
        onClick={startScan}
        className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md flex items-center gap-2"
      >
        <FileSearch className="w-4 h-4" />
        Scan Status
      </button>
    )
  }
  
  return (
    <div className="space-y-3">
      <StatusProgressBar progress={progress} showDetails={showDetails} />
      
      {result && progress.phase === 'complete' && (
        <div className="grid grid-cols-3 gap-2">
          {result.addedCount > 0 && (
            <div className="bg-green-50 dark:bg-green-900/20 rounded p-2 text-center">
              <div className="text-lg font-bold text-green-600 dark:text-green-400">
                {result.addedCount}
              </div>
              <div className="text-xs text-green-600 dark:text-green-400">Added</div>
            </div>
          )}
          
          {result.modifiedCount > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-2 text-center">
              <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                {result.modifiedCount}
              </div>
              <div className="text-xs text-yellow-600 dark:text-yellow-400">Modified</div>
            </div>
          )}
          
          {result.conflictedCount > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 text-center">
              <div className="text-lg font-bold text-red-600 dark:text-red-400">
                {result.conflictedCount}
              </div>
              <div className="text-xs text-red-600 dark:text-red-400">Conflicted</div>
            </div>
          )}
          
          {result.deletedCount > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 text-center">
              <div className="text-lg font-bold text-red-500 dark:text-red-400">
                {result.deletedCount}
              </div>
              <div className="text-xs text-red-500 dark:text-red-400">Deleted</div>
            </div>
          )}
          
          {result.unversionedCount > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 text-center">
              <div className="text-lg font-bold text-gray-600 dark:text-gray-400">
                {result.unversionedCount}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Unversioned</div>
            </div>
          )}
          
          {result.lockedCount > 0 && (
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded p-2 text-center">
              <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {result.lockedCount}
              </div>
              <div className="text-xs text-purple-600 dark:text-purple-400">Locked</div>
            </div>
          )}
        </div>
      )}
      
      {isScanning && (
        <button
          onClick={cancelScan}
          className="px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded-md"
        >
          Cancel
        </button>
      )}
      
      {!isScanning && progress.phase === 'complete' && (
        <button
          onClick={startScan}
          className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md"
        >
          Rescan
        </button>
      )}
    </div>
  )
}

export default IncrementalStatusWidget
