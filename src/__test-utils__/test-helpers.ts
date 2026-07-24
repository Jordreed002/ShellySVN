/**
 * Common Test Utilities
 *
 * Shared helper functions and utilities for testing.
 */

import { vi } from 'vitest';

/**
 * Wait for all pending promises to resolve
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for a specific amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock function that resolves after a delay
 */
export function createDelayedMock<T>(value: T, delayMs: number = 100): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(value), delayMs)));
}

/**
 * Create a mock function that rejects after a delay
 */
export function createDelayedErrorMock(
  error: Error | string,
  delayMs: number = 100
): ReturnType<typeof vi.fn> {
  const err = typeof error === 'string' ? new Error(error) : error;
  return vi
    .fn()
    .mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(err), delayMs)));
}

/**
 * Create a mock that returns different values on sequential calls
 */
export function createSequenceMock<T>(values: T[]): ReturnType<typeof vi.fn> {
  let index = 0;
  return vi.fn().mockImplementation(() => {
    const value = values[index % values.length];
    index++;
    return Promise.resolve(value);
  });
}

/**
 * Helper to create a mock event emitter
 */
export function createMockEventEmitter<T extends Record<string, any[]>>() {
  const listeners = new Map<keyof T, Set<(...args: any[]) => void>>();

  return {
    on<K extends keyof T>(event: K, callback: (...args: T[K]) => void): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);

      return () => {
        listeners.get(event)?.delete(callback);
      };
    },

    emit<K extends keyof T>(event: K, ...args: T[K]): void {
      listeners.get(event)?.forEach((cb) => cb(...args));
    },

    removeAllListeners(): void {
      listeners.clear();
    },

    getListenerCount<K extends keyof T>(event: K): number {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

/**
 * Helper to create mock file system entries
 */
export function createMockFileEntry(
  overrides: Partial<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedTime: string;
  }> = {}
) {
  return {
    name: 'test.txt',
    path: '/test/test.txt',
    isDirectory: false,
    size: 1024,
    modifiedTime: '2024-01-01T12:00:00Z',
    ...overrides,
  };
}

/**
 * Helper to create mock directory entries
 */
export function createMockDirectoryEntry(
  overrides: Partial<{
    name: string;
    path: string;
  }> = {}
) {
  return createMockFileEntry({
    name: 'testdir',
    path: '/test/testdir',
    isDirectory: true,
    size: 0,
    ...overrides,
  });
}

/**
 * Helper to create a temp directory path for tests
 */
export function createTempPath(baseName: string = 'test'): string {
  return `/tmp/shellysvn-test-${baseName}-${Date.now()}`;
}

/**
 * Suppress console output during tests
 */
export function suppressConsole(): () => void {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  console.info = vi.fn();
  console.debug = vi.fn();

  return () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  };
}

/**
 * Helper for testing async errors
 */
export async function expectAsyncError<T>(
  promise: Promise<T>,
  errorMessage?: string | RegExp
): Promise<Error> {
  try {
    await promise;
    throw new Error('Expected promise to reject, but it resolved');
  } catch (error) {
    if (errorMessage) {
      if (typeof errorMessage === 'string') {
        expect((error as Error).message).toContain(errorMessage);
      } else {
        expect((error as Error).message).toMatch(errorMessage);
      }
    }
    return error as Error;
  }
}

/**
 * Create a mock stream for testing streaming operations
 */
export function createMockStream<T>(items: T[], delayMs: number = 10) {
  const callbacks = {
    data: [] as ((item: T) => void)[],
    end: [] as (() => void)[],
    error: [] as ((error: Error) => void)[],
  };

  // Start streaming after a tick
  setTimeout(async () => {
    for (const item of items) {
      callbacks.data.forEach((cb) => cb(item));
      await wait(delayMs);
    }
    callbacks.end.forEach((cb) => cb());
  }, 0);

  return {
    on(event: 'data' | 'end' | 'error', callback: (...args: any[]) => void) {
      if (event in callbacks) {
        (callbacks as any)[event].push(callback);
      }
      return this;
    },
    destroy() {
      callbacks.data = [];
      callbacks.end = [];
      callbacks.error = [];
    },
  };
}

/**
 * Type helper to extract the resolved type of a Promise
 */
export type ResolvedType<T> = T extends Promise<infer U> ? U : T;

/**
 * Type helper for mock functions
 */
export type MockFn<T extends (...args: any[]) => any = (...args: any[]) => any> = ReturnType<
  typeof vi.fn<T>
>;

/**
 * Set up global window.api mock
 */
export function setupWindowApiMock(): void {
  // Create mock API inline to avoid circular dependencies
  const mockApi = createMockElectronAPI();
  if (typeof window === 'undefined') {
    throw new Error('setupWindowApiMock requires a DOM test environment');
  }

  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: mockApi,
  });
}

/**
 * Create mock Electron API
 */
