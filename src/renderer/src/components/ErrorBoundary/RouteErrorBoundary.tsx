/**
 * RouteErrorBoundary - Catches errors at the route level
 *
 * This error boundary wraps individual routes to provide localized error handling.
 * When an error occurs, it shows a user-friendly error UI while preserving the
 * application shell (sidebar, navigation, etc.).
 *
 * Features:
 * - Localized error handling per route
 * - Automatic retry with exponential backoff
 * - Navigation options to go back or to home
 * - Integrates with TanStack Router for navigation
 * - Preserves application chrome when errors occur
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import {
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  Home,
  Bug,
  Copy,
  Check,
  FileQuestion
} from 'lucide-react'

/**
 * Props wrapper component for route navigation
 */
interface RouteErrorBoundaryWrapperProps {
  children: ReactNode
  /** Name of the route for error context */
  routeName?: string
  /** Custom fallback UI */
  fallback?: ReactNode
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Called when user clicks retry */
  onRetry?: () => void
  /** Show navigation actions (back/home) */
  showNavigation?: boolean
  /** Maximum retry attempts */
  maxRetries?: number
  /** Enable development mode with stack traces */
  isDev?: boolean
}

/**
 * Inner component that has access to router hooks
 */
function RouteErrorBoundaryWithRouter({
  children,
  routeName,
  fallback,
  onError,
  onRetry,
  showNavigation = true,
  maxRetries = 3,
  isDev
}: RouteErrorBoundaryWrapperProps) {
  const navigate = useNavigate()
  const router = useRouter()

  const handleGoBack = () => {
    // Try to go back in history, otherwise go home
    if (window.history.length > 1) {
      router.history.go(-1)
    } else {
      navigate({ to: '/' })
    }
  }

  const handleGoHome = () => {
    navigate({ to: '/' })
  }

  const handleRetry = () => {
    onRetry?.()
    // Force a re-render by invalidating the route
    router.invalidate()
  }

  return (
    <RouteErrorBoundaryInner
      routeName={routeName}
      fallback={fallback}
      onError={onError}
      onRetry={handleRetry}
      onGoBack={showNavigation ? handleGoBack : undefined}
      onGoHome={showNavigation ? handleGoHome : undefined}
      maxRetries={maxRetries}
      isDev={isDev}
    >
      {children}
    </RouteErrorBoundaryInner>
  )
}

/**
 * Classified route error information
 */
interface ClassifiedRouteError {
  title: string
  message: string
  details?: string
  suggestions: string[]
  retryable: boolean
  icon: 'error' | 'not-found' | 'warning'
}

/**
 * Classify an error for route-level display
 */
function classifyRouteError(error: Error, routeName?: string): ClassifiedRouteError {
  const errorMsg = error.message.toLowerCase()

  // Data fetching errors
  if (
    errorMsg.includes('failed to fetch') ||
    errorMsg.includes('network') ||
    errorMsg.includes('timeout')
  ) {
    return {
      title: 'Unable to Load Data',
      message: 'There was a problem loading the data for this page.',
      details: error.message,
      suggestions: [
        'Check your network connection',
        'Try refreshing the page',
        'The server may be temporarily unavailable'
      ],
      retryable: true,
      icon: 'warning'
    }
  }

  // Not found errors
  if (
    errorMsg.includes('not found') ||
    errorMsg.includes('404') ||
    errorMsg.includes('does not exist')
  ) {
    return {
      title: 'Page Not Found',
      message: 'The content you are looking for could not be found.',
      details: error.message,
      suggestions: [
        'The content may have been moved or deleted',
        'Check the URL for errors',
        'Navigate to a different section'
      ],
      retryable: false,
      icon: 'not-found'
    }
  }

  // Permission errors
  if (errorMsg.includes('permission') || errorMsg.includes('access denied')) {
    return {
      title: 'Access Denied',
      message: 'You do not have permission to view this content.',
      details: error.message,
      suggestions: [
        'Contact an administrator for access',
        'Try authenticating with different credentials'
      ],
      retryable: false,
      icon: 'error'
    }
  }

  // SVN-specific errors
  if (
    errorMsg.includes('svn') ||
    errorMsg.includes('working copy') ||
    errorMsg.includes('repository')
  ) {
    return {
      title: 'SVN Error',
      message: 'There was a problem with the SVN operation.',
      details: error.message,
      suggestions: [
        'Check that the working copy is valid',
        'Try running Cleanup on the working copy',
        'Verify the repository URL is correct'
      ],
      retryable: true,
      icon: 'warning'
    }
  }

  // Default error
  return {
    title: `${routeName || 'Page'} Error`,
    message: 'An error occurred while loading this page.',
    details: error.message,
    suggestions: [
      'Try refreshing the page',
      'Go back and try again',
      'If the problem persists, contact support'
    ],
    retryable: true,
    icon: 'error'
  }
}

/**
 * State for RouteErrorBoundaryInner
 */
interface RouteErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  classifiedError: ClassifiedRouteError | null
  retryCount: number
  isRetrying: boolean
  copied: boolean
}

/**
 * Inner error boundary component (class component required for error boundaries)
 */
