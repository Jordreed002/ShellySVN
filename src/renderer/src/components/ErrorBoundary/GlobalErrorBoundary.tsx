/**
 * GlobalErrorBoundary - Catches unhandled errors at the application root level
 *
 * This is the last line of defense for error handling. It should be placed at the
 * top of the React tree to catch any errors that weren't caught by more specific
 * error boundaries.
 *
 * Features:
 * - Catches all unhandled React errors
 * - Provides automatic retry with exponential backoff
 * - Shows user-friendly error messages with suggestions
 * - Allows copying error details for support
 * - Supports development mode with full stack traces
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw, Home, Copy, Check, Bug, RotateCcw } from 'lucide-react'

/**
 * Classified error information for display
 */
interface ClassifiedError {
  title: string
  message: string
  details?: string
  suggestions: string[]
  retryable: boolean
  isFatal: boolean
}

/**
 * Classify an unknown error for display
 */
function classifyGlobalError(error: Error): ClassifiedError {
  const errorMsg = error.message.toLowerCase()
  const errorName = error.name.toLowerCase()

  // Chunk/Asset loading errors (common after deployments)
  if (
    errorMsg.includes('chunk') ||
    errorMsg.includes('loading chunk') ||
    errorMsg.includes('loading css') ||
    errorMsg.includes('script error') ||
    errorName === 'chunkerror'
  ) {
    return {
      title: 'Application Update Required',
      message: 'The application has been updated. A page refresh is required.',
      details: error.message,
      suggestions: [
        'Click "Reload Application" to load the latest version',
        'If the problem persists, clear your browser cache'
      ],
      retryable: true,
      isFatal: false
    }
  }

  // Network errors
  if (
    errorMsg.includes('network') ||
    errorMsg.includes('fetch') ||
    errorMsg.includes('failed to fetch') ||
    errorMsg.includes('networkerror') ||
    errorMsg.includes('offline')
  ) {
    return {
      title: 'Network Error',
      message: 'Unable to connect to the network. Please check your connection.',
      details: error.message,
      suggestions: [
        'Check your internet connection',
        'Try again in a few moments',
        'If using a VPN, ensure it is properly connected'
      ],
      retryable: true,
      isFatal: false
    }
  }

  // Memory errors
  if (errorMsg.includes('out of memory') || errorMsg.includes('heap')) {
    return {
      title: 'Memory Error',
      message: 'The application ran out of memory. Some operations may be too large.',
      details: error.message,
      suggestions: [
        'Try working with smaller files or folders',
        'Restart the application to free memory',
        'Close other applications to free system resources'
      ],
      retryable: false,
      isFatal: true
    }
  }

  // LocalStorage/Storage errors
  if (
    errorMsg.includes('quota') ||
    errorMsg.includes('storage') ||
    errorMsg.includes('localstorage')
  ) {
    return {
      title: 'Storage Error',
      message: 'There was a problem with local storage. Data may not be saved.',
      details: error.message,
      suggestions: [
        'Clear some application data in Settings',
        'Check available disk space',
        'Try restarting the application'
      ],
      retryable: false,
      isFatal: false
    }
  }

  // Permission errors
  if (errorMsg.includes('permission') || errorMsg.includes('access denied')) {
    return {
      title: 'Permission Denied',
      message: 'The application does not have permission to perform this action.',
      details: error.message,
      suggestions: [
        'Check file and folder permissions',
        'Run the application with appropriate privileges',
        'Ensure the path is accessible'
      ],
      retryable: false,
      isFatal: false
    }
  }

  // Default unknown error
  return {
    title: 'Unexpected Error',
    message: 'An unexpected error occurred. The application will attempt to recover.',
    details: error.message,
    suggestions: [
      'Try clicking "Try Again" to recover',
      'If the problem persists, restart the application',
      'Check the error details for more information'
    ],
    retryable: true,
    isFatal: false
  }
}

/**
 * Props for GlobalErrorBoundary
 */
export interface GlobalErrorBoundaryProps {
  children: ReactNode
  /** Custom fallback UI */
  fallback?: ReactNode
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Called when user clicks retry */
  onRetry?: () => void
  /** Called when user wants to reset to initial state */
  onReset?: () => void
  /** Maximum number of automatic retry attempts */
  maxRetries?: number
  /** Enable development mode with full stack traces */
  isDev?: boolean
}

/**
 * State for GlobalErrorBoundary
 */
interface GlobalErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  classifiedError: ClassifiedError | null
  retryCount: number
  isRetrying: boolean
  copied: boolean
}

/**
 * Global error boundary component that catches all unhandled errors
 * at the application root level.
 */
