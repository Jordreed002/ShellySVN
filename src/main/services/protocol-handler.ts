import { app } from 'electron';
import { openValidatedExternalUrl } from '../utils/external-url';

/**
 * Parsed deep link structure
 */
export interface DeepLink {
  action: string;
  params: Record<string, string>;
  path?: string;
  url?: string;
  requiresConfirmation?: boolean;
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
  | 'info';

const SUPPORTED_ACTIONS = new Set<DeepLinkAction>([
  'checkout',
  'export',
  'open',
  'log',
  'diff',
  'commit',
  'update',
  'blame',
  'info',
]);

const MUTATING_ACTIONS = new Set<DeepLinkAction>(['checkout', 'export', 'commit', 'update']);
const MAX_DEEP_LINK_LENGTH = 4096;
const MAX_PARAM_LENGTH = 2048;
const ALLOWED_REPOSITORY_PROTOCOLS = new Set(['http:', 'https:', 'svn:', 'svn+ssh:']);

/**
 * Deep link handler callback
 */
export type DeepLinkHandler = (link: DeepLink) => void;

// Store registered handlers
const handlers: Map<string, DeepLinkHandler[]> = new Map();

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
  if (!url.startsWith('shellysvn://') || url.length > MAX_DEEP_LINK_LENGTH) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const action = parsed.hostname.toLowerCase() as DeepLinkAction;

    if (!SUPPORTED_ACTIONS.has(action)) {
      return null;
    }

    const params: Record<string, string> = {};
    for (const [key, value] of parsed.searchParams) {
      if (key.length > 64 || value.length > MAX_PARAM_LENGTH || value.includes('\0')) {
        return null;
      }
      params[key] = value;
    }

    if ((action === 'checkout' || action === 'export') && !isAllowedRepositoryUrl(params.url)) {
      return null;
    }

    if (requiresPath(action) && !isValidDeepLinkPath(params.path)) {
      return null;
    }

    return {
      action,
      params,
      path: params.path,
      url: params.url,
      requiresConfirmation: MUTATING_ACTIONS.has(action),
    };
  } catch (error) {
    console.error('Failed to parse deep link:', error);
    return null;
  }
}

function requiresPath(action: DeepLinkAction): boolean {
  return action !== 'checkout' && action !== 'info';
}

function isValidDeepLinkPath(path?: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= MAX_PARAM_LENGTH && !path.includes('\0');
}

function isAllowedRepositoryUrl(url?: string): boolean {
  if (!url || url.length > MAX_PARAM_LENGTH) return false;

  try {
    const parsed = new URL(url);
    return ALLOWED_REPOSITORY_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Register a handler for a specific deep link action
 */
export function registerDeepLinkHandler(action: DeepLinkAction, handler: DeepLinkHandler): void {
  const existing = handlers.get(action) || [];
  existing.push(handler);
  handlers.set(action, existing);
}

/**
 * Unregister a handler for a specific deep link action
 */
export function unregisterDeepLinkHandler(action: DeepLinkAction, handler: DeepLinkHandler): void {
  const existing = handlers.get(action) || [];
  const index = existing.indexOf(handler);
  if (index !== -1) {
    existing.splice(index, 1);
    handlers.set(action, existing);
  }
}

/**
 * Process a deep link and call registered handlers
 */
export function processDeepLink(url: string): boolean {
  const link = parseDeepLink(url);

  if (!link) {
    console.warn('Invalid deep link:', url);
    return false;
  }

  const actionHandlers = handlers.get(link.action);

  if (!actionHandlers || actionHandlers.length === 0) {
    console.warn('No handler registered for action:', link.action);
    return false;
  }

  // Call all registered handlers
  for (const handler of actionHandlers) {
    try {
      handler(link);
    } catch (error) {
      console.error('Deep link handler error:', error);
    }
  }

  return true;
}

/**
 * Register the shellysvn:// protocol handler
 * Must be called before app is ready
 */
export function setupProtocolHandler(): void {
  // Register protocol (works on macOS)
  if (process.platform === 'darwin') {
    app.setAsDefaultProtocolClient('shellysvn');
  }

  // Handle protocol on Windows/Linux
  if (process.platform !== 'darwin') {
    // Check if app was launched with a protocol URL
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
      // Another instance is already running
      // The URL will be handled by the primary instance
      app.quit();
      return;
    }

    // This is the primary instance
    app.on('second-instance', (_event, commandLine) => {
      // Extract the URL from command line arguments
      const url = commandLine.find((arg) => arg.startsWith('shellysvn://'));
      if (url) {
        processDeepLink(url);
      }
    });
  }

  // Handle open-url event (macOS)
  app.on('open-url', (event, url) => {
    event.preventDefault();
    processDeepLink(url);
  });

  // Handle protocol from command line (Windows/Linux)
  if (process.argv.length > 1) {
    const url = process.argv.find((arg) => arg.startsWith('shellysvn://'));
    if (url) {
      // Defer processing until app is ready
      app.whenReady().then(() => {
        processDeepLink(url);
      });
    }
  }
}

/**
 * Generate a shellysvn:// URL for a specific action
 */
export function generateDeepLink(
  action: DeepLinkAction,
  params: Record<string, string> = {}
): string {
  const queryString = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, encodeURIComponent(v)])
  ).toString();

  return queryString ? `shellysvn://${action}?${queryString}` : `shellysvn://${action}`;
}

/**
 * Helper functions for generating specific deep links
 */
export const deepLinks = {
  checkout: (svnUrl: string, localPath?: string) =>
    generateDeepLink('checkout', { url: svnUrl, ...(localPath && { path: localPath }) }),

  export: (svnUrl: string, localPath: string) =>
    generateDeepLink('export', { url: svnUrl, path: localPath }),

  open: (path: string) => generateDeepLink('open', { path }),

  log: (path: string, revision?: string) =>
    generateDeepLink('log', { path, ...(revision && { revision }) }),

  diff: (path: string, revision?: string) =>
    generateDeepLink('diff', { path, ...(revision && { revision }) }),

  commit: (path: string) => generateDeepLink('commit', { path }),

  update: (path: string) => generateDeepLink('update', { path }),

  blame: (path: string) => generateDeepLink('blame', { path }),

  info: (path: string) => generateDeepLink('info', { path }),

  /**
   * Open a deep link URL in the system browser or handle internally
   */
  openExternal: async (url: string): Promise<boolean> => {
    if (url.startsWith('shellysvn://')) {
      return processDeepLink(url);
    }

    const result = await openValidatedExternalUrl(url);
    return result.success;
  },
};

export default {
  parseDeepLink,
  registerDeepLinkHandler,
  unregisterDeepLinkHandler,
  processDeepLink,
  setupProtocolHandler,
  generateDeepLink,
  deepLinks,
};
