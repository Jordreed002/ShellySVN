/**
 * Electron API Mock for Testing
 *
 * Provides mock implementations of window.api for unit tests.
 */

import { vi } from 'vitest';
import type { ElectronAPI } from '@shared/types';

/**
 * Create a comprehensive mock Electron API
 */
export function createMockElectronAPI(): ElectronAPI {
  return {
    svn: {
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
      trustServerCertificate: vi.fn().mockResolvedValue({ success: true }),
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
  (globalThis as Record<string, unknown>).window = {
    api: mockApi,
  };
}

/**
 * Clear all mock function calls
 */
export function clearAllMocks(): void {
  vi.clearAllMocks();
}

export { createMockElectronAPI as default };
