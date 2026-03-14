/**
 * Security Tests for Auth Cache
 *
 * Tests credential storage, encryption, and retrieval.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock modules using vi.mock (hoisted)
vi.mock('node:fs/promises', () => ({
  default: {},
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/test/user-data'),
  },
}));

vi.mock('@shared/utils/debug', () => ({
  debug: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { safeStorage } from 'electron';
import { AuthCache } from '../auth-cache';

// Get typed mocks
const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockEncryptString = vi.mocked(safeStorage.encryptString);
const mockDecryptString = vi.mocked(safeStorage.decryptString);
const mockIsEncryptionAvailable = vi.mocked(safeStorage.isEncryptionAvailable);

describe('AuthCache', () => {
  let authCache: AuthCache;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: encryption available
    mockIsEncryptionAvailable.mockReturnValue(true);

    // Default: no existing cache file
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    // Default encryption: base64 encode
    mockEncryptString.mockImplementation((str: string) => {
      return Buffer.from(`encrypted:${str}`);
    });

    // Default decryption: reverse of encryption
    mockDecryptString.mockImplementation((buf: Buffer) => {
      const str = buf.toString();
      if (str.startsWith('encrypted:')) {
        return str.slice(10);
      }
      throw new Error('Decryption failed');
    });

    // Create instance
    authCache = new AuthCache('/test/user-data');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should create instance with encryption available', async () => {
      mockIsEncryptionAvailable.mockReturnValue(true);

      const cache = new AuthCache('/test/user-data');
      await cache.ready();

      expect(cache.isEncryptionAvailable()).toBe(true);
    });

    it('should work without encryption (memory-only mode)', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false);

      const cache = new AuthCache('/test/user-data');
      await cache.ready();

      expect(cache.isEncryptionAvailable()).toBe(false);
    });

    it('should load existing credentials on init', async () => {
      const existingData = {
        version: 1,
        credentials: [
          {
            realm: 'https://svn.example.com',
            username: 'testuser',
            password: 'encrypted:testpass',
            createdAt: 1704067200000,
          },
        ],
      };

      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(JSON.stringify(existingData));

      const cache = new AuthCache('/test/user-data');
      await cache.ready();

      const credential = cache.get('https://svn.example.com');
      expect(credential).toEqual({
        username: 'testuser',
        password: 'testpass',
      });
    });

    it('should skip credentials that fail to decrypt on load', async () => {
      const existingData = {
        version: 1,
        credentials: [
          {
            realm: 'https://svn.example.com',
            username: 'testuser',
            password: 'invalid-encrypted',
            createdAt: 1704067200000,
          },
        ],
      };

      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(JSON.stringify(existingData));
      mockDecryptString.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const cache = new AuthCache('/test/user-data');
      await cache.ready();

      expect(cache.get('https://svn.example.com')).toBeNull();
    });
  });

  describe('set and get', () => {
    it('should store and retrieve credentials', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      const credential = authCache.get('https://svn.example.com');
      expect(credential).toEqual({
        username: 'testuser',
        password: 'testpass',
      });
    });

    it('should encrypt password when encryption is available', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      expect(mockEncryptString).toHaveBeenCalledWith('testpass');
    });

    it('should not encrypt password when encryption is unavailable', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false);
      const noEncryptionCache = new AuthCache('/test/user-data');
      await noEncryptionCache.ready();

      noEncryptionCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      expect(mockEncryptString).not.toHaveBeenCalled();
    });

    it('should overwrite existing credentials for same realm', async () => {
      authCache.set('https://svn.example.com', 'user1', 'pass1');
      await vi.runAllTimersAsync();

      authCache.set('https://svn.example.com', 'user2', 'pass2');
      await vi.runAllTimersAsync();

      const credential = authCache.get('https://svn.example.com');
      expect(credential).toEqual({
        username: 'user2',
        password: 'pass2',
      });
    });

    it('should return null for non-existent realm', () => {
      const credential = authCache.get('https://nonexistent.com');
      expect(credential).toBeNull();
    });

    it('should delete credential and return null if decryption fails', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      // Make decryption fail on next call
      mockDecryptString.mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      const credential = authCache.get('https://svn.example.com');
      expect(credential).toBeNull();

      // Verify it was deleted
      expect(authCache.has('https://svn.example.com')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete stored credential', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      expect(authCache.has('https://svn.example.com')).toBe(true);

      authCache.delete('https://svn.example.com');
      await vi.runAllTimersAsync();

      expect(authCache.has('https://svn.example.com')).toBe(false);
      expect(authCache.get('https://svn.example.com')).toBeNull();
    });

    it('should be safe to call for non-existent realm', () => {
      expect(() => authCache.delete('https://nonexistent.com')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all credentials', async () => {
      authCache.set('https://svn1.example.com', 'user1', 'pass1');
      authCache.set('https://svn2.example.com', 'user2', 'pass2');
      await vi.runAllTimersAsync();

      authCache.clear();
      await vi.runAllTimersAsync();

      expect(authCache.list()).toEqual([]);
    });
  });

  describe('list', () => {
    it('should list all stored credentials without passwords', async () => {
      authCache.set('https://svn1.example.com', 'user1', 'pass1');
      authCache.set('https://svn2.example.com', 'user2', 'pass2');
      await vi.runAllTimersAsync();

      const list = authCache.list();

      expect(list).toHaveLength(2);
      expect(list).toContainEqual({
        realm: 'https://svn1.example.com',
        username: 'user1',
        createdAt: expect.any(Number),
      });
      expect(list).toContainEqual({
        realm: 'https://svn2.example.com',
        username: 'user2',
        createdAt: expect.any(Number),
      });
    });

    it('should return empty array when no credentials stored', () => {
      expect(authCache.list()).toEqual([]);
    });
  });

  describe('has', () => {
    it('should return true for existing credential', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      expect(authCache.has('https://svn.example.com')).toBe(true);
    });

    it('should return false for non-existent credential', () => {
      expect(authCache.has('https://nonexistent.com')).toBe(false);
    });
  });

  describe('findForUrl', () => {
    it('should find exact URL match', async () => {
      authCache.set('https://svn.example.com/repo', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      const result = authCache.findForUrl('https://svn.example.com/repo');

      expect(result).toEqual({
        username: 'testuser',
        password: 'testpass',
        realm: 'https://svn.example.com/repo',
      });
    });

    it('should find prefix match when exact match not found', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      const result = authCache.findForUrl('https://svn.example.com/repo/trunk');

      expect(result).toEqual({
        username: 'testuser',
        password: 'testpass',
        realm: 'https://svn.example.com',
      });
    });

    it('should prefer longest (most specific) prefix match', async () => {
      authCache.set('https://svn.example.com', 'user1', 'pass1');
      authCache.set('https://svn.example.com/repo', 'user2', 'pass2');
      await vi.runAllTimersAsync();

      const result = authCache.findForUrl('https://svn.example.com/repo/trunk');

      expect(result).toEqual({
        username: 'user2',
        password: 'pass2',
        realm: 'https://svn.example.com/repo',
      });
    });

    it('should return null when no match found', () => {
      const result = authCache.findForUrl('https://nonexistent.com/repo');
      expect(result).toBeNull();
    });

    it('should delete credential and return null if decryption fails', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      mockDecryptString.mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      const result = authCache.findForUrl('https://svn.example.com/repo');
      expect(result).toBeNull();
      expect(authCache.has('https://svn.example.com')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should save credentials to disk', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/test/user-data/auth-cache.json',
        expect.stringContaining('"version":1'),
        'utf-8'
      );

      const savedData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(savedData.credentials).toHaveLength(1);
      expect(savedData.credentials[0].realm).toBe('https://svn.example.com');
      expect(savedData.credentials[0].username).toBe('testuser');
      expect(savedData.credentials[0].password).toBe('encrypted:testpass');
    });

    it('should create directory if it does not exist', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      expect(mockMkdir).toHaveBeenCalledWith('/test/user-data', { recursive: true });
    });

    it('should handle save errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      // Should not throw, credential should still be in memory
      expect(authCache.get('https://svn.example.com')).toEqual({
        username: 'testuser',
        password: 'testpass',
      });

      consoleSpy.mockRestore();
    });
  });

  describe('concurrent operations', () => {
    it('should handle sequential saves correctly', async () => {
      // First save
      authCache.set('https://svn1.example.com', 'user1', 'pass1');
      await vi.runAllTimersAsync();

      // Second save
      authCache.set('https://svn2.example.com', 'user2', 'pass2');
      await vi.runAllTimersAsync();

      expect(mockWriteFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('security considerations', () => {
    it('should not expose passwords in list output', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'supersecret');
      await vi.runAllTimersAsync();

      const list = authCache.list();
      const listStr = JSON.stringify(list);

      expect(listStr).not.toContain('supersecret');
    });

    it('should use encryption for password storage', async () => {
      authCache.set('https://svn.example.com', 'testuser', 'testpass');
      await vi.runAllTimersAsync();

      // Verify encryption was called
      expect(mockEncryptString).toHaveBeenCalledWith('testpass');

      // Verify saved data contains encrypted password
      const savedData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(savedData.credentials[0].password).not.toBe('testpass');
      expect(savedData.credentials[0].password).toBe('encrypted:testpass');
    });
  });
});
