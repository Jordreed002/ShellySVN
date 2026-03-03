/**
 * ErrorBoundary Module
 *
 * This module provides a comprehensive error boundary system for React applications:
 *
 * 1. GlobalErrorBoundary - Catches unhandled errors at the application root
 *    - Place at the top of the React tree
 *    - Shows full-screen error UI when errors aren't caught elsewhere
 *    - Provides app-wide recovery options (reload, reset)
 *
 * 2. RouteErrorBoundary - Catches errors at the route level
 *    - Wraps individual routes for localized error handling
 *    - Preserves application chrome (sidebar, navigation)
 *    - Provides route-specific recovery options (back, home, retry)
 *
 * 3. withErrorBoundary HOC - Wraps components with error boundaries
 *    - For critical components that need isolated error handling
 *    - Provides component-level retry and fallback options
 */

import { Component, type ReactNode, type ErrorInfo, type ComponentType } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

// Re-export the main components
export { GlobalErrorBoundary, type GlobalErrorBoundaryProps } from './GlobalErrorBoundary'
export { RouteErrorBoundary } from './RouteErrorBoundary'

/**
 * Common props for all error boundary types
 */
export interface ErrorBoundaryBaseProps {
  children: ReactNode
  /** Custom fallback UI to show when an error occurs */
  fallback?: ReactNode
  /** Callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Callback when user clicks retry */
  onRetry?: () => void
  /** Maximum retry attempts before giving up */
  maxRetries?: number
  /** Enable development mode with full stack traces */
  isDev?: boolean
}

/**
 * Props for the withErrorBoundary HOC
 */
export interface WithErrorBoundaryOptions {
  /** Name displayed in error UI */
  displayName?: string
  /** Custom fallback component */
  FallbackComponent?: ComponentType<{ error: Error; retry: () => void }>
  /** Callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Maximum retry attempts */
  maxRetries?: number
  /** Show retry button */
  showRetry?: boolean
}

/**
 * State for ComponentErrorBoundary
 */
interface ComponentErrorBoundaryState {
  hasError: boolean
  error: Error | null
  retryCount: number
}

/**
 * Internal error boundary class for the HOC
 */
class ComponentErrorBoundary extends Component<
  {
    children: ReactNode
    FallbackComponent?: ComponentType<{ error: Error; retry: () => void }>
    displayName?: string
    onError?: (error: Error, errorInfo: ErrorInfo) => void
    onRetry?: () => void
    maxRetries: number
    showRetry: boolean
  },
  ComponentErrorBoundaryState
> {
  constructor(props: ComponentErrorBoundary['props']) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ComponentErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo)

    if (import.meta.env.DEV) {
      console.error('ComponentErrorBoundary caught an error:', error, errorInfo)
    }
  }

  handleRetry = (): void => {
    const { maxRetries, onRetry } = this.props
    const { retryCount } = this.state

    if (retryCount >= maxRetries) {
      return
    }

    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1
    }))

    onRetry?.()
  }

  render(): ReactNode {
    const { children, FallbackComponent, displayName, showRetry, maxRetries } = this.props
    const { hasError, error, retryCount } = this.state

    if (hasError && error) {
      // Use custom fallback component if provided
      if (FallbackComponent) {
        return <FallbackComponent error={error} retry={this.handleRetry} />
      }

      // Default fallback UI
      const canRetry = showRetry && retryCount < maxRetries

      return (
        <div className="flex flex-col items-center justify-center p-6 min-h-[200px] bg-surface-elevated/50 rounded-lg border border-border">
          <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 text-error" />
          </div>

          <h3 className="text-base font-medium text-text mb-1">
            {displayName ? `${displayName} Error` : 'Component Error'}
          </h3>

          <p className="text-sm text-text-secondary text-center max-w-sm mb-4">
            {error.message || 'An error occurred in this component.'}
          </p>

          {canRetry && (
            <button
              type="button"
              onClick={this.handleRetry}
              className="btn btn-secondary btn-sm flex items-center gap-2"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
              {retryCount > 0 && (
                <span className="text-xs opacity-70">({retryCount}/{maxRetries})</span>
              )}
            </button>
          )}
        </div>
      )
    }

    return children
  }
}

/**
 * Higher-Order Component that wraps a component with an error boundary.
 *
 * Use this for critical components that need isolated error handling,
 * where you want to prevent errors from bubbling up to route or global boundaries.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const SafeFileExplorer = withErrorBoundary(FileExplorer, {
 *   displayName: 'File Explorer'
 * })
 *
 * // With custom fallback
 * const SafeDataView = withErrorBoundary(DataView, {
 *   displayName: 'Data View',
 *   FallbackComponent: ({ error, retry }) => (
 *     <div>
 *       <p>Error: {error.message}</p>
 *       <button onClick={retry}>Retry</button>
 *     </div>
 *   )
 * })
 * ```
 */
export function withErrorBoundary<P extends object>(
  Component: ComponentType<P>,
  options: WithErrorBoundaryOptions = {}
): ComponentType<P> {
  const {
    displayName,
    FallbackComponent,
    onError,
    maxRetries = 3,
    showRetry = true
  } = options

  const WrappedComponent = (props: P) => (
    <ComponentErrorBoundary
      displayName={displayName || Component.displayName || Component.name || 'Component'}
      FallbackComponent={FallbackComponent}
      onError={onError}
      maxRetries={maxRetries}
      showRetry={showRetry}
    >
      <Component {...props} />
    </ComponentErrorBoundary>
  )

  WrappedComponent.displayName = `withErrorBoundary(${displayName || Component.displayName || Component.name || 'Component'})`

  return WrappedComponent
}

/**
 * Hook to create an error boundary reset handler
 * This can be useful for programmatically resetting error boundaries
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const resetError = useErrorBoundaryReset()
 *
 *   const handleSomething = () => {
 *     try {
 *       // ... risky operation
 *     } catch (error) {
 *       resetError()
 *     }
 *   }
 * }
 * ```
 */
export function useErrorBoundaryReset(): () => void {
  // This is a placeholder - in a real implementation you'd use context
  // to communicate with the nearest error boundary
  return () => {
    console.warn('useErrorBoundaryReset: No error boundary context found')
  }
}

/**
 * Default export - the main components
 */
export default {
  GlobalErrorBoundary,
  RouteErrorBoundary,
  withErrorBoundary
}