export class GlobalErrorBoundary extends Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null

  constructor(props: GlobalErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      classifiedError: null,
      retryCount: 0,
      isRetrying: false,
      copied: false
    }
  }

  static getDerivedStateFromError(error: Error): Partial<GlobalErrorBoundaryState> {
    const classifiedError = classifyGlobalError(error)
    return {
      hasError: true,
      error,
      classifiedError
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)

    // Log to console in development
    if (this.props.isDev ?? import.meta.env.DEV) {
      console.error('GlobalErrorBoundary caught an error:', error, errorInfo)
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
    }
  }

  /**
   * Handle retry with exponential backoff
   */
  handleRetry = async (): Promise<void> => {
    const { maxRetries = 3 } = this.props
    const { retryCount, classifiedError } = this.state

    if (!classifiedError?.retryable) {
      return
    }

    if (retryCount >= maxRetries) {
      // Max retries exceeded
      return
    }

    this.setState({ isRetrying: true })

    // Exponential backoff: 1s, 2s, 4s...
    const delay = Math.pow(2, retryCount) * 1000

    await new Promise<void>((resolve) => {
      this.retryTimeoutId = setTimeout(resolve, delay)
    })

    this.setState((prev) => ({
      retryCount: prev.retryCount + 1,
      isRetrying: false
    }))

    this.props.onRetry?.()
    this.resetErrorBoundary()
  }

  /**
   * Reset the error boundary state
   */
  resetErrorBoundary = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      classifiedError: null,
      retryCount: 0,
      isRetrying: false
    })
    this.props.onReset?.()
  }

  /**
   * Copy error details to clipboard
   */
  handleCopyError = async (): Promise<void> => {
    const { error, errorInfo, classifiedError } = this.state

    const text = [
      `Error: ${classifiedError?.title || 'Unknown'}`,
      `Message: ${error?.message || 'No message'}`,
      classifiedError?.details && `Details: ${classifiedError.details}`,
      errorInfo?.componentStack && `Component Stack:\n${errorInfo.componentStack}`,
      error?.stack && `Stack Trace:\n${error.stack}`
    ]
      .filter(Boolean)
      .join('\n\n')

    await navigator.clipboard.writeText(text)
    this.setState({ copied: true })
    setTimeout(() => this.setState({ copied: false }), 2000)
  }

  /**
   * Reload the application
   */
  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { children, fallback, isDev, maxRetries = 3 } = this.props
    const { hasError, error, errorInfo, classifiedError, retryCount, isRetrying, copied } = this.state

    if (hasError) {
      if (fallback) {
        return fallback
      }

      const showDevInfo = isDev ?? import.meta.env.DEV
      const canRetry = classifiedError?.retryable && retryCount < maxRetries

      return (
        <div className="fixed inset-0 bg-bg flex items-center justify-center p-8 z-[9999]">
          <div className="max-w-2xl w-full">
            {/* Error icon and title */}
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-20 h-20 rounded-full bg-error/10 flex items-center justify-center mb-6">
                <AlertTriangle className="w-10 h-10 text-error" />
              </div>
              <h1 className="text-2xl font-bold text-text mb-2">
                {classifiedError?.title || 'Something went wrong'}
              </h1>
              <p className="text-text-secondary max-w-md">
                {classifiedError?.message || 'An unexpected error occurred.'}
              </p>
            </div>

            {/* Suggestions */}
            {classifiedError?.suggestions && classifiedError.suggestions.length > 0 && (
              <div className="bg-surface-elevated rounded-lg p-4 mb-6">
                <p className="text-sm font-medium text-text-secondary mb-3">
                  What you can try:
                </p>
                <ul className="space-y-2">
                  {classifiedError.suggestions.map((suggestion, index) => (
                    <li
                      key={index}
                      className="text-sm text-text-secondary flex items-start gap-2"
                    >
                      <span className="text-accent mt-0.5 flex-shrink-0">-</span>
                      <span>{suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Retry indicator */}
            {isRetrying && (
              <div className="flex items-center justify-center gap-2 mb-6 text-text-secondary">
                <RotateCcw className="w-4 h-4 animate-spin" />
                <span className="text-sm">Retrying...</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
              {canRetry && (
                <button
                  type="button"
                  onClick={this.handleRetry}
                  disabled={isRetrying}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                  Try Again
                  {retryCount > 0 && (
                    <span className="text-xs opacity-70">({retryCount}/{maxRetries})</span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={this.handleReload}
                className="btn btn-secondary flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Application
              </button>

              <button
                type="button"
                onClick={this.resetErrorBoundary}
                className="btn btn-secondary flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                Go to Home
              </button>
            </div>

            {/* Error details (expandable) */}
            {showDevInfo && (
              <div className="bg-bg-tertiary rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Bug className="w-4 h-4 text-text-muted" />
                    <span className="text-sm font-medium text-text-secondary">
                      Developer Info
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={this.handleCopyError}
                    className="btn-icon-sm text-text-muted hover:text-text"
                    title="Copy error details"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="p-4 space-y-3 max-h-64 overflow-auto">
                  {error && (
                    <div>
                      <p className="text-xs text-text-faint mb-1">Error Message:</p>
                      <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap">
                        {error.message}
                      </pre>
                    </div>
                  )}

                  {error?.stack && (
                    <div>
                      <p className="text-xs text-text-faint mb-1">Stack Trace:</p>
                      <pre className="text-xs text-text-faint font-mono whitespace-pre-wrap overflow-x-auto">
                        {error.stack}
                      </pre>
                    </div>
                  )}

                  {errorInfo?.componentStack && (
                    <div>
                      <p className="text-xs text-text-faint mb-1">Component Stack:</p>
                      <pre className="text-xs text-text-faint font-mono whitespace-pre-wrap overflow-x-auto">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )
    }

    return children
  }
}

export default GlobalErrorBoundary
