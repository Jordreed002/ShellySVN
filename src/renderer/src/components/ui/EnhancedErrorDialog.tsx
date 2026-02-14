import { useState } from 'react'
import { X, AlertCircle, AlertTriangle, Info, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'

export type ErrorSeverity = 'error' | 'warning' | 'info'

interface ErrorDetail {
  code?: string
  message: string
  details?: string
  stack?: string
  suggestions?: string[]
}

interface EnhancedErrorDialogProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  error: ErrorDetail | string | Error
  severity?: ErrorSeverity
  onRetry?: () => void
  onDismiss?: () => void
}

export function EnhancedErrorDialog({
  isOpen,
  onClose,
  title,
  error,
  severity = 'error',
  onRetry,
  onDismiss
}: EnhancedErrorDialogProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  
  if (!isOpen) return null
  
  // Normalize error input
  const errorDetail: ErrorDetail = typeof error === 'string' 
    ? { message: error }
    : error instanceof Error
      ? { message: error.message, stack: error.stack }
      : error
  
  const iconMap = {
    error: <AlertCircle className="w-6 h-6 text-error" />,
    warning: <AlertTriangle className="w-6 h-6 text-warning" />,
    info: <Info className="w-6 h-6 text-info" />
  }
  
  const bgColorMap = {
    error: 'bg-error/10',
    warning: 'bg-warning/10',
    info: 'bg-info/10'
  }
  
  const borderColorMap = {
    error: 'border-error/30',
    warning: 'border-warning/30',
    info: 'border-info/30'
  }
  
  const handleCopy = async () => {
    const text = [
      errorDetail.code && `Error Code: ${errorDetail.code}`,
      `Message: ${errorDetail.message}`,
      errorDetail.details && `Details: ${errorDetail.details}`,
      errorDetail.stack && `Stack Trace:\n${errorDetail.stack}`
    ].filter(Boolean).join('\n\n')
    
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[500px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            {iconMap[severity]}
            {title || (severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Information')}
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {/* Main message */}
          <div className={`p-4 rounded-lg border ${bgColorMap[severity]} ${borderColorMap[severity]}`}>
            {errorDetail.code && (
              <p className="text-xs font-mono text-text-faint mb-1">Code: {errorDetail.code}</p>
            )}
            <p className="text-text">{errorDetail.message}</p>
          </div>
          
          {/* Suggestions */}
          {errorDetail.suggestions && errorDetail.suggestions.length > 0 && (
            <div className="bg-bg-tertiary rounded-lg p-3">
              <p className="text-sm font-medium text-text-secondary mb-2">
                Suggested actions:
              </p>
              <ul className="space-y-1">
                {errorDetail.suggestions.map((suggestion, index) => (
                  <li 
                    key={index}
                    className="text-sm text-text-secondary flex items-start gap-2"
                  >
                    <span className="text-accent mt-0.5">•</span>
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Additional details (expandable) */}
          {(errorDetail.details || errorDetail.stack) && (
            <div>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-fast"
              >
                {showDetails ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                {showDetails ? 'Hide details' : 'Show details'}
              </button>
              
              {showDetails && (
                <div className="mt-2 space-y-2">
                  {errorDetail.details && (
                    <div className="bg-bg-tertiary rounded-lg p-3">
                      <p className="text-xs text-text-faint mb-1">Details:</p>
                      <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono overflow-auto max-h-32">
                        {errorDetail.details}
                      </pre>
                    </div>
                  )}
                  
                  {errorDetail.stack && (
                    <div className="bg-bg-tertiary rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-text-faint">Stack trace:</p>
                        <button
                          onClick={handleCopy}
                          className="btn-icon-sm text-text-muted hover:text-text"
                          title="Copy to clipboard"
                        >
                          {copied ? (
                            <Check className="w-3 h-3 text-success" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <pre className="text-xs text-text-faint whitespace-pre-wrap font-mono overflow-auto max-h-48">
                        {errorDetail.stack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          {onDismiss && (
            <button onClick={onDismiss} className="btn btn-secondary">
              Don't show again
            </button>
          )}
          <div className="flex-1" />
          {onRetry && (
            <button onClick={onRetry} className="btn btn-secondary">
              Retry
            </button>
          )}
          <button onClick={onClose} className="btn btn-primary">
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Helper to parse SVN error messages
 */
export function parseSvnError(error: string): ErrorDetail {
  const lines = error.split('\n')
  const message = lines[0] || 'An unknown error occurred'
  
  // Detect common SVN error patterns
  const suggestions: string[] = []
  
  if (error.includes('authentication') || error.includes('authorization')) {
    suggestions.push('Check your username and password')
    suggestions.push('Verify you have access to this repository')
  } else if (error.includes('conflict')) {
    suggestions.push('Resolve conflicts before continuing')
    suggestions.push('Use "Update" to get the latest changes')
  } else if (error.includes('out of date')) {
    suggestions.push('Update your working copy first')
    suggestions.push('Your local changes may conflict with newer revisions')
  } else if (error.includes('locked') || error.includes('lock')) {
    suggestions.push('Wait for the lock to be released')
    suggestions.push('Contact the lock owner or use "Cleanup"')
  } else if (error.includes('working copy')) {
    suggestions.push('Run "Cleanup" to fix working copy issues')
    suggestions.push('Try checking out a fresh copy')
  }
  
  return {
    message,
    details: lines.length > 1 ? lines.slice(1).join('\n') : undefined,
    suggestions
  }
}
