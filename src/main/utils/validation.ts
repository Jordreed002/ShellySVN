/**
 * Input Validation Utilities for IPC Handlers
 * 
 * SECURITY: Provides validation functions for user-provided input
 * to prevent path traversal, injection, and other security issues.
 */

import { normalize } from 'path'
import { existsSync, statSync } from 'fs'

/**
 * Validation options for path inputs
 */
export interface PathValidationOptions {
  mustExist?: boolean
  mustBeDirectory?: boolean
  mustBeFile?: boolean
  allowAbsolute?: boolean
  allowedExtensions?: string[]
  maxSize?: number  // in bytes
}

/**
 * Custom error for validation failures
 */
export class InputValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message)
    this.name = 'InputValidationError'
  }
}

/**
 * Validate a file system path
 * 
 * SECURITY:
 * - Normalizes path to prevent traversal attacks
 * - Checks for path traversal attempts (..)
 * - Validates existence and type if required
 */
export function validatePath(
  path: unknown,
  options: PathValidationOptions = {}
): string {
  // Type check
  if (typeof path !== 'string') {
    throw new InputValidationError('Path must be a string', 'path')
  }
  
  // Empty check
  if (!path.trim()) {
    throw new InputValidationError('Path cannot be empty', 'path')
  }
  
  // Normalize path
  const normalizedPath = normalize(path)
  
  // Check for path traversal attempts
  if (normalizedPath.includes('..')) {
    throw new InputValidationError('Path traversal not allowed', 'path')
  }
  
  // Check absolute path restriction
  if (!options.allowAbsolute && path.startsWith('/')) {
    throw new InputValidationError('Absolute paths not allowed', 'path')
  }
  
  // Check existence
  if (options.mustExist && !existsSync(normalizedPath)) {
    throw new InputValidationError('Path does not exist', 'path')
  }
  
  // Check if directory
  if (options.mustBeDirectory && existsSync(normalizedPath)) {
    const stats = statSync(normalizedPath)
    if (!stats.isDirectory()) {
      throw new InputValidationError('Path must be a directory', 'path')
    }
  }
  
  // Check if file
  if (options.mustBeFile && existsSync(normalizedPath)) {
    const stats = statSync(normalizedPath)
    if (!stats.isFile()) {
      throw new InputValidationError('Path must be a file', 'path')
    }
  }
  
  // Check file size
  if (options.maxSize && existsSync(normalizedPath)) {
    const stats = statSync(normalizedPath)
    if (stats.size > options.maxSize) {
      throw new InputValidationError(`File too large (max ${Math.round(options.maxSize / 1024)}KB)`, 'path')
    }
  }
  
  // Check extensions
  if (options.allowedExtensions && options.allowedExtensions.length > 0) {
    const ext = normalizedPath.split('.').pop()?.toLowerCase()
    if (!ext || !options.allowedExtensions.includes(ext)) {
      throw new InputValidationError(
        `File extension must be one of: ${options.allowedExtensions.join(', ')}`,
        'path'
      )
    }
  }
  
  return normalizedPath
}

/**
 * Validate a URL
 * 
 * SECURITY: Only allows specific protocols
 */
export function validateUrl(url: unknown, allowedProtocols: string[] = ['http:', 'https:']): string {
  if (typeof url !== 'string') {
    throw new InputValidationError('URL must be a string', 'url')
  }
  
  if (!url.trim()) {
    throw new InputValidationError('URL cannot be empty', 'url')
  }
  
  try {
    const parsed = new URL(url)
    
    if (!allowedProtocols.includes(parsed.protocol)) {
      throw new InputValidationError(
        `Protocol must be one of: ${allowedProtocols.join(', ')}`,
        'url'
      )
    }
  } catch {
    throw new InputValidationError('Invalid URL format', 'url')
  }
  
  return url
}

/**
 * Validate a string input
 */
export function validateString(
  value: unknown,
  field: string,
  options: { minLength?: number; maxLength?: number; pattern?: RegExp } = {}
): string {
  if (typeof value !== 'string') {
    throw new InputValidationError(`${field} must be a string`, field)
  }
  
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new InputValidationError(`${field} must be at least ${options.minLength} characters`, field)
  }
  
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new InputValidationError(`${field} must be at most ${options.maxLength} characters`, field)
  }
  
  if (options.pattern && !options.pattern.test(value)) {
    throw new InputValidationError(`${field} has invalid format`, field)
  }
  
  return value
}

/**
 * Validate a number input
 */
export function validateNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new InputValidationError(`${field} must be a number`, field)
  }
  
  if (options.integer && !Number.isInteger(value)) {
    throw new InputValidationError(`${field} must be an integer`, field)
  }
  
  if (options.min !== undefined && value < options.min) {
    throw new InputValidationError(`${field} must be at least ${options.min}`, field)
  }
  
  if (options.max !== undefined && value > options.max) {
    throw new InputValidationError(`${field} must be at most ${options.max}`, field)
  }
  
  return value
}

/**
 * Validate an array of strings
 */
export function validateStringArray(
  value: unknown,
  field: string,
  options: { minItems?: number; maxItems?: number; itemPattern?: RegExp } = {}
): string[] {
  if (!Array.isArray(value)) {
    throw new InputValidationError(`${field} must be an array`, field)
  }
  
  if (options.minItems !== undefined && value.length < options.minItems) {
    throw new InputValidationError(`${field} must have at least ${options.minItems} items`, field)
  }
  
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    throw new InputValidationError(`${field} must have at most ${options.maxItems} items`, field)
  }
  
  // Validate each item
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new InputValidationError(`${field}[${index}] must be a string`, field)
    }
    
    if (options.itemPattern && !options.itemPattern.test(item)) {
      throw new InputValidationError(`${field}[${index}] has invalid format`, field)
    }
    
    return item
  })
}

/**
 * SVN property name validation
 */
const SVN_PROPERTY_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9:_-]*$/

export function validateSvnPropertyName(name: unknown): string {
  return validateString(name, 'propertyName', {
    minLength: 1,
    maxLength: 256,
    pattern: SVN_PROPERTY_NAME_REGEX
  })
}

/**
 * Commit message validation
 */
const MAX_COMMIT_MESSAGE_LENGTH = 100000  // ~100KB

export function validateCommitMessage(message: unknown): string {
  const validated = validateString(message, 'commitMessage', {
    maxLength: MAX_COMMIT_MESSAGE_LENGTH
  })
  
  // Remove any null bytes that could cause issues
  return validated.replace(/\0/g, '')
}

/**
 * Wrap an IPC handler with validation error handling
 */
export function withValidation<T>(
  handler: () => Promise<T>
): Promise<{ success: boolean; data?: T; error?: string }> {
  return handler()
    .then(data => ({ success: true, data }))
    .catch(error => {
      if (error instanceof InputValidationError) {
        return { success: false, error: `Validation error: ${error.message}` }
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    })
}
