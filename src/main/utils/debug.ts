/**
 * Debug Logging Utility
 * 
 * Provides conditional logging based on development mode.
 * In production, debug logs are suppressed to reduce noise.
 * 
 * USAGE:
 * - debug.log() - Informational debug messages (dev only)
 * - debug.warn() - Warnings (always shown)
 * - debug.error() - Errors (always shown)
 */

const isDev = process.env.NODE_ENV === 'development' || 
              process.env.ELECTRON_RENDERER_URL !== undefined ||
              !process.resourcesPath?.includes('app.asar')

export const debug = {
  /**
   * Log debug message (dev mode only)
   */
  log: (...args: unknown[]): void => {
    if (isDev) {
      console.log(...args)
    }
  },
  
  /**
   * Log warning (always shown)
   */
  warn: (...args: unknown[]): void => {
    console.warn(...args)
  },
  
  /**
   * Log error (always shown)
   */
  error: (...args: unknown[]): void => {
    console.error(...args)
  },
  
  /**
   * Check if running in development mode
   */
  isDev(): boolean {
    return isDev
  }
}

export default debug
