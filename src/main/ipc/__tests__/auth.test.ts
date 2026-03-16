/**
 * Tests for Auth IPC Handlers
 *
 * Tests the IPC handlers for credential storage operations.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create mock functions with hoisting
const mockIpcMainHandle = vi.hoisted(() => vi.fn());

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

// Mock auth-cache module - use hoisted functions
const mockGet = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockList = vi.hoisted(() => vi.fn());
const mockHas = vi.hoisted(() => vi.fn());
const mockClear = vi.hoisted(() => vi.fn());
const mockIsEncryptionAvailable = vi.hoisted(() => vi.fn());

vi.mock('../../auth-cache', () => ({
  getAuthCache: () => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
    list: mockList,
    has: mockHas,
    clear: mockClear,
    isEncryptionAvailable: mockIsEncryptionAvailable,
  }),
}));

// Import after mocking
import { registerAuthHandlers, AuthCredential, AuthListEntry } from '../auth';

describe('Auth IPC Handlers', () => {
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
    registerAuthHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handler registration', () => {
    it('should register auth:get handler', () => {
      expect(handlers.has('auth:get')).toBe(true);
    });

    it('should register auth:set handler', () => {
      expect(handlers.has('auth:set')).toBe(true);
    });

    it('should register auth:delete handler', () => {
      expect(handlers.has('auth:delete')).toBe(true);
    });

    it('should register auth:list handler', () => {
      expect(handlers.has('auth:list')).toBe(true);
    });

    it('should register auth:has handler', () => {
      expect(handlers.has('auth:has')).toBe(true);
    });

    it('should register auth:clear handler', () => {
      expect(handlers.has('auth:clear')).toBe(true);
    });

    it('should register auth:isEncryptionAvailable handler', () => {
      expect(handlers.has('auth:isEncryptionAvailable')).toBe(true);
    });
  });

  describe('auth:get', () => {
    it('should return credential for realm', async () => {
      const credential: AuthCredential = { username: 'testuser', password: 'testpass' };
      mockGet.mockReturnValue(credential);

      const handler = handlers.get('auth:get');
      const result = await handler!({}, 'https://svn.example.com');

      expect(mockGet).toHaveBeenCalledWith('https://svn.example.com');
      expect(result).toEqual(credential);
    });

    it('should return null for non-existent realm', async () => {
      mockGet.mockReturnValue(null);

      const handler = handlers.get('auth:get');
      const result = await handler!({}, 'https://nonexistent.com');

      expect(result).toBeNull();
    });
  });

  describe('auth:set', () => {
    it('should store credential and return success', async () => {
      const handler = handlers.get('auth:set');
      const result = await handler!({}, 'https://svn.example.com', 'testuser', 'testpass');

      expect(mockSet).toHaveBeenCalledWith('https://svn.example.com', 'testuser', 'testpass');
      expect(result).toEqual({ success: true });
    });
  });

  describe('auth:delete', () => {
    it('should delete credential and return success', async () => {
      const handler = handlers.get('auth:delete');
      const result = await handler!({}, 'https://svn.example.com');

      expect(mockDelete).toHaveBeenCalledWith('https://svn.example.com');
      expect(result).toEqual({ success: true });
    });
  });

  describe('auth:list', () => {
    it('should return list of credentials without passwords', async () => {
      const list: AuthListEntry[] = [
        { realm: 'https://svn1.example.com', username: 'user1', createdAt: 1704067200000 },
        { realm: 'https://svn2.example.com', username: 'user2', createdAt: 1704153600000 },
      ];
      mockList.mockReturnValue(list);

      const handler = handlers.get('auth:list');
      const result = await handler!({});

      expect(mockList).toHaveBeenCalled();
      expect(result).toEqual(list);
    });

    it('should return empty array when no credentials', async () => {
      mockList.mockReturnValue([]);

      const handler = handlers.get('auth:list');
      const result = await handler!({});

      expect(result).toEqual([]);
    });
  });

  describe('auth:has', () => {
    it('should return true for existing credential', async () => {
      mockHas.mockReturnValue(true);

      const handler = handlers.get('auth:has');
      const result = await handler!({}, 'https://svn.example.com');

      expect(mockHas).toHaveBeenCalledWith('https://svn.example.com');
      expect(result).toBe(true);
    });

    it('should return false for non-existent credential', async () => {
      mockHas.mockReturnValue(false);

      const handler = handlers.get('auth:has');
      const result = await handler!({}, 'https://nonexistent.com');

      expect(result).toBe(false);
    });
  });

  describe('auth:clear', () => {
    it('should clear all credentials and return success', async () => {
      const handler = handlers.get('auth:clear');
      const result = await handler!({});

      expect(mockClear).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('auth:isEncryptionAvailable', () => {
    it('should return true when encryption is available', async () => {
      mockIsEncryptionAvailable.mockReturnValue(true);

      const handler = handlers.get('auth:isEncryptionAvailable');
      const result = await handler!({});

      expect(result).toBe(true);
    });

    it('should return false when encryption is not available', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false);

      const handler = handlers.get('auth:isEncryptionAvailable');
      const result = await handler!({});

      expect(result).toBe(false);
    });
  });
});
