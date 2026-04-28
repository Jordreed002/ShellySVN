/**
 * Debug utility that works in both main and renderer processes.
 * Provides consistent logging with dev-only filtering.
 */

// Detect environment - works in both main and renderer processes
const isMainProcess = typeof process !== 'undefined' && !!process.versions?.electron;
const isDev = isMainProcess
  ? process.env.NODE_ENV === 'development' || !process.resourcesPath?.includes('app.asar')
  : typeof import.meta !== 'undefined' && import.meta.env?.DEV;

function formatMessage(category: string, ...args: unknown[]): unknown[] {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  return [`[${timestamp}][${category}]`, ...args];
}

export const debug = {
  /**
   * Log a debug message (dev-only, no-op in production)
   */
  log(...args: unknown[]): void {
    if (isDev) {
      console.log(...formatMessage('DEBUG', ...args));
    }
  },

  /**
   * Log a warning message
   */
  warn(...args: unknown[]): void {
    console.warn(...formatMessage('WARN', ...args));
  },

  /**
   * Log an error message
   */
  error(...args: unknown[]): void {
    console.error(...formatMessage('ERROR', ...args));
  },
};

export default debug;
