/**
 * Error handling utilities for ShellySVN
 * 
 * Provides consistent error handling across the application
 */

/**
 * Base error class for ShellySVN errors
 */
export class ShellySVNError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ShellySVNError'
  }
}

/**
 * SVN command execution error
 */
export class SvnExecutionError extends ShellySVNError {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stdout?: string,
    public readonly stderr?: string
  ) {
    super(message, 'SVN_EXECUTION_ERROR', { exitCode, stdout, stderr })
    this.name = 'SvnExecutionError'
  }
}

/**
 * Working copy error
 */
export class WorkingCopyError extends ShellySVNError {
  constructor(message: string, public readonly path: string) {
    super(message, 'WORKING_COPY_ERROR', { path })
    this.name = 'WorkingCopyError'
  }
}

/**
 * Conflict error
 */
export class ConflictError extends ShellySVNError {
  constructor(message: string, public readonly conflictedPaths: string[]) {
    super(message, 'CONFLICT_ERROR', { conflictedPaths })
    this.name = 'ConflictError'
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends ShellySVNError {
  constructor(message: string, public readonly realm?: string) {
    super(message, 'AUTHENTICATION_ERROR', { realm })
    this.name = 'AuthenticationError'
  }
}

/**
 * Network error
 */
export class NetworkError extends ShellySVNError {
  constructor(message: string, public readonly url?: string) {
    super(message, 'NETWORK_ERROR', { url })
    this.name = 'NetworkError'
  }
}

/**
 * Parse SVN error message from stderr
 */
export function parseSvnError(stderr: string): ShellySVNError {
  if (!stderr) {
    return new ShellySVNError('Unknown SVN error', 'UNKNOWN_ERROR')
  }

  const lower = stderr.toLowerCase()

  // Authentication errors
  if (lower.includes('authentication') || lower.includes('authorization') || lower.includes('access forbidden')) {
    const realmMatch = stderr.match(/realm:\s*(.+)/i)
    return new AuthenticationError(
      'Authentication failed',
      realmMatch ? realmMatch[1].trim() : undefined
    )
  }

  // Conflict errors
  if (lower.includes('conflict') || lower.includes('conflicted')) {
    const paths = extractPaths(stderr)
    return new ConflictError(
      'Conflicts detected',
      paths
    )
  }

  // Network errors
  if (lower.includes('connection') || lower.includes('network') || lower.includes('timeout') || lower.includes('host')) {
    const urlMatch = stderr.match(/(https?:\/\/[^\s]+)/i)
    return new NetworkError(
      'Network error occurred',
      urlMatch ? urlMatch[1] : undefined
    )
  }

  // Working copy errors
  if (lower.includes('working copy') || lower.includes('locked') || lower.includes('cleanup')) {
    const pathMatch = stderr.match(/path:\s*(.+)/i)
    return new WorkingCopyError(
      'Working copy error',
      pathMatch ? pathMatch[1].trim() : ''
    )
  }

  // Generic error
  return new ShellySVNError(
    stderr.split('\n')[0] || 'SVN operation failed',
    'SVN_ERROR',
    { rawError: stderr }
  )
}

/**
 * Extract file paths from error message
 */
function extractPaths(text: string): string[] {
  const paths: string[] = []
  const pathPattern = /["']?([A-Za-z]:\\[^\s"']+|\/[^\s"']+)["']?/g
  let match
  
  while ((match = pathPattern.exec(text)) !== null) {
    paths.push(match[1])
  }
  
  return [...new Set(paths)] // Remove duplicates
}

/**
 * Error result type for operations
 */
export interface ErrorResult {
  success: false
  error: ShellySVNError
}

/**
 * Success result type for operations
 */
export interface SuccessResult<T = void> {
  success: true
  data?: T
}

/**
 * Result type combining success and error
 */
export type Result<T = void> = SuccessResult<T> | ErrorResult

/**
 * Type guard for error result
 */
export function isErrorResult<T>(result: Result<T>): result is ErrorResult {
  return result.success === false
}

/**
 * Type guard for success result
 */
export function isSuccessResult<T>(result: Result<T>): result is SuccessResult<T> {
  return result.success === true
}

/**
 * Wrap async operation with error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  errorCode: string = 'OPERATION_ERROR'
): Promise<Result<T>> {
  try {
    const data = await operation()
    return { success: true, data }
  } catch (error) {
    if (error instanceof ShellySVNError) {
      return { success: false, error }
    }
    
    return {
      success: false,
      error: new ShellySVNError(
        error instanceof Error ? error.message : 'Unknown error',
        errorCode,
        { originalError: error }
      )
    }
  }
}

/**
 * Retry an operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelay?: number
    maxDelay?: number
    backoffFactor?: number
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2
  } = options

  let lastError: Error | null = null
  let delay = initialDelay

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      if (attempt === maxRetries) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, delay))
      delay = Math.min(delay * backoffFactor, maxDelay)
    }
  }

  throw lastError
}

export default {
  ShellySVNError,
  SvnExecutionError,
  WorkingCopyError,
  ConflictError,
  AuthenticationError,
  NetworkError,
  parseSvnError,
  isErrorResult,
  isSuccessResult,
  withErrorHandling,
  withRetry
}
