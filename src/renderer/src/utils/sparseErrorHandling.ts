/**
 * Sparse Checkout Error Handling Utilities
 * Provides comprehensive error handling, classification, and user-friendly messages
 */

import { type AppError } from '@shared/errors'

export const SparseErrorType = {
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FAILED: 'AUTH_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  REPO_NOT_FOUND: 'REPO_NOT_FOUND',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  WORKING_COPY_ERROR: 'WORKING_COPY_ERROR',
  TIMEOUT: 'TIMEOUT',
  SSL_ERROR: 'SSL_ERROR',
  CONFLICT: 'CONFLICT',
  OUT_OF_DATE: 'OUT_OF_DATE',
  LOCKED: 'LOCKED',
  UNKNOWN: 'UNKNOWN'
} as const

export type SparseErrorTypeValue = typeof SparseErrorType[keyof typeof SparseErrorType]

/**
 * Structured error for sparse checkout operations
 */
export interface SparseCheckoutError {
  type: SparseErrorTypeValue
  title: string
  message: string
  details?: string
  suggestions: string[]
  retryable: boolean
  requiresAuth: boolean
  originalError?: Error | string
}

/**
 * Classify an error from SVN operations
 */
export function classifySparseError(error: Error | string | unknown): SparseCheckoutError {
  const errorMsg = error instanceof Error ? error.message : String(error)
  const lowerMsg = errorMsg.toLowerCase()

  // Network errors
  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('connection') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('could not resolve hostname') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enetwork')
  ) {
    return {
      type: SparseErrorType.NETWORK_FAILURE,
      title: 'Network Error',
      message: 'Unable to connect to the repository server.',
      details: errorMsg,
      suggestions: [
        'Check your internet connection',
        'Verify the repository URL is correct',
        'The server may be temporarily unavailable',
        'Try again in a few moments'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // Authentication required
  if (
    lowerMsg.includes('authentication required') ||
    lowerMsg.includes('credentials') ||
    lowerMsg.includes('authorization required') ||
    lowerMsg.includes('access forbidden')
  ) {
    return {
      type: SparseErrorType.AUTH_REQUIRED,
      title: 'Authentication Required',
      message: 'This repository requires authentication.',
      details: errorMsg,
      suggestions: [
        'Enter your username and password',
        'Check that you have access to this repository',
        'Contact the repository administrator if needed'
      ],
      retryable: true,
      requiresAuth: true,
      originalError: error
    }
  }

  // Authentication failed
  if (
    lowerMsg.includes('authentication failed') ||
    lowerMsg.includes('authorization failed') ||
    lowerMsg.includes('invalid credentials') ||
    lowerMsg.includes('access denied')
  ) {
    return {
      type: SparseErrorType.AUTH_FAILED,
      title: 'Authentication Failed',
      message: 'The provided credentials were not accepted.',
      details: errorMsg,
      suggestions: [
        'Check your username and password',
        'Ensure your account has not been locked',
        'Contact the repository administrator'
      ],
      retryable: true,
      requiresAuth: true,
      originalError: error
    }
  }

  // Permission denied
  if (
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('access is denied') ||
    lowerMsg.includes('forbidden')
  ) {
    return {
      type: SparseErrorType.PERMISSION_DENIED,
      title: 'Permission Denied',
      message: 'You do not have permission to access this resource.',
      details: errorMsg,
      suggestions: [
        'Contact the repository administrator',
        'Verify your account has the necessary permissions',
        'You may need to be added to an access control list'
      ],
      retryable: false,
      requiresAuth: false,
      originalError: error
    }
  }

  // Repository not found
  if (
    lowerMsg.includes('repository not found') ||
    lowerMsg.includes('does not exist') ||
    lowerMsg.includes('no repository found') ||
    lowerMsg.includes('404')
  ) {
    return {
      type: SparseErrorType.REPO_NOT_FOUND,
      title: 'Repository Not Found',
      message: 'The repository could not be found at the specified URL.',
      details: errorMsg,
      suggestions: [
        'Verify the repository URL is correct',
        'The repository may have been moved or deleted',
        'Check for typos in the URL'
      ],
      retryable: false,
      requiresAuth: false,
      originalError: error
    }
  }

  // Path not found
  if (
    lowerMsg.includes('path not found') ||
    lowerMsg.includes('file not found') ||
    lowerMsg.includes('directory not found')
  ) {
    return {
      type: SparseErrorType.PATH_NOT_FOUND,
      title: 'Path Not Found',
      message: 'The specified path does not exist in the repository.',
      details: errorMsg,
      suggestions: [
        'The path may have been moved or deleted',
        'Refresh the directory listing',
        'Check the path for typos'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // SSL/Certificate errors
  if (
    lowerMsg.includes('certificate') ||
    lowerMsg.includes('ssl') ||
    lowerMsg.includes('tls') ||
    lowerMsg.includes('secure connection')
  ) {
    return {
      type: SparseErrorType.SSL_ERROR,
      title: 'Certificate Error',
      message: 'There was a problem with the server\'s security certificate.',
      details: errorMsg,
      suggestions: [
        'The certificate may be self-signed or expired',
        'You can choose to trust the certificate temporarily',
        'Contact your administrator about the certificate issue'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // Timeout
  if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('operation timed out')
  ) {
    return {
      type: SparseErrorType.TIMEOUT,
      title: 'Operation Timeout',
      message: 'The operation took too long to complete.',
      details: errorMsg,
      suggestions: [
        'The server may be slow or overloaded',
        'Try again with a smaller selection',
        'Check your network connection speed'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // Conflict
  if (lowerMsg.includes('conflict')) {
    return {
      type: SparseErrorType.CONFLICT,
      title: 'Conflict Detected',
      message: 'A conflict was detected during the operation.',
      details: errorMsg,
      suggestions: [
        'Resolve conflicts before continuing',
        'Update your working copy first',
        'Check for local modifications that may conflict'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // Out of date
  if (lowerMsg.includes('out of date') || lowerMsg.includes('out-of-date')) {
    return {
      type: SparseErrorType.OUT_OF_DATE,
      title: 'Working Copy Out of Date',
      message: 'Your working copy is out of date.',
      details: errorMsg,
      suggestions: [
        'Update your working copy first',
        'Pull the latest changes from the repository',
        'Your local changes may need to be merged'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // Locked
  if (lowerMsg.includes('locked') || lowerMsg.includes('is locked')) {
    return {
      type: SparseErrorType.LOCKED,
      title: 'Resource Locked',
      message: 'The resource is currently locked.',
      details: errorMsg,
      suggestions: [
        'Wait for the lock to be released',
        'Contact the lock owner',
        'Use cleanup to remove stale locks'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // Working copy error
  if (
    lowerMsg.includes('working copy') ||
    lowerMsg.includes('wc') ||
    lowerMsg.includes('.svn')
  ) {
    return {
      type: SparseErrorType.WORKING_COPY_ERROR,
      title: 'Working Copy Error',
      message: 'There is a problem with the working copy.',
      details: errorMsg,
      suggestions: [
        'Run cleanup on the working copy',
        'The working copy may be corrupted',
        'Consider checking out a fresh copy'
      ],
      retryable: true,
      requiresAuth: false,
      originalError: error
    }
  }

  // Default unknown error
  return {
    type: SparseErrorType.UNKNOWN,
    title: 'Unexpected Error',
    message: 'An unexpected error occurred during sparse checkout.',
    details: errorMsg,
    suggestions: [
      'Try the operation again',
      'Check the error details for more information',
      'Contact support if the problem persists'
    ],
    retryable: true,
    requiresAuth: false,
    originalError: error
  }
}

/**
 * Check if an error requires authentication
 */
export function requiresAuthentication(error: Error | string | unknown): boolean {
  return classifySparseError(error).requiresAuth
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: Error | string | unknown): boolean {
  return classifySparseError(error).retryable
}

/**
 * Check if error is network related
 */
export function isNetworkError(error: Error | string | unknown): boolean {
  const classified = classifySparseError(error)
  return (
    classified.type === SparseErrorType.NETWORK_FAILURE ||
    classified.type === SparseErrorType.TIMEOUT
  )
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyMessage(error: Error | string | unknown): string {
  const classified = classifySparseError(error)
  return classified.message
}

/**
 * Convert AppError to SparseCheckoutError
 */
export function appErrorToSparseError(appError: AppError): SparseCheckoutError {
  const error = new Error(appError.message)
  error.cause = appError.cause

  const classified = classifySparseError(error)
  
  // Override with AppError details if available
  return {
    ...classified,
    details: appError.details ? JSON.stringify(appError.details, null, 2) : classified.details
  }
}

/**
 * Session credentials cache (memory only, not persisted)
 */
class CredentialCache {
  private cache = new Map<string, { username: string; password: string }>()

  getKey(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}`
    } catch {
      return url
    }
  }

  set(url: string, credentials: { username: string; password: string }): void {
    this.cache.set(this.getKey(url), credentials)
  }

  get(url: string): { username: string; password: string } | undefined {
    return this.cache.get(this.getKey(url))
  }

  clear(url?: string): void {
    if (url) {
      this.cache.delete(this.getKey(url))
    } else {
      this.cache.clear()
    }
  }

  has(url: string): boolean {
    return this.cache.has(this.getKey(url))
  }
}

export const credentialCache = new CredentialCache()

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number
  delayMs: number
  backoffMultiplier: number
  onRetry?: (attempt: number, error: Error) => void
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    onRetry
  } = config

  let lastError: Error | undefined
  let delay = delayMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      const classified = classifySparseError(lastError)
      
      // Don't retry non-retryable errors
      if (!classified.retryable) {
        throw lastError
      }

      // Don't retry auth errors - let the user handle them
      if (classified.requiresAuth) {
        throw lastError
      }

      // Last attempt, throw
      if (attempt === maxAttempts) {
        throw lastError
      }

      onRetry?.(attempt, lastError)

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay))
      delay *= backoffMultiplier
    }
  }

  throw lastError
}
