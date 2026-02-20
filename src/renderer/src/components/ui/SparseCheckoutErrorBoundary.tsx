import React, { Component, type ReactNode } from 'react'
import { AlertCircle, RefreshCw, AlertTriangle, Info } from 'lucide-react'
import { classifySparseError, type SparseCheckoutError } from '@renderer/utils/sparseErrorHandling'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  onRetry?: () => void
}

interface State {
  hasError: boolean
  error: SparseCheckoutError | null
  errorInfo: React.ErrorInfo | null
}

export class SparseCheckoutErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const classifiedError = classifySparseError(error)
    return {
      hasError: true,
      error: classifiedError
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
    this.props.onRetry?.()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error } = this.state
      if (!error) {
        return (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <AlertCircle className="w-12 h-12 text-error mb-4" />
            <h3 className="text-lg font-medium text-text mb-2">Something went wrong</h3>
            <p className="text-sm text-text-secondary mb-4">
              An unexpected error occurred.
            </p>
            {this.props.onRetry && (
              <button
                type="button"
                onClick={this.handleRetry}
                className="btn btn-secondary"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            )}
          </div>
        )
      }

      const iconMap = {
        NETWORK_FAILURE: <AlertTriangle className="w-12 h-12 text-warning" />,
        AUTH_REQUIRED: <AlertCircle className="w-12 h-12 text-accent" />,
        AUTH_FAILED: <AlertCircle className="w-12 h-12 text-error" />,
        PERMISSION_DENIED: <AlertCircle className="w-12 h-12 text-error" />,
        REPO_NOT_FOUND: <Info className="w-12 h-12 text-info" />,
        PATH_NOT_FOUND: <Info className="w-12 h-12 text-info" />,
        WORKING_COPY_ERROR: <AlertTriangle className="w-12 h-12 text-warning" />,
        TIMEOUT: <AlertTriangle className="w-12 h-12 text-warning" />,
        SSL_ERROR: <AlertTriangle className="w-12 h-12 text-warning" />,
        CONFLICT: <AlertTriangle className="w-12 h-12 text-warning" />,
        OUT_OF_DATE: <AlertTriangle className="w-12 h-12 text-warning" />,
        LOCKED: <AlertTriangle className="w-12 h-12 text-warning" />,
        UNKNOWN: <AlertCircle className="w-12 h-12 text-error" />
      }

      const bgColorMap = {
        NETWORK_FAILURE: 'bg-warning/10',
        AUTH_REQUIRED: 'bg-accent/10',
        AUTH_FAILED: 'bg-error/10',
        PERMISSION_DENIED: 'bg-error/10',
        REPO_NOT_FOUND: 'bg-info/10',
        PATH_NOT_FOUND: 'bg-info/10',
        WORKING_COPY_ERROR: 'bg-warning/10',
        TIMEOUT: 'bg-warning/10',
        SSL_ERROR: 'bg-warning/10',
        CONFLICT: 'bg-warning/10',
        OUT_OF_DATE: 'bg-warning/10',
        LOCKED: 'bg-warning/10',
        UNKNOWN: 'bg-error/10'
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[200px]">
          <div className={`rounded-full p-4 mb-4 ${bgColorMap[error.type]}`}>
            {iconMap[error.type]}
          </div>

          <h3 className="text-lg font-medium text-text mb-2">{error.title}</h3>
          <p className="text-sm text-text-secondary text-center max-w-md mb-4">
            {error.message}
          </p>

          {error.suggestions.length > 0 && (
            <div className="bg-surface-elevated rounded-lg p-4 max-w-md mb-4">
              <p className="text-xs font-medium text-text-secondary mb-2">Suggestions:</p>
              <ul className="space-y-1">
                {error.suggestions.map((suggestion, index) => (
                  <li
                    key={index}
                    className="text-sm text-text-secondary flex items-start gap-2"
                  >
                    <span className="text-accent mt-0.5 flex-shrink-0">•</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error.details && (
            <details className="w-full max-w-md mb-4">
              <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
                Show error details
              </summary>
              <pre className="mt-2 p-3 bg-bg-tertiary rounded text-xs text-text-faint overflow-auto max-h-32 font-mono">
                {error.details}
              </pre>
            </details>
          )}

          {error.retryable && this.props.onRetry && (
            <button
              type="button"
              onClick={this.handleRetry}
              className="btn btn-primary"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          )}
        </div>
      )
    }

    return this.props.children
  }
}

interface ErrorStateWrapperProps {
  error: Error | string | null
  onRetry?: () => void
  onAuthRequired?: () => void
  children: ReactNode
}

export function SparseErrorStateWrapper({
  error,
  onRetry,
  onAuthRequired,
  children
}: ErrorStateWrapperProps) {
  if (!error) {
    return <>{children}</>
  }

  const classifiedError = classifySparseError(error)

  const handleAction = () => {
    if (classifiedError.requiresAuth && onAuthRequired) {
      onAuthRequired()
    } else if (classifiedError.retryable && onRetry) {
      onRetry()
    }
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 min-h-[200px]">
      <AlertCircle className="w-12 h-12 text-error mb-4" />
      <h3 className="text-lg font-medium text-text mb-2">{classifiedError.title}</h3>
      <p className="text-sm text-text-secondary text-center max-w-md mb-4">
        {classifiedError.message}
      </p>

      {classifiedError.suggestions.length > 0 && (
        <div className="bg-surface-elevated rounded-lg p-4 max-w-md mb-4">
          <ul className="space-y-1">
            {classifiedError.suggestions.map((suggestion, index) => (
              <li
                key={index}
                className="text-sm text-text-secondary flex items-start gap-2"
              >
                <span className="text-accent mt-0.5">•</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(classifiedError.retryable || classifiedError.requiresAuth) && (onRetry || onAuthRequired) && (
        <button
          type="button"
          onClick={handleAction}
          className="btn btn-primary"
        >
          <RefreshCw className="w-4 h-4" />
          {classifiedError.requiresAuth ? 'Authenticate' : 'Try Again'}
        </button>
      )}
    </div>
  )
}

export default SparseCheckoutErrorBoundary
