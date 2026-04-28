/**
 * Tests for Store IPC Handlers
 *
 * Tests persistent settings storage operations.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create mock functions with hoisting
const mockIpcMainHandle = vi.hoisted(() => vi.fn());
const mockGetPath = vi.hoisted(() => vi.fn().mockReturnValue('/test/user-data'));

// Mock electron module
vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath,
  },
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

// Mock fs/promises - skip fs-dependent tests
vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
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
import { registerStoreHandlers } from '../store';

describe('Store IPC Handlers', () => {
  // Store registered handlers
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();

    // Capture registered handlers
    mockIpcMainHandle.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });

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
    it('should return undefined for non-existent key', async () => {
      const handler = handlers.get('store:get');
      const result = await handler!({}, 'nonexistent');

      expect(result).toBeUndefined();
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
      const result = await handler!({}, 'testKey', 'testValue');

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
      await setHandler!({}, 'deleteKey', 'value');

      // Then delete it
      const deleteHandler = handlers.get('store:delete');
      const result = await deleteHandler!({}, 'deleteKey');

      expect(result).toBeUndefined();
    });
  });

  describe('integration', () => {
    it('should get value that was previously set', async () => {
      const setHandler = handlers.get('store:set');
      const getHandler = handlers.get('store:get');

      await setHandler!({}, 'myKey', 'myValue');
      const result = await getHandler!({}, 'myKey');

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

      await setHandler!({}, 'complexKey', complexObject);
      const result = await getHandler!({}, 'complexKey');

      expect(result).toEqual(complexObject);
    });

    it('should return undefined after delete', async () => {
      const setHandler = handlers.get('store:set');
      const getHandler = handlers.get('store:get');
      const deleteHandler = handlers.get('store:delete');

      await setHandler!({}, 'tempKey', 'tempValue');
      await deleteHandler!({}, 'tempKey');
      const result = await getHandler!({}, 'tempKey');

      expect(result).toBeUndefined();
    });

    it('should overwrite existing values', async () => {
      const setHandler = handlers.get('store:set');
      const getHandler = handlers.get('store:get');

      await setHandler!({}, 'overwriteKey', 'value1');
      await setHandler!({}, 'overwriteKey', 'value2');
      const result = await getHandler!({}, 'overwriteKey');

      expect(result).toBe('value2');
    });
  });
});
