/**
 * Comprehensive Electron API Mock for Testing
 *
 * Provides mock implementations of window.api for unit tests.
 * Import and use createMockElectronAPI() in your test setup.
 */

import { vi } from 'vitest';
import type {
  ElectronAPI,
  SvnStatusResult,
  SvnLogResult,
  SvnInfoResult,
  SvnDiffResult,
  SvnListResult,
  SvnBlameResult,
  SvnLockInfo,
  SvnChangelistResult,
  SvnShelveListResult,
  SvnExternal,
  RepoDiagnostics,
  FileInfo,
  FsStatusResult,
  AuthCredential,
  AuthListEntry,
  WorkingCopyInfo,
  CheckoutProgress,
} from '@shared/types';

/**
 * Create mock SVN response generators
 */
export function createMockSvnResponses() {
  return {
    status: {
      empty: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [],
        revision: 1,
      }),
      modified: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [
          {
            path: '/test/repo/modified.txt',
            status: 'M',
            isDirectory: false,
            revision: 5,
            author: 'testuser',
          },
        ],
        revision: 5,
      }),
      added: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [
          {
            path: '/test/repo/new.txt',
            status: 'A',
            isDirectory: false,
          },
        ],
        revision: 1,
      }),
      conflicted: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [
          {
            path: '/test/repo/conflict.txt',
            status: 'C',
            isDirectory: false,
          },
        ],
        revision: 1,
      }),
      unversioned: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [
          {
            path: '/test/repo/untracked.txt',
            status: '?',
            isDirectory: false,
          },
        ],
        revision: 1,
      }),
      deleted: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [
          {
            path: '/test/repo/removed.txt',
            status: 'D',
            isDirectory: false,
          },
        ],
        revision: 1,
      }),
      locked: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [
          {
            path: '/test/repo/locked.txt',
            status: ' ',
            isDirectory: false,
            lock: {
              owner: 'lockuser',
              comment: 'Locked for editing',
              date: '2024-01-01T00:00:00Z',
            },
          },
        ],
        revision: 1,
      }),
      mixed: (): SvnStatusResult => ({
        path: '/test/repo',
        entries: [
          {
            path: '/test/repo/modified.txt',
            status: 'M',
            isDirectory: false,
            revision: 5,
            author: 'user1',
          },
          {
            path: '/test/repo/added.txt',
            status: 'A',
            isDirectory: false,
          },
          {
            path: '/test/repo/untracked.txt',
            status: '?',
            isDirectory: false,
          },
          {
            path: '/test/repo/subdir',
            status: ' ',
            isDirectory: true,
          },
        ],
        revision: 5,
      }),
    },

    log: {
      empty: (): SvnLogResult => ({
        entries: [],
        startRevision: 0,
        endRevision: 0,
      }),
      single: (): SvnLogResult => ({
        entries: [
          {
            revision: 1,
            author: 'testuser',
            date: '2024-01-01T12:00:00Z',
            message: 'Initial commit',
            paths: [{ action: 'A', path: '/trunk' }],
          },
        ],
        startRevision: 1,
        endRevision: 1,
      }),
      multiple: (): SvnLogResult => ({
        entries: [
          {
            revision: 3,
            author: 'user2',
            date: '2024-01-03T12:00:00Z',
            message: 'Third commit',
            paths: [{ action: 'M', path: '/trunk/file.txt' }],
          },
          {
            revision: 2,
            author: 'user1',
            date: '2024-01-02T12:00:00Z',
            message: 'Second commit',
            paths: [{ action: 'A', path: '/trunk/file.txt' }],
          },
          {
            revision: 1,
            author: 'user1',
            date: '2024-01-01T12:00:00Z',
            message: 'Initial commit',
            paths: [{ action: 'A', path: '/trunk' }],
          },
        ],
        startRevision: 1,
        endRevision: 3,
      }),
    },

    info: {
      basic: (): SvnInfoResult => ({
        path: '/test/repo',
        url: 'https://svn.example.com/repo/trunk',
        repositoryRoot: 'https://svn.example.com/repo',
        repositoryUuid: '12345678-1234-1234-1234-123456789012',
        revision: 5,
        nodeKind: 'dir',
        lastChangedAuthor: 'testuser',
        lastChangedRevision: 5,
        lastChangedDate: '2024-01-01T12:00:00Z',
        workingCopyRoot: '/test/repo',
      }),
      locked: (): SvnInfoResult => ({
        path: '/test/repo/locked.txt',
        url: 'https://svn.example.com/repo/trunk/locked.txt',
        repositoryRoot: 'https://svn.example.com/repo',
        repositoryUuid: '12345678-1234-1234-1234-123456789012',
        revision: 5,
        nodeKind: 'file',
        lastChangedAuthor: 'testuser',
        lastChangedRevision: 5,
        lastChangedDate: '2024-01-01T12:00:00Z',
        lock: {
          path: '/test/repo/locked.txt',
          owner: 'lockuser',
          comment: 'Locked for editing',
          date: '2024-01-01T00:00:00Z',
        },
      }),
    },

    list: {
      empty: (): SvnListResult => ({
        path: 'https://svn.example.com/repo/trunk',
        entries: [],
      }),
      basic: (): SvnListResult => ({
        path: 'https://svn.example.com/repo/trunk',
        entries: [
          {
            name: 'src',
            path: 'https://svn.example.com/repo/trunk/src',
            url: 'https://svn.example.com/repo/trunk/src',
            kind: 'dir',
            revision: 5,
            author: 'testuser',
            date: '2024-01-01T12:00:00Z',
          },
          {
            name: 'README.md',
            path: 'https://svn.example.com/repo/trunk/README.md',
            url: 'https://svn.example.com/repo/trunk/README.md',
            kind: 'file',
            size: 1024,
            revision: 3,
            author: 'user1',
            date: '2024-01-01T10:00:00Z',
          },
        ],
      }),
    },

    diff: {
      empty: (): SvnDiffResult => ({
        files: [],
        hasChanges: false,
      }),
      modified: (): SvnDiffResult => ({
        files: [
          {
            oldPath: '/test/repo/file.txt',
            newPath: '/test/repo/file.txt',
            hunks: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 2,
                lines: [
                  { type: 'context', content: 'context line', oldLineNumber: 1, newLineNumber: 1 },
                  { type: 'removed', content: 'old line', oldLineNumber: 2 },
                  { type: 'added', content: 'new line', newLineNumber: 2 },
                ],
              },
            ],
          },
        ],
        hasChanges: true,
      }),
    },

    blame: {
      basic: (): SvnBlameResult => ({
        path: '/test/repo/file.txt',
        lines: [
          {
            lineNumber: 1,
            revision: 1,
            author: 'user1',
            date: '2024-01-01T12:00:00Z',
            content: 'first line',
          },
          {
            lineNumber: 2,
            revision: 2,
            author: 'user2',
            date: '2024-01-02T12:00:00Z',
            content: 'second line',
          },
        ],
        startRevision: 1,
        endRevision: 2,
      }),
    },
  };
}