class RouteErrorBoundaryInner extends Component<
  {
    children: ReactNode
    routeName?: string
    fallback?: ReactNode
    onError?: (error: Error, errorInfo: ErrorInfo) => void
    onRetry: () => void
    onGoBack?: () => void
    onGoHome?: () => void
    maxRetries: number
    isDev?: boolean
  },
  RouteErrorBoundaryState
> {
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null

  constructor(props: RouteErrorBoundaryInner['props']) {
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

  static getDerivedStateFromError(
    error: Error,
    props: RouteErrorBoundaryInner['props']
  ): Partial<RouteErrorBoundaryState> {
    const classifiedError = classifyRouteError(error, props.routeName)
    return {
      hasError: true,
      error,
      classifiedError
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)

    if (this.props.isDev ?? import.meta.env.DEV) {
      console.error('RouteErrorBoundary caught an error:', error, errorInfo)
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
    }
  }

  handleRetry = async (): Promise<void> => {
    const { maxRetries } = this.props
    const { retryCount, classifiedError } = this.state

    if (!classifiedError?.retryable || retryCount >= maxRetries) {
      return
    }

    this.setState({ isRetrying: true })

    // Exponential backoff
    const delay = Math.pow(2, retryCount) * 500

    await new Promise<void>((resolve) => {
      this.retryTimeoutId = setTimeout(resolve, delay)
    })

    this.setState((prev) => ({
      retryCount: prev.retryCount + 1,
      isRetrying: false
    }))

    this.props.onRetry()
    this.resetErrorBoundary()
  }

  resetErrorBoundary = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      classifiedError: null,
      retryCount: 0,
      isRetrying: false
    })
  }

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

  render(): ReactNode {
    const {
      children,
      fallback,
      onGoBack,
      onGoHome,
      maxRetries,
      isDev
    } = this.props
    const { hasError, error, errorInfo, classifiedError, retryCount, isRetrying, copied } = this.state

    if (hasError) {
      if (fallback) {
        return fallback
      }

      const showDevInfo = isDev ?? import.meta.env.DEV
      const canRetry = classifiedError?.retryable && retryCount < maxRetries

      const iconMap = {
        error: <AlertCircle className="w-12 h-12 text-error" />,
        'not-found': <FileQuestion className="w-12 h-12 text-text-muted" />,
        warning: <AlertCircle className="w-12 h-12 text-warning" />
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[400px]">
          {/* Error icon */}
          <div className="w-16 h-16 rounded-full bg-surface-elevated flex items-center justify-center mb-6">
            {classifiedError ? iconMap[classifiedError.icon] : iconMap.error}
          </div>

          {/* Title and message */}
          <h2 className="text-xl font-semibold text-text mb-2">
            {classifiedError?.title || 'Something went wrong'}
          </h2>
          <p className="text-text-secondary text-center max-w-md mb-6">
            {classifiedError?.message || 'An unexpected error occurred.'}
          </p>

          {/* Suggestions */}
          {classifiedError?.suggestions && classifiedError.suggestions.length > 0 && (
            <div className="bg-surface-elevated rounded-lg p-4 max-w-md w-full mb-6">
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
            <div className="flex items-center gap-2 mb-4 text-text-secondary">
              <RefreshCw className="w-4 h-4 animate-spin" />
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

            {onGoBack && (
              <button
                type="button"
                onClick={onGoBack}
                className="btn btn-secondary flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Go Back
              </button>
            )}

            {onGoHome && (
              <button
                type="button"
                onClick={onGoHome}
                className="btn btn-secondary flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                Go to Home
              </button>
            )}
          </div>

          {/* Error details (development mode) */}
          {showDevInfo && (
            <details className="w-full max-w-md">
              <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary flex items-center gap-2">
                <Bug className="w-3 h-3" />
                Show error details
              </summary>
              <div className="mt-3 p-3 bg-bg-tertiary rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-faint">Error Details</p>
                  <button
                    type="button"
                    onClick={this.handleCopyError}
                    className="text-text-muted hover:text-text"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {error && (
                  <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap overflow-auto">
                    {error.message}
                  </pre>
                )}

                {error?.stack && (
                  <pre className="text-xs text-text-faint font-mono whitespace-pre-wrap overflow-auto max-h-32">
                    {error.stack}
                  </pre>
                )}

                {errorInfo?.componentStack && (
                  <pre className="text-xs text-text-faint font-mono whitespace-pre-wrap overflow-auto max-h-32">
                    {errorInfo.componentStack}
                  </pre>
                )}
              </div>
            </details>
          )}
        </div>
      )
    }

    return children
  }
}

/**
 * RouteErrorBoundary - Wraps route components with error handling
 *
 * Usage:
 * ```tsx
 * export const Route = createFileRoute('/files/')({
 *   component: () => (
 *     <RouteErrorBoundary routeName="Files">
 *       <FileExplorer />
 *     </RouteErrorBoundary>
 *   )
 * })
 * ```
 */
export function RouteErrorBoundary(props: RouteErrorBoundaryWrapperProps) {
  return <RouteErrorBoundaryWithRouter {...props} />
}

export default RouteErrorBoundary
