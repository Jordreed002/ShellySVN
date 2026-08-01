// @vitest-environment node
/**
 * Tests for Store IPC Handlers
 *
 * Tests persistent settings storage operations.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create mock functions with hoisting
const mockIpcMainHandle = vi.hoisted(() => vi.fn());
const mockGetPath = vi.hoisted(() => vi.fn().mockReturnValue('/test/user-data'));
const mockWriteSecureJson = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Hoisted fs/promises mocks so both 'fs/promises' and 'node:fs/promises'
// specifiers resolve to the same fns (store.ts imports the bare form).
const fsMocks = vi.hoisted(() => ({
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

// Mock electron module
vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath,
  },
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

// Mock fs/promises - store.ts imports the bare specifier, so mock that and
// preserve the module's default/other exports via importOriginal.
vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs/promises')>()),
  ...fsMocks,
}));

vi.mock('../../utils/secure-json', () => ({
  writeSecureJson: mockWriteSecureJson,
}));

// Mock settings-manager with a factory that creates fresh instances
const mockSettingsManagerReady = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetSettings = vi.hoisted(() => vi.fn().mockReturnValue({ recentRepositories: [] }));
const mockUpdateSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: mockSettingsManagerReady,
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
  }),
}));

// Import after mocking
import { access, chmod, readFile } from 'fs/promises';
import { registerStoreHandlers, resetStoreForTests } from '../store';

describe('Store IPC Handlers', () => {
  // Store registered handlers
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();

    // Capture registered handlers
    mockIpcMainHandle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    );

    // Register handlers
    registerStoreHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handler registration', () => {
    it('should register store:get handler', () => {
      expect(handlers.has('store:get')).toBe(true);
    });

    it('should register store:set handler', () => {
      expect(handlers.has('store:set')).toBe(true);
    });

    it('should register store:delete handler', () => {
      expect(handlers.has('store:delete')).toBe(true);
    });
  });

  describe('store:get', () => {
    it('rejects unsupported keys', async () => {
      const handler = handlers.get('store:get');
      await expect(handler!({}, 'nonexistent')).rejects.toThrow('Unsupported store key');
    });

    it('should return settings from SettingsManager for settings key', async () => {
      const mockSettings = { recentRepositories: ['/path/to/repo'] };
      mockGetSettings.mockReturnValue(mockSettings);

      const handler = handlers.get('store:get');
      const result = await handler!({}, 'settings');

      // Settings key returns the value from SettingsManager
      expect(result).toEqual(mockSettings);
    });
  });

  describe('store:set', () => {
    it('should set a value and return undefined', async () => {
      const handler = handlers.get('store:set');
      const result = await handler!({}, 'shellysvn:testKey', 'testValue');

      // set returns void
      expect(result).toBeUndefined();
    });

    it('should store settings key value', async () => {
      const newSettings = { recentRepositories: ['/new/path'] };

      const handler = handlers.get('store:set');
      const result = await handler!({}, 'settings', newSettings);

      // Should not throw and return undefined
      expect(result).toBeUndefined();
    });
  });

  describe('store:delete', () => {
    it('should delete a key and return undefined', async () => {
      // First set a value
      const setHandler = handlers.get('store:set');
      await setHandler!({}, 'shellysvn:deleteKey', 'value');

      // Then delete it
      const deleteHandler = handlers.get('store:delete');
      const result = await deleteHandler!({}, 'shellysvn:deleteKey');

      expect(result).toBeUndefined();
    });
  });

  describe('integration', () => {
    it('should get value that was previously set', async () => {
      const setHandler = handlers.get('store:set');
      const getHandler = handlers.get('store:get');

      await setHandler!({}, 'shellysvn:myKey', 'myValue');
      const result = await getHandler!({}, 'shellysvn:myKey');

      expect(result).toBe('myValue');
    });

    it('should handle complex objects', async () => {
      const setHandler = handlers.get('store:set');
      const getHandler = handlers.get('store:get');

      const complexObject = {
        nested: {
          value: 123,
          array: ['a', 'b', 'c'],
        },
        boolean: true,
      };

      await setHandler!({}, 'shellysvn:complexKey', complexObject);
      const result = await getHandler!({}, 'shellysvn:complexKey');

      expect(result).toEqual(complexObject);
    });

    it('should return undefined after delete', async () => {
      const setHandler = handlers.get('store:set');
      const getHandler = handlers.get('store:get');
      const deleteHandler = handlers.get('store:delete');

      await setHandler!({}, 'shellysvn:tempKey', 'tempValue');
      await deleteHandler!({}, 'shellysvn:tempKey');
      const result = await getHandler!({}, 'shellysvn:tempKey');

      expect(result).toBeUndefined();
    });

    it('should overwrite existing values', async () => {
      const setHandler = handlers.get('store:set');
      const getHandler = handlers.get('store:get');

      await setHandler!({}, 'shellysvn:overwriteKey', 'value1');
      await setHandler!({}, 'shellysvn:overwriteKey', 'value2');
      const result = await getHandler!({}, 'shellysvn:overwriteKey');

      expect(result).toBe('value2');
    });
  });

  /*
   * Load-time file permissions. When an existing config file is found, load()
   * tightens it to 0o600 on POSIX and skips the chmod on win32 (no permission
   * bits). The store loads lazily on first handler invocation, so reset the
   * singleton, point access at an existing file, and drive a handler.
   */
  describe('load-time file permissions', () => {
    const originalPlatform = process.platform;
    const mockAccess = vi.mocked(access);
    const mockReadFile = vi.mocked(readFile);
    const mockChmod = vi.mocked(chmod);

    beforeEach(() => {
      resetStoreForTests();
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('{}');
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      });
      resetStoreForTests();
    });

    it('tightens an existing config to 0o600 on POSIX', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
        writable: true,
      });

      await handlers.get('store:get')!({}, 'settings');

      expect(mockChmod).toHaveBeenCalledWith(
        expect.stringContaining('shellysvn-config.json'),
        0o600
      );
    });

    it('skips the chmod on Windows (no permission bits)', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
        writable: true,
      });

      await handlers.get('store:get')!({}, 'settings');

      expect(mockChmod).not.toHaveBeenCalled();
    });
  });
});
