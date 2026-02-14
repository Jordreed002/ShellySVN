import { Loader2, X, CheckCircle, AlertCircle } from 'lucide-react'

export interface ProgressDialogProps {
  isOpen: boolean
  title: string
  message?: string
  progress?: number // 0-100, undefined = indeterminate
  currentFile?: string // Currently processing file
  filesProcessed?: number
  totalFiles?: number
  canCancel?: boolean
  onCancel?: () => void
  onClose?: () => void
  status?: 'running' | 'completed' | 'cancelled' | 'error'
  error?: string
}

export function ProgressDialog({
  isOpen,
  title,
  message,
  progress,
  currentFile,
  filesProcessed,
  totalFiles,
  canCancel = true,
  onCancel,
  onClose,
  status = 'running',
  error
}: ProgressDialogProps) {
  
  const isIndeterminate = progress === undefined
  const isComplete = status === 'completed'
  const isCancelled = status === 'cancelled'
  const hasError = status === 'error'
  const isRunning = status === 'running'
  
  // Truncate file path for display
  const truncatePath = (path: string, maxLength = 50): string => {
    if (path.length <= maxLength) return path
    const fileName = path.split(/[/\\]/).pop() || path
    if (fileName.length >= maxLength) return '...' + fileName.slice(-maxLength + 3)
    const remaining = maxLength - fileName.length - 3
    const start = path.slice(0, Math.max(0, remaining))
    return `${start}...${fileName}`
  }
  
  const handleClose = () => {
    if (!isRunning && onClose) {
      onClose()
    }
  }
  
  const handleCancel = () => {
    if (canCancel && onCancel) {
      onCancel()
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[420px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            {isComplete ? (
              <CheckCircle className="w-5 h-5 text-success" />
            ) : hasError ? (
              <AlertCircle className="w-5 h-5 text-error" />
            ) : isCancelled ? (
              <X className="w-5 h-5 text-warning" />
            ) : (
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            )}
            {title}
          </h2>
          {!isRunning && onClose && (
            <button 
              onClick={handleClose}
              className="btn-icon-sm"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {/* Status message */}
          {message && (
            <p className="text-sm text-text-secondary">
              {message}
            </p>
          )}
          
          {/* Error message */}
          {hasError && error && (
            <div className="flex items-start gap-2 text-sm text-error bg-error/10 rounded p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="break-all">{error}</span>
            </div>
          )}
          
          {/* Progress bar */}
          {(isRunning || isComplete) && (
            <div className="space-y-2">
              {/* Determinate progress bar */}
              {!isIndeterminate ? (
                <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden">
                  <div 
                    className={`
                      absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out
                      ${isComplete ? 'bg-success' : 'bg-accent'}
                    `}
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
              ) : (
                /* Indeterminate progress bar */
                <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden">
                  <div 
                    className="absolute inset-y-0 left-0 w-1/3 bg-accent rounded-full animate-indeterminate-progress"
                  />
                </div>
              )}
              
              {/* Progress percentage */}
              {!isIndeterminate && (
                <div className="flex justify-between text-xs text-text-muted">
                  <span>Progress</span>
                  <span>{Math.round(progress)}%</span>
                </div>
              )}
            </div>
          )}
          
          {/* File counter */}
          {filesProcessed !== undefined && totalFiles !== undefined && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="font-mono">
                {filesProcessed} of {totalFiles}
              </span>
              <span className="text-text-muted">files processed</span>
            </div>
          )}
          
          {/* Current file */}
          {currentFile && isRunning && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Current File
              </label>
              <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-md">
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
                <span 
                  className="text-sm text-text-secondary font-mono truncate"
                  title={currentFile}
                >
                  {truncatePath(currentFile)}
                </span>
              </div>
            </div>
          )}
          
          {/* Completion status */}
          {isComplete && (
            <div className="flex items-center justify-center gap-3 py-4">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-success" />
              </div>
              <span className="text-sm text-text-secondary">
                Operation completed successfully
              </span>
            </div>
          )}
          
          {/* Cancelled status */}
          {isCancelled && (
            <div className="flex items-center justify-center gap-3 py-4">
              <div className="w-10 h-10 rounded-full bg-warning/20 flex items-center justify-center">
                <X className="w-5 h-5 text-warning" />
              </div>
              <span className="text-sm text-text-secondary">
                Operation cancelled
              </span>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          {isRunning && canCancel && (
            <button
              onClick={handleCancel}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          )}
          {!isRunning && onClose && (
            <button
              onClick={handleClose}
              className={hasError ? "btn btn-secondary" : "btn btn-primary"}
            >
              {hasError ? 'Close' : 'Done'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
