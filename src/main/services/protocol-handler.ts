import { app } from 'electron'
import { shell } from 'electron'

/**
 * Parsed deep link structure
 */
export interface DeepLink {
  action: string
  params: Record<string, string>
  path?: string
  url?: string
}

/**
 * Supported deep link actions
 */
export type DeepLinkAction =
  | 'checkout'
  | 'export'
  | 'open'
  | 'log'
  | 'diff'
  | 'commit'
  | 'update'
  | 'blame'
  | 'info'

/**
 * Deep link handler callback
 */
export type DeepLinkHandler = (link: DeepLink) => void

// Store registered handlers
const handlers: Map<string, DeepLinkHandler[]> = new Map()

/**
 * Parse a shellysvn:// URL into structured data
 * 
 * Supported formats:
 * - shellysvn://checkout?url=https://svn.example.com/repo&path=/local/path
 * - shellysvn://open?path=/path/to/working/copy
 * - shellysvn://log?path=/path/to/file
 * - shellysvn://diff?path=/path/to/file&revision=123
 * - shellysvn://commit?path=/path
 * - shellysvn://update?path=/path
 * - shellysvn://blame?path=/path/to/file
 * - shellysvn://info?path=/path
 */
export function parseDeepLink(url: string): DeepLink | null {
  // Check protocol
  if (!url.startsWith('shellysvn://')) {
    return null
  }
  
  try {
    // Remove protocol
    const withoutProtocol = url.replace('shellysvn://', '')
    
    // Split action and query string
    const [action, queryString] = withoutProtocol.split('?')
    
    if (!action) {
      return null
    }
    
    // Parse query parameters
    const params: Record<string, string> = {}
    if (queryString) {
      const searchParams = new URLSearchParams(queryString)
      for (const [key, value] of searchParams) {
        params[key] = decodeURIComponent(value)
      }
    }
    
    return {
      action: action.toLowerCase(),
      params,
      path: params.path,
      url: params.url
    }
  } catch (error) {
    console.error('Failed to parse deep link:', error)
    return null
  }
}

/**
 * Register a handler for a specific deep link action
 */
export function registerDeepLinkHandler(action: DeepLinkAction, handler: DeepLinkHandler): void {
  const existing = handlers.get(action) || []
  existing.push(handler)
  handlers.set(action, existing)
}

/**
 * Unregister a handler for a specific deep link action
 */
export function unregisterDeepLinkHandler(action: DeepLinkAction, handler: DeepLinkHandler): void {
  const existing = handlers.get(action) || []
  const index = existing.indexOf(handler)
  if (index !== -1) {
    existing.splice(index, 1)
    handlers.set(action, existing)
  }
}

/**
 * Process a deep link and call registered handlers
 */
export function processDeepLink(url: string): boolean {
  const link = parseDeepLink(url)
  
  if (!link) {
    console.warn('Invalid deep link:', url)
    return false
  }
  
  const actionHandlers = handlers.get(link.action)
  
  if (!actionHandlers || actionHandlers.length === 0) {
    console.warn('No handler registered for action:', link.action)
    return false
  }
  
  // Call all registered handlers
  for (const handler of actionHandlers) {
    try {
      handler(link)
    } catch (error) {
      console.error('Deep link handler error:', error)
    }
  }
  
  return true
}

/**
 * Register the shellysvn:// protocol handler
 * Must be called before app is ready
 */
export function setupProtocolHandler(): void {
  // Register protocol (works on macOS)
  if (process.platform === 'darwin') {
    app.setAsDefaultProtocolClient('shellysvn')
  }
  
  // Handle protocol on Windows/Linux
  if (process.platform !== 'darwin') {
    // Check if app was launched with a protocol URL
    const gotTheLock = app.requestSingleInstanceLock()
    
    if (!gotTheLock) {
      // Another instance is already running
      // The URL will be handled by the primary instance
      app.quit()
      return
    }
    
    // This is the primary instance
    app.on('second-instance', (_event, commandLine) => {
      // Extract the URL from command line arguments
      const url = commandLine.find(arg => arg.startsWith('shellysvn://'))
      if (url) {
        processDeepLink(url)
      }
    })
  }
  
  // Handle open-url event (macOS)
  app.on('open-url', (event, url) => {
    event.preventDefault()
    processDeepLink(url)
  })
  
  // Handle protocol from command line (Windows/Linux)
  if (process.argv.length > 1) {
    const url = process.argv.find(arg => arg.startsWith('shellysvn://'))
    if (url) {
      // Defer processing until app is ready
      app.whenReady().then(() => {
        processDeepLink(url)
      })
    }
  }
}

/**
 * Generate a shellysvn:// URL for a specific action
 */
export function generateDeepLink(action: DeepLinkAction, params: Record<string, string> = {}): string {
  const queryString = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, encodeURIComponent(v)])
  ).toString()
  
  return queryString 
    ? `shellysvn://${action}?${queryString}`
    : `shellysvn://${action}`
}

/**
 * Helper functions for generating specific deep links
 */
export const deepLinks = {
  checkout: (svnUrl: string, localPath?: string) => 
    generateDeepLink('checkout', { url: svnUrl, ...(localPath && { path: localPath }) }),
  
  export: (svnUrl: string, localPath: string) => 
    generateDeepLink('export', { url: svnUrl, path: localPath }),
  
  open: (path: string) => 
    generateDeepLink('open', { path }),
  
  log: (path: string, revision?: string) => 
    generateDeepLink('log', { path, ...(revision && { revision }) }),
  
  diff: (path: string, revision?: string) => 
    generateDeepLink('diff', { path, ...(revision && { revision }) }),
  
  commit: (path: string) => 
    generateDeepLink('commit', { path }),
  
  update: (path: string) => 
    generateDeepLink('update', { path }),
  
  blame: (path: string) => 
    generateDeepLink('blame', { path }),
  
  info: (path: string) => 
    generateDeepLink('info', { path }),
  
  /**
   * Open a deep link URL in the system browser or handle internally
   */
  openExternal: async (url: string): Promise<boolean> => {
    if (url.startsWith('shellysvn://')) {
      return processDeepLink(url)
    }
    
    await shell.openExternal(url)
    return true
  }
}

export default {
  parseDeepLink,
  registerDeepLinkHandler,
  unregisterDeepLinkHandler,
  processDeepLink,
  setupProtocolHandler,
  generateDeepLink,
  deepLinks
}