function createMockElectronAPI() {
  return {
    svn: {
      capabilities: vi.fn().mockResolvedValue({ shelving: false, remoteProperties: false }),
      status: vi.fn().mockResolvedValue({ path: '/test/repo', entries: [], revision: 1 }),
      statusRemote: vi
        .fn()
        .mockResolvedValue({ path: '/test/repo', entries: [], revision: 1, remoteChecked: true }),
      workingCopyUpgradeStatus: vi.fn().mockResolvedValue({ path: '/test/repo', required: false }),
      upgradeWorkingCopy: vi.fn().mockResolvedValue({ success: true, output: '' }),
      log: vi.fn().mockResolvedValue({ entries: [], startRevision: 0, endRevision: 0 }),
      info: vi.fn().mockResolvedValue({
        path: '/test/repo',
        url: 'https://svn.example.com/repo/trunk',
        repositoryRoot: 'https://svn.example.com/repo',
        repositoryUuid: '12345678-1234-1234-1234-123456789012',
        revision: 5,
        nodeKind: 'dir',
        lastChangedAuthor: 'testuser',
        lastChangedRevision: 5,
        lastChangedDate: '2024-01-01T12:00:00Z',
      }),
      infoUrl: vi.fn().mockResolvedValue(null),
      getWorkingCopyContext: vi.fn().mockResolvedValue({
        workingCopyRoot: '/test/repo',
        repositoryRoot: 'https://svn.example.com/repo',
        url: 'https://svn.example.com/repo/trunk',
      }),
      diff: vi.fn().mockResolvedValue({ files: [], hasChanges: false }),
      diffStreaming: vi.fn().mockResolvedValue({ files: [], hasChanges: false }),
      update: vi.fn().mockResolvedValue({ success: true, revision: 5 }),
      updateWithProgress: vi.fn().mockImplementation(async (_path, onProgress) => {
        onProgress?.({ status: 'completed', filesProcessed: 0, revision: 5 });
        return { success: true, revision: 5 };
      }),
      cancelUpdate: vi.fn().mockResolvedValue({ success: true }),
      updateItem: vi.fn().mockResolvedValue({ success: true, revision: 5 }),
      updateToRevision: vi.fn().mockResolvedValue({ success: true, revision: 3 }),
      commit: vi.fn().mockResolvedValue({ success: true, revision: 6 }),
      revert: vi.fn().mockResolvedValue({ success: true }),
      add: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      cleanup: vi.fn().mockResolvedValue({ success: true }),
      lock: vi.fn().mockResolvedValue({ success: true }),
      unlock: vi.fn().mockResolvedValue({ success: true }),
      lockInfo: vi.fn().mockResolvedValue(null),
      lockForce: vi.fn().mockResolvedValue({ success: true }),
      unlockForce: vi.fn().mockResolvedValue({ success: true }),
      lockList: vi.fn().mockResolvedValue([]),
      checkout: vi.fn().mockResolvedValue({ success: true, revision: 1 }),
      checkoutWithProgress: vi.fn().mockResolvedValue({ success: true, revision: 1 }),
      cancelCheckout: vi.fn().mockResolvedValue({ success: true }),
      export: vi.fn().mockResolvedValue({ success: true, revision: 1 }),
      import: vi.fn().mockResolvedValue({ success: true, revision: 1 }),
      resolve: vi.fn().mockResolvedValue({ success: true }),
      switch: vi.fn().mockResolvedValue({ success: true, revision: 1 }),
      copy: vi.fn().mockResolvedValue({ success: true, revision: 1 }),
      merge: vi.fn().mockResolvedValue({ success: true }),
      relocate: vi.fn().mockResolvedValue({ success: true }),
      changelist: {
        add: vi.fn().mockResolvedValue({ success: true }),
        remove: vi.fn().mockResolvedValue({ success: true }),
        list: vi.fn().mockResolvedValue({ changelists: [], defaultFiles: [] }),
        create: vi.fn().mockResolvedValue({ success: true }),
        delete: vi.fn().mockResolvedValue({ success: true }),
      },
      move: vi.fn().mockResolvedValue({ success: true }),
      rename: vi.fn().mockResolvedValue({ success: true }),
      shelve: {
        list: vi.fn().mockResolvedValue({ shelves: [] }),
        save: vi.fn().mockResolvedValue({ success: true }),
        apply: vi.fn().mockResolvedValue({ success: true }),
        delete: vi.fn().mockResolvedValue({ success: true }),
      },
      proplist: vi.fn().mockResolvedValue([]),
      propset: vi.fn().mockResolvedValue({ success: true }),
      propdel: vi.fn().mockResolvedValue({ success: true }),
      propsetRemote: vi.fn().mockResolvedValue({ success: true }),
      propdelRemote: vi.fn().mockResolvedValue({ success: true }),
      blame: vi.fn().mockResolvedValue({ path: '/test/repo/file.txt', lines: [] }),
      list: vi.fn().mockResolvedValue({ path: '', entries: [] }),
      patch: {
        create: vi.fn().mockResolvedValue({ success: true, output: '' }),
        apply: vi
          .fn()
          .mockResolvedValue({ success: true, filesPatched: 0, rejects: 0, output: '' }),
      },
      externals: {
        list: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockResolvedValue({ success: true }),
        remove: vi.fn().mockResolvedValue({ success: true }),
      },
      diagnostics: vi.fn().mockResolvedValue({
        svnClientPath: 'svn',
        svnVersion: '1.14.0',
        encryptionAvailable: true,
        isPackaged: false,
        resourcesPath: null,
        resourceStatus: [],
        isValidWorkingCopy: true,
        workingCopyRoot: '/test/repo',
        repositoryRoot: 'https://svn.example.com/repo',
        repositoryUrl: 'https://svn.example.com/repo/trunk',
        repositoryUuid: '12345678-1234-1234-1234-123456789012',
        hasCredentials: false,
        credentialRealm: null,
        credentialUsername: null,
        connectionStatus: 'ok',
      }),
    },
    external: {
      openDiffTool: vi.fn().mockResolvedValue({ success: true }),
      openMergeTool: vi.fn().mockResolvedValue({ success: true }),
      openFolder: vi.fn().mockResolvedValue({ success: true }),
      openFile: vi.fn().mockResolvedValue({ success: true }),
      revealPath: vi.fn().mockResolvedValue({ success: true }),
    },
    monitor: {
      getWorkingCopies: vi.fn().mockResolvedValue([]),
      addWorkingCopy: vi.fn().mockResolvedValue({ success: true }),
      removeWorkingCopy: vi.fn().mockResolvedValue({ success: true }),
      refreshStatus: vi.fn().mockResolvedValue(null),
      startMonitoring: vi.fn().mockResolvedValue(undefined),
      stopMonitoring: vi.fn().mockResolvedValue(undefined),
    },
    fs: {
      listDirectory: vi.fn().mockResolvedValue([]),
      listDrives: vi.fn().mockResolvedValue([]),
      getParent: vi.fn().mockResolvedValue(null),
      getDirectoryMetadata: vi.fn().mockResolvedValue({
        parentPath: null,
        isVersioned: true,
        statusData: { directStatus: {}, allEntries: [] },
        svnInfo: null,
        workingCopyUpgradeStatus: { path: '', required: false },
        workingCopyContext: null,
      }),
      getStatus: vi.fn().mockResolvedValue({ directStatus: {}, allEntries: [] }),
      getDeepStatus: vi.fn().mockResolvedValue({ directStatus: {}, allEntries: [] }),
      applyStatus: vi.fn().mockResolvedValue([]),
      cancelScan: vi.fn().mockResolvedValue(undefined),
      isVersioned: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue({ success: true, content: '' }),
      readImageAsBase64: vi.fn().mockResolvedValue({ success: true, data: '' }),
      getFolderSizes: vi.fn().mockResolvedValue({}),
      copyFile: vi.fn().mockResolvedValue({ success: true }),
      writeFile: vi.fn().mockResolvedValue({ success: true }),
      watch: vi.fn().mockReturnValue(() => {}),
      unwatch: vi.fn().mockResolvedValue({ success: true }),
      exists: vi.fn().mockResolvedValue(true),
    },
    dialog: {
      openDirectory: vi.fn().mockResolvedValue(null),
      openFile: vi.fn().mockResolvedValue(null),
      saveFile: vi.fn().mockResolvedValue(null),
      showMessage: vi.fn().mockResolvedValue(undefined),
      confirm: vi.fn().mockResolvedValue(true),
    },
    app: {
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      getPath: vi.fn().mockResolvedValue('/test/path'),
      openExternal: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue({ success: true }),
      getCacheSize: vi.fn().mockResolvedValue({ size: 0, files: 0 }),
      getCacheBreakdown: vi.fn().mockResolvedValue({
        electron: 0,
        logs: 0,
        offline: 0,
        auth: 0,
      }),
      clearCacheTypes: vi.fn().mockResolvedValue({ success: true }),
      window: {
        minimize: vi.fn().mockResolvedValue(undefined),
        maximize: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        isMaximized: vi.fn().mockResolvedValue(false),
      },
    },
    store: {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    auth: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      list: vi.fn().mockResolvedValue([]),
      has: vi.fn().mockResolvedValue(false),
      clear: vi.fn().mockResolvedValue({ success: true }),
      isEncryptionAvailable: vi.fn().mockResolvedValue(true),
    },
    shell: {
      register: vi.fn().mockResolvedValue({ success: true }),
      unregister: vi.fn().mockResolvedValue({ success: true }),
      isRegistered: vi.fn().mockResolvedValue({ registered: false }),
      updateOverlay: vi.fn().mockResolvedValue({ success: true }),
      clearOverlay: vi.fn().mockResolvedValue({ success: true }),
      clearAllOverlays: vi.fn().mockResolvedValue({ success: true }),
    },
    deepLink: {
      onAction: vi.fn().mockReturnValue(() => {}),
    },
  };
}

/**
 * Clear all mock function calls
 */
export function clearAllMocks(): void {
  vi.clearAllMocks();
  // Remove only the Electron API mock. Replacing/deleting jsdom's Window breaks
  // React's active-element checks in any later test rendered in this process.
  if (typeof window !== 'undefined') {
    delete (window as Window & { api?: unknown }).api;
  }
}

/**
 * Re-export commonly used test utilities
 */
export { vi, describe, it, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
