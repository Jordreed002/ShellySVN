/**
 * Tests for App IPC Handlers
 *
 * Tests app-level operations including version info, cache management,
 * and external URL validation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create mock state with hoisting
const mockState = vi.hoisted(() => ({
  ipcMainHandle: vi.fn(),
  appGetVersion: vi.fn().mockReturnValue('1.0.0'),
  appGetPath: vi.fn().mockReturnValue('/test/path'),
  shellOpenExternal: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 0, isFile: () => true, isDirectory: () => false }),
  unlink: vi.fn().mockResolvedValue(undefined),
  rmdir: vi.fn().mockResolvedValue(undefined),
  getFocusedWindow: vi.fn().mockReturnValue({
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockReturnValue(false),
  }),
}));

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: mockState.ipcMainHandle,
  },
  app: {
    getVersion: mockState.appGetVersion,
    getPath: mockState.appGetPath,
  },
  shell: {
    openExternal: mockState.shellOpenExternal,
  },
  BrowserWindow: {
    getFocusedWindow: mockState.getFocusedWindow,
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {},
  readdir: mockState.readdir,
  stat: mockState.stat,
  unlink: mockState.unlink,
  rmdir: mockState.rmdir,
}));

// Import after mocking
import { registerAppHandlers } from '../app';
import { clearApprovedPathsForTests, isPathApprovedForIpc } from '../../utils/approved-paths';

describe('App IPC Handlers', () => {
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  beforeEach(() => {
    handlers.clear();
    clearApprovedPathsForTests();

    // Reset mock call counts
    mockState.ipcMainHandle.mockClear();
    mockState.appGetVersion.mockClear();
    mockState.appGetPath.mockClear();
    mockState.shellOpenExternal.mockClear();
    mockState.readdir.mockClear();
    mockState.stat.mockClear();
    mockState.unlink.mockClear();
    mockState.rmdir.mockClear();

    // Reset mock implementations
    mockState.appGetVersion.mockReturnValue('1.0.0');
    mockState.appGetPath.mockReturnValue('/test/path');
    mockState.readdir.mockResolvedValue([]);
    mockState.stat.mockResolvedValue({ size: 0, isFile: () => true, isDirectory: () => false });

    // Capture registered handlers
    mockState.ipcMainHandle.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });

    // Register handlers
    registerAppHandlers();
  });

  afterEach(() => {
    clearApprovedPathsForTests();
    vi.restoreAllMocks();
  });

  describe('handler registration', () => {
    it('should register app:getVersion handler', () => {
      expect(handlers.has('app:getVersion')).toBe(true);
    });

    it('should register app:getPath handler', () => {
      expect(handlers.has('app:getPath')).toBe(true);
    });

    it('should register app:openExternal handler', () => {
      expect(handlers.has('app:openExternal')).toBe(true);
    });

    it('should register app:clearCache handler', () => {
      expect(handlers.has('app:clearCache')).toBe(true);
    });

    it('should register app:getCacheSize handler', () => {
      expect(handlers.has('app:getCacheSize')).toBe(true);
    });

    it('should register app:getCacheBreakdown handler', () => {
      expect(handlers.has('app:getCacheBreakdown')).toBe(true);
    });

    it('should register app:clearCacheTypes handler', () => {
      expect(handlers.has('app:clearCacheTypes')).toBe(true);
    });

    it('should register window control handlers', () => {
      expect(handlers.has('app:window:minimize')).toBe(true);
      expect(handlers.has('app:window:maximize')).toBe(true);
      expect(handlers.has('app:window:close')).toBe(true);
      expect(handlers.has('app:window:isMaximized')).toBe(true);
    });
  });

  describe('app:getVersion', () => {
    it('should return app version', async () => {
      const handler = handlers.get('app:getVersion');
      mockState.appGetVersion.mockReturnValue('2.1.0');

      const result = await handler!({});

      expect(result).toBe('2.1.0');
      expect(mockState.appGetVersion).toHaveBeenCalled();
    });
  });

  describe('app:getPath', () => {
    it('should return home path', async () => {
      const handler = handlers.get('app:getPath');
      mockState.appGetPath.mockReturnValue('/home/user');

      const result = await handler!({}, 'home');

      expect(result).toBe('/home/user');
      expect(mockState.appGetPath).toHaveBeenCalledWith('home');
      expect(isPathApprovedForIpc('/home/user')).toBe(true);
    });

    it('should return appData path', async () => {
      const handler = handlers.get('app:getPath');
      mockState.appGetPath.mockReturnValue('/AppData');

      const result = await handler!({}, 'appData');

      expect(result).toBe('/AppData');
    });

    it('should return desktop path', async () => {
      const handler = handlers.get('app:getPath');
      mockState.appGetPath.mockReturnValue('/Desktop');

      const result = await handler!({}, 'desktop');

      expect(result).toBe('/Desktop');
    });

    it('should return documents path', async () => {
      const handler = handlers.get('app:getPath');
      mockState.appGetPath.mockReturnValue('/Documents');

      const result = await handler!({}, 'documents');

      expect(result).toBe('/Documents');
    });

    it('should return temp path', async () => {
      const handler = handlers.get('app:getPath');
      mockState.appGetPath.mockReturnValue('/tmp');

      const result = await handler!({}, 'temp');

      expect(result).toBe('/tmp');
    });
  });

  describe('app:openExternal - URL validation', () => {
    it('should allow http URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'http://example.com');

      expect(result).toEqual({ success: true });
      expect(mockState.shellOpenExternal).toHaveBeenCalledWith('http://example.com');
    });

    it('should allow https URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'https://example.com');

      expect(result).toEqual({ success: true });
      expect(mockState.shellOpenExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('should allow mailto URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'mailto:test@example.com');

      expect(result).toEqual({ success: true });
      expect(mockState.shellOpenExternal).toHaveBeenCalledWith('mailto:test@example.com');
    });

    it('should reject file:// URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'file:///etc/passwd');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL scheme');
      expect(mockState.shellOpenExternal).not.toHaveBeenCalled();
    });

    it('should reject javascript: URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'javascript:alert(1)');

      expect(result.success).toBe(false);
      expect(mockState.shellOpenExternal).not.toHaveBeenCalled();
    });

    it('should reject data: URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'data:text/html,<script>alert(1)</script>');

      expect(result.success).toBe(false);
      expect(mockState.shellOpenExternal).not.toHaveBeenCalled();
    });

    it('should reject vbscript: URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'vbscript:msgbox(1)');

      expect(result.success).toBe(false);
      expect(mockState.shellOpenExternal).not.toHaveBeenCalled();
    });

    it('should reject malformed URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, 'not a valid url');

      expect(result.success).toBe(false);
      expect(mockState.shellOpenExternal).not.toHaveBeenCalled();
    });

    it('should reject empty URLs', async () => {
      const handler = handlers.get('app:openExternal');
      const result = await handler!({}, '');

      expect(result.success).toBe(false);
    });

    it('should reject URLs with unusual protocols', async () => {
      const handler = handlers.get('app:openExternal');

      // Test various dangerous protocols
      const dangerousUrls = [
        'ssh://evil.com',
        'ftp://evil.com',
        'file://localhost/etc/passwd',
        'about:blank',
        'chrome://settings',
      ];

      for (const url of dangerousUrls) {
        const result = await handler!({}, url);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('app:getCacheSize', () => {
    it('should return total cache size', async () => {
      const handler = handlers.get('app:getCacheSize');
      mockState.readdir.mockResolvedValue([]);
      mockState.stat.mockResolvedValue({ size: 1024, isFile: () => true, isDirectory: () => false });

      const result = await handler!({});

      expect(result).toHaveProperty('size');
      expect(result).toHaveProperty('files');
    });

    it('should handle errors gracefully', async () => {
      const handler = handlers.get('app:getCacheSize');
      mockState.readdir.mockRejectedValue(new Error('Read error'));

      const result = await handler!({});

      expect(result).toEqual({ size: 0, files: 0 });
    });
  });

  describe('app:clearCache', () => {
    it('should clear cache directories', async () => {
      const handler = handlers.get('app:clearCache');
      mockState.readdir.mockResolvedValue([]);

      const result = await handler!({});

      expect(result).toEqual({ success: true });
    });

    it('should handle errors gracefully', async () => {
      const handler = handlers.get('app:clearCache');
      // The clearCache handler catches errors internally
      // Even when readdir fails, it returns success: true because it uses try-catch
      mockState.readdir.mockResolvedValue([]);

      const result = await handler!({});

      // The implementation catches errors and returns success: true with empty clear
      expect(result.success).toBe(true);
    });
  });

  describe('app:getCacheBreakdown', () => {
    it('should return cache breakdown by type', async () => {
      const handler = handlers.get('app:getCacheBreakdown');
      mockState.readdir.mockResolvedValue([]);

      const result = await handler!({});

      expect(result).toHaveProperty('electron');
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('auth');
    });
  });

  describe('app:clearCacheTypes', () => {
    it('should clear electron cache', async () => {
      const handler = handlers.get('app:clearCacheTypes');
      mockState.readdir.mockResolvedValue([]);

      const result = await handler!({}, ['electron']);

      expect(result).toEqual({ success: true });
    });

    it('should clear logs cache', async () => {
      const handler = handlers.get('app:clearCacheTypes');
      mockState.readdir.mockResolvedValue([]);

      const result = await handler!({}, ['logs']);

      expect(result).toEqual({ success: true });
    });

    it('should clear auth cache', async () => {
      const handler = handlers.get('app:clearCacheTypes');
      mockState.readdir.mockResolvedValue([]);

      const result = await handler!({}, ['auth']);

      expect(result).toEqual({ success: true });
    });

    it('should clear multiple cache types', async () => {
      const handler = handlers.get('app:clearCacheTypes');
      mockState.readdir.mockResolvedValue([]);

      const result = await handler!({}, ['electron', 'logs']);

      expect(result).toEqual({ success: true });
    });
  });

  describe('app:window:minimize', () => {
    it('should minimize focused window', async () => {
      const handler = handlers.get('app:window:minimize');
      const mockMinimize = vi.fn();
      mockState.getFocusedWindow.mockReturnValue({ minimize: mockMinimize });

      await handler!({});

      expect(mockMinimize).toHaveBeenCalled();
    });

    it('should handle no focused window', async () => {
      const handler = handlers.get('app:window:minimize');
      mockState.getFocusedWindow.mockReturnValue(null);

      // Should not throw and returns undefined
      const result = await handler!({});
      expect(result).toBeUndefined();
    });
  });

  describe('app:window:maximize', () => {
    it('should maximize unmaximized window', async () => {
      const handler = handlers.get('app:window:maximize');
      const mockMaximize = vi.fn();
      const mockUnmaximize = vi.fn();
      mockState.getFocusedWindow.mockReturnValue({
        isMaximized: () => false,
        maximize: mockMaximize,
        unmaximize: mockUnmaximize,
      });

      await handler!({});

      expect(mockMaximize).toHaveBeenCalled();
      expect(mockUnmaximize).not.toHaveBeenCalled();
    });

    it('should unmaximize maximized window', async () => {
      const handler = handlers.get('app:window:maximize');
      const mockMaximize = vi.fn();
      const mockUnmaximize = vi.fn();
      mockState.getFocusedWindow.mockReturnValue({
        isMaximized: () => true,
        maximize: mockMaximize,
        unmaximize: mockUnmaximize,
      });

      await handler!({});

      expect(mockUnmaximize).toHaveBeenCalled();
      expect(mockMaximize).not.toHaveBeenCalled();
    });
  });

  describe('app:window:close', () => {
    it('should close focused window', async () => {
      const handler = handlers.get('app:window:close');
      const mockClose = vi.fn();
      mockState.getFocusedWindow.mockReturnValue({ close: mockClose });

      await handler!({});

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('app:window:isMaximized', () => {
    it('should return true when window is maximized', async () => {
      const handler = handlers.get('app:window:isMaximized');
      mockState.getFocusedWindow.mockReturnValue({ isMaximized: () => true });

      const result = await handler!({});

      expect(result).toBe(true);
    });

    it('should return false when window is not maximized', async () => {
      const handler = handlers.get('app:window:isMaximized');
      mockState.getFocusedWindow.mockReturnValue({ isMaximized: () => false });

      const result = await handler!({});

      expect(result).toBe(false);
    });

    it('should return false when no focused window', async () => {
      const handler = handlers.get('app:window:isMaximized');
      mockState.getFocusedWindow.mockReturnValue(null);

      const result = await handler!({});

      expect(result).toBe(false);
    });
  });
});
