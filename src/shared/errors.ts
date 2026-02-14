/**
 * Standardized error types for IPC communication
 * Provides consistent error handling across main and renderer processes
 */

/**
 * Error codes for categorizing errors
 */
export enum ErrorCode {
  // General errors
  UNKNOWN = 'UNKNOWN',
  INVALID_INPUT = 'INVALID_INPUT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  TIMEOUT = 'TIMEOUT',
  NOT_FOUND = 'NOT_FOUND',
  
  // SVN errors
  SVN_NOT_FOUND = 'SVN_NOT_FOUND',
  SVN_NOT_WORKING_COPY = 'SVN_NOT_WORKING_COPY',
  SVN_CONFLICT = 'SVN_CONFLICT',
  SVN_AUTH_FAILED = 'SVN_AUTH_FAILED',
  SVN_NETWORK_ERROR = 'SVN_NETWORK_ERROR',
  SVN_LOCKED = 'SVN_LOCKED',
  SVN_OUT_OF_DATE = 'SVN_OUT_OF_DATE',
  SVN_MERGE_CONFLICT = 'SVN_MERGE_CONFLICT',
  SVN_PROPERTY_ERROR = 'SVN_PROPERTY_ERROR',
  
  // File system errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  
  // External tool errors
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  TOOL_LAUNCH_FAILED = 'TOOL_LAUNCH_FAILED',
  
  // Auth errors
  AUTH_ENCRYPTION_UNAVAILABLE = 'AUTH_ENCRYPTION_UNAVAILABLE',
  AUTH_STORAGE_ERROR = 'AUTH_STORAGE_ERROR',
}

/**
 * Standard error response structure for IPC
 */
export interface AppError {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
  cause?: string
}

/**
 * Standard IPC result wrapper
 */
export interface IpcResult<T> {
  success: boolean
  data?: T
  error?: AppError
}

/**
 * Helper functions for creating results
 */
export function success<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

export function failure(code: ErrorCode, message: string, details?: Record<string, unknown>): IpcResult<never> {
  return {
    success: false,
    error: { code, message, details }
  }
}

/**
 * Error messages for common error codes
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.UNKNOWN]: 'An unexpected error occurred',
  [ErrorCode.INVALID_INPUT]: 'Invalid input provided',
  [ErrorCode.PERMISSION_DENIED]: 'Permission denied',
  [ErrorCode.TIMEOUT]: 'Operation timed out',
  [ErrorCode.NOT_FOUND]: 'Resource not found',
  
  [ErrorCode.SVN_NOT_FOUND]: 'SVN command not found. Please ensure SVN is installed.',
  [ErrorCode.SVN_NOT_WORKING_COPY]: 'The specified path is not a working copy',
  [ErrorCode.SVN_CONFLICT]: 'A conflict was detected',
  [ErrorCode.SVN_AUTH_FAILED]: 'Authentication failed. Please check your credentials.',
  [ErrorCode.SVN_NETWORK_ERROR]: 'Network error while communicating with SVN server',
  [ErrorCode.SVN_LOCKED]: 'The file or directory is locked',
  [ErrorCode.SVN_OUT_OF_DATE]: 'The working copy is out of date. Please update first.',
  [ErrorCode.SVN_MERGE_CONFLICT]: 'Merge conflict detected',
  [ErrorCode.SVN_PROPERTY_ERROR]: 'Property operation failed',
  
  [ErrorCode.FILE_NOT_FOUND]: 'File not found',
  [ErrorCode.FILE_TOO_LARGE]: 'File is too large',
  [ErrorCode.FILE_READ_ERROR]: 'Failed to read file',
  [ErrorCode.FILE_WRITE_ERROR]: 'Failed to write file',
  [ErrorCode.PATH_NOT_FOUND]: 'Path not found',
  [ErrorCode.PATH_TRAVERSAL]: 'Path traversal not allowed',
  
  [ErrorCode.TOOL_NOT_FOUND]: 'External tool not found',
  [ErrorCode.TOOL_LAUNCH_FAILED]: 'Failed to launch external tool',
  
  [ErrorCode.AUTH_ENCRYPTION_UNAVAILABLE]: 'Secure storage not available on this system',
  [ErrorCode.AUTH_STORAGE_ERROR]: 'Failed to store credentials securely',
}

/**
 * Parse SVN error output to determine error type
 */
export function parseSvnError(stderr: string, operation: string): AppError {
  const lower = stderr.toLowerCase()
  
  if (lower.includes('is not a working copy')) {
    return { code: ErrorCode.SVN_NOT_WORKING_COPY, message: ERROR_MESSAGES[ErrorCode.SVN_NOT_WORKING_COPY] }
  }
  if (lower.includes('authentication failed') || lower.includes('authorization failed')) {
    return { code: ErrorCode.SVN_AUTH_FAILED, message: ERROR_MESSAGES[ErrorCode.SVN_AUTH_FAILED] }
  }
  if (lower.includes('conflict')) {
    return { code: ErrorCode.SVN_CONFLICT, message: ERROR_MESSAGES[ErrorCode.SVN_CONFLICT], details: { operation } }
  }
  if (lower.includes('network') || lower.includes('connection timed out')) {
    return { code: ErrorCode.SVN_NETWORK_ERROR, message: ERROR_MESSAGES[ErrorCode.SVN_NETWORK_ERROR] }
  }
  if (lower.includes('is locked')) {
    return { code: ErrorCode.SVN_LOCKED, message: ERROR_MESSAGES[ErrorCode.SVN_LOCKED] }
  }
  if (lower.includes('out of date')) {
    return { code: ErrorCode.SVN_OUT_OF_DATE, message: ERROR_MESSAGES[ErrorCode.SVN_OUT_OF_DATE] }
  }
  
  return {
    code: ErrorCode.UNKNOWN,
    message: `${operation} failed: ${stderr || 'Unknown error'}`,
    details: { operation, stderr }
  }
}

/**
 * Custom error class for structured errors
 */
export class IpcError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'IpcError'
  }
  
  toJSON(): AppError {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    }
  }
}