/**
 * Create a comprehensive mock Electron API
 */
export function createMockElectronAPI(): ElectronAPI {
  const mockResponses = createMockSvnResponses();

  return {
    svn: {
      status: vi.fn().mockResolvedValue(mockResponses.status.empty()),
      log: vi.fn().mockResolvedValue(mockResponses.log.empty()),
      info: vi.fn().mockResolvedValue(mockResponses.info.basic()),
      infoUrl: vi.fn().mockResolvedValue(mockResponses.info.basic()),
      getWorkingCopyContext: vi.fn().mockResolvedValue({
        workingCopyRoot: '/test/repo',
        repositoryRoot: 'https://svn.example.com/repo',
        url: 'https://svn.example.com/repo/trunk',
      }),
      diff: vi.fn().mockResolvedValue(mockResponses.diff.empty()),
      diffStreaming: vi.fn().mockResolvedValue(mockResponses.diff.empty()),
      update: vi.fn().mockResolvedValue({ success: true, revision: 5 }),
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
      cancelCheckout: vi.fn().mockResolvedValue(undefined),
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
      blame: vi.fn().mockResolvedValue(mockResponses.blame.basic()),
      list: vi.fn().mockResolvedValue(mockResponses.list.basic()),
      patch: {
        create: vi.fn().mockResolvedValue({ success: true, output: '' }),
        apply: vi.fn().mockResolvedValue({ success: true, filesPatched: 0, rejects: 0, output: '' }),
      },
      externals: {
        list: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockResolvedValue({ success: true }),
        remove: vi.fn().mockResolvedValue({ success: true }),
      },
      diagnostics: vi.fn().mockResolvedValue({
        isValidWorkingCopy: true,
        workingCopyRoot: '/test/repo',
        repositoryRoot: 'https://svn.example.com/repo',
        repositoryUrl: 'https://svn.example.com/repo/trunk',
        repositoryUuid: '12345678-1234-1234-1234-123456789012',
        hasCredentials: false,
        credentialRealm: null,
        credentialUsername: null,
        connectionStatus: 'ok',
      } as RepoDiagnostics),
    },
    external: {
      openDiffTool: vi.fn().mockResolvedValue({ success: true }),
      openMergeTool: vi.fn().mockResolvedValue({ success: true }),
      openFolder: vi.fn().mockResolvedValue({ success: true }),
      openFile: vi.fn().mockResolvedValue({ success: true }),
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
    },
    app: {
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      getPath: vi.fn().mockResolvedValue('/test/path'),
      openExternal: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue({ success: true }),
      getCacheSize: vi.fn().mockResolvedValue({ size: 0, files: 0 }),
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
 * Set up global window.api mock
 */
export function setupWindowApiMock(): void {
  const mockApi = createMockElectronAPI();
  (globalThis as any).window = {
    api: mockApi,
  };
}

/**
 * Clear all mock function calls
 */
export function clearAllMocks(): void {
  vi.clearAllMocks();
}

/**
 * Helper to mock a successful SVN status operation
 */
export function mockSuccessfulSvnStatus(entries: SvnStatusResult['entries']): void {
  const mockApi = (globalThis as any).window?.api as ElectronAPI;
  if (mockApi) {
    (mockApi.svn.status as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/test/repo',
      entries,
      revision: 1,
    });
  }
}

/**
 * Helper to mock a failed SVN operation
 */
export function mockFailedSvnOperation(operation: keyof ElectronAPI['svn'], error: string): void {
  const mockApi = (globalThis as any).window?.api as ElectronAPI;
  if (mockApi) {
    const fn = mockApi.svn[operation] as ReturnType<typeof vi.fn>;
    if (fn && typeof fn.mockRejectedValue === 'function') {
      fn.mockRejectedValue(new Error(error));
    }
  }
}

/**
 * Helper to mock auth credentials
 */
export function mockAuthCredential(realm: string, username: string, password: string): void {
  const mockApi = (globalThis as any).window?.api as ElectronAPI;
  if (mockApi) {
    (mockApi.auth.get as ReturnType<typeof vi.fn>).mockImplementation(async (r: string) => {
      if (r === realm) {
        return { username, password };
      }
      return null;
    });
  }
}

export { createMockElectronAPI as default };
