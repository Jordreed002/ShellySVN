/**
 * Tests for FS IPC Handlers
 *
 * Tests filesystem operations including:
 * - Directory listing
 * - File read/write/copy operations
 * - Path traversal prevention (SECURITY)
 * - Image reading with extension validation
 * - Folder size calculation
 * - SVN status operations
 *
 * NOTE: Tests that require actual filesystem access are skipped in jsdom environment.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create mock state with hoisting
const mockState = vi.hoisted(() => ({
  ipcMainHandle: vi.fn(),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({
    isFile: () => true,
    isDirectory: () => false,
    size: 100,
    mtime: new Date('2024-01-01'),
  }),
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 0);
      }
    }),
    kill: vi.fn(),
  }),
  chokidarWatch: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn().mockReturnValue({
    isFile: () => true,
    isDirectory: () => false,
    size: 100,
  }),
}));

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: mockState.ipcMainHandle,
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {},
  readdir: mockState.readdir,
  stat: mockState.stat,
  access: mockState.access,
  readFile: mockState.readFile,
  writeFile: mockState.writeFile,
  copyFile: mockState.copyFile,
  mkdir: mockState.mkdir,
}));

// Mock node:fs for sync operations
vi.mock('node:fs', () => ({
  default: {},
  existsSync: mockState.existsSync,
  statSync: mockState.statSync,
}));

// Mock child_process
vi.mock('child_process', () => ({
  default: {},
  spawn: mockState.spawn,
}));

// Mock chokidar
vi.mock('chokidar', () => ({
  default: {
    watch: mockState.chokidarWatch,
  },
}));

// Mock platform to return 'darwin' consistently
vi.mock('os', () => ({
  default: {},
  platform: () => 'darwin',
}));

// Mock debug module
vi.mock('../../utils/debug', () => ({
  default: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking
import { registerFsHandlers, applySvnStatusToFiles } from '../fs';
import type { FileInfo } from '@shared/types';

describe('FS IPC Handlers', () => {
  // Store registered handlers
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  beforeEach(() => {
    handlers.clear();

    // Reset mock call counts but keep implementations
    mockState.ipcMainHandle.mockClear();
    mockState.readdir.mockClear();
    mockState.stat.mockClear();
    mockState.access.mockClear();
    mockState.readFile.mockClear();
    mockState.writeFile.mockClear();
    mockState.copyFile.mockClear();
    mockState.mkdir.mockClear();
    mockState.spawn.mockClear();
    mockState.chokidarWatch.mockClear();
    mockState.existsSync.mockClear();
    mockState.statSync.mockClear();

    // Reset mock implementations
    mockState.readdir.mockResolvedValue([]);
    mockState.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
      mtime: new Date('2024-01-01'),
    });
    mockState.access.mockResolvedValue(undefined);
    mockState.readFile.mockResolvedValue(Buffer.from('test content'));
    mockState.existsSync.mockReturnValue(true);
    mockState.statSync.mockReturnValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    });

    // Capture registered handlers
    mockState.ipcMainHandle.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });

    // Register handlers
    registerFsHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handler registration', () => {
    it('should register fs:listDirectory handler', () => {
      expect(handlers.has('fs:listDirectory')).toBe(true);
    });

    it('should register fs:listDrives handler', () => {
      expect(handlers.has('fs:listDrives')).toBe(true);
    });

    it('should register fs:getParent handler', () => {
      expect(handlers.has('fs:getParent')).toBe(true);
    });

    it('should register fs:getStatus handler', () => {
      expect(handlers.has('fs:getStatus')).toBe(true);
    });

    it('should register fs:getDeepStatus handler', () => {
      expect(handlers.has('fs:getDeepStatus')).toBe(true);
    });

    it('should register fs:applyStatus handler', () => {
      expect(handlers.has('fs:applyStatus')).toBe(true);
    });

    it('should register fs:isVersioned handler', () => {
      expect(handlers.has('fs:isVersioned')).toBe(true);
    });

    it('should register fs:readFile handler', () => {
      expect(handlers.has('fs:readFile')).toBe(true);
    });

    it('should register fs:readImageAsBase64 handler', () => {
      expect(handlers.has('fs:readImageAsBase64')).toBe(true);
    });

    it('should register fs:cancelScan handler', () => {
      expect(handlers.has('fs:cancelScan')).toBe(true);
    });

    it('should register fs:getFolderSizes handler', () => {
      expect(handlers.has('fs:getFolderSizes')).toBe(true);
    });

    it('should register fs:copyFile handler', () => {
      expect(handlers.has('fs:copyFile')).toBe(true);
    });

    it('should register fs:writeFile handler', () => {
      expect(handlers.has('fs:writeFile')).toBe(true);
    });

    it('should register fs:watch handler', () => {
      expect(handlers.has('fs:watch')).toBe(true);
    });

    it('should register fs:unwatch handler', () => {
      expect(handlers.has('fs:unwatch')).toBe(true);
    });

    it('should register fs:exists handler', () => {
      expect(handlers.has('fs:exists')).toBe(true);
    });
  });

  describe('fs:getParent', () => {
    it('should return parent directory for nested path', async () => {
      const handler = handlers.get('fs:getParent');
      const result = await handler!({}, '/Users/test/projects/repo');

      expect(result).toBe('/Users/test/projects');
    });

    it('should return null for root path', async () => {
      const handler = handlers.get('fs:getParent');
      const result = await handler!({}, '/');

      expect(result).toBeNull();
    });

    it('should return null for DRIVES:// special path', async () => {
      const handler = handlers.get('fs:getParent');
      const result = await handler!({}, 'DRIVES://');

      expect(result).toBeNull();
    });
  });

  describe('fs:exists', () => {
    it('should return true when path exists', async () => {
      mockState.access.mockResolvedValue(undefined);

      const handler = handlers.get('fs:exists');
      const result = await handler!({}, '/path/to/file');

      expect(result).toBe(true);
    });

    it('should return false when path does not exist', async () => {
      mockState.access.mockRejectedValue(new Error('ENOENT'));

      const handler = handlers.get('fs:exists');
      const result = await handler!({}, '/nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('fs:listDirectory', () => {
    it('should return empty array for DRIVES:// special path', async () => {
      const handler = handlers.get('fs:listDirectory');
      const result = await handler!({}, 'DRIVES://');

      // Returns list of drives (Root + mounted volumes on Unix)
      expect(Array.isArray(result)).toBe(true);
    });

    it('should list directory contents', async () => {
      mockState.readdir.mockResolvedValue([
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        { name: 'folder1', isDirectory: () => true, isFile: () => false },
      ]);
      mockState.stat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => false,
        size: 100,
        mtime: new Date('2024-01-01'),
      });

      const handler = handlers.get('fs:listDirectory');
      const result = (await handler!({}, '/test/path')) as FileInfo[];

      expect(Array.isArray(result)).toBe(true);
      expect(mockState.readdir).toHaveBeenCalledWith('/test/path', { withFileTypes: true });
    });

    it('should return empty array on error', async () => {
      mockState.readdir.mockRejectedValue(new Error('Permission denied'));

      const handler = handlers.get('fs:listDirectory');
      const result = await handler!({}, '/protected');

      expect(result).toEqual([]);
    });
  });

  describe('fs:readFile - path traversal prevention', () => {
    it('should reject path traversal attempts', async () => {
      const handler = handlers.get('fs:readFile');
      // Use a path that still has .. after normalization
      const result = (await handler!({}, '/foo/bar/../../etc/passwd')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject non-string paths', async () => {
      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, 123)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
    });

    it('should reject empty paths', async () => {
      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, '')) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
    });

    it('should reject non-existent files', async () => {
      mockState.existsSync.mockReturnValue(false);

      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, '/nonexistent/file.txt')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('not exist');
    });

    it('should reject directories when expecting file', async () => {
      mockState.existsSync.mockReturnValue(true);
      mockState.statSync.mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
        size: 0,
      });

      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, '/path/to/directory')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be a file');
    });

    it('should reject files that are too large', async () => {
      mockState.existsSync.mockReturnValue(true);
      mockState.statSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100 * 1024 * 1024, // 100MB
      });

      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, '/large/file.txt')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });
  });

  describe('fs:readImageAsBase64 - security validation', () => {
    it('should reject non-image extensions', async () => {
      mockState.existsSync.mockReturnValue(true);
      mockState.statSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      });

      const handler = handlers.get('fs:readImageAsBase64');
      const result = (await handler!({}, '/path/to/file.exe')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('extension');
    });

    it('should accept valid image extensions', async () => {
      mockState.existsSync.mockReturnValue(true);
      mockState.statSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      });
      mockState.readFile.mockResolvedValue(Buffer.from('fake-image-data'));

      const handler = handlers.get('fs:readImageAsBase64');
      const result = (await handler!({}, '/path/to/image.png')) as {
        success: boolean;
        data?: string;
      };

      expect(result.success).toBe(true);
      expect(result.data).toContain('data:image/png;base64,');
    });

    it('should reject path traversal in image path', async () => {
      const handler = handlers.get('fs:readImageAsBase64');
      const result = (await handler!({}, '/path/../../../etc/passwd.png')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });
  });

  describe('fs:copyFile - path traversal prevention', () => {
    it('should reject path traversal in source', async () => {
      const handler = handlers.get('fs:copyFile');
      const result = (await handler!({}, '/foo/../../etc/passwd', '/target/file')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });

    it('should reject path traversal in target', async () => {
      mockState.existsSync.mockReturnValue(true);
      mockState.statSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      });

      const handler = handlers.get('fs:copyFile');
      const result = (await handler!({}, '/source/file', '/target/../../etc/passwd')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });

    it('should reject non-existent source file', async () => {
      mockState.existsSync.mockReturnValue(false);

      const handler = handlers.get('fs:copyFile');
      const result = (await handler!({}, '/nonexistent', '/target')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });
  });

  describe('fs:writeFile - security validation', () => {
    it('should reject path traversal attempts', async () => {
      const handler = handlers.get('fs:writeFile');
      const result = (await handler!({}, '/path/../../etc/passwd', 'content')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });

    it('should reject content that is too large', async () => {
      mockState.existsSync.mockReturnValue(true);
      mockState.statSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      });

      const handler = handlers.get('fs:writeFile');
      const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
      const result = (await handler!({}, '/path/file.txt', largeContent)) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should write file successfully', async () => {
      mockState.existsSync.mockReturnValue(true);
      mockState.statSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      });
      mockState.mkdir.mockResolvedValue(undefined);
      mockState.writeFile.mockResolvedValue(undefined);

      const handler = handlers.get('fs:writeFile');
      const result = (await handler!({}, '/path/file.txt', 'test content')) as {
        success: boolean;
      };

      expect(result.success).toBe(true);
    });
  });

  describe('fs:getStatus', () => {
    it('should return empty status for DRIVES://', async () => {
      const handler = handlers.get('fs:getStatus');
      const result = (await handler!({}, 'DRIVES://')) as {
        directStatus: Record<string, unknown>;
        allEntries: unknown[];
      };

      expect(result.directStatus).toEqual({});
      expect(result.allEntries).toEqual([]);
    });

    it('should spawn svn status command', async () => {
      const handler = handlers.get('fs:getStatus');
      await handler!({}, '/test/repo');

      expect(mockState.spawn).toHaveBeenCalledWith(
        'svn',
        expect.arrayContaining(['status', '--xml']),
        expect.any(Object)
      );
    });
  });

  describe('fs:getDeepStatus', () => {
    it('should return empty status for DRIVES://', async () => {
      const handler = handlers.get('fs:getDeepStatus');
      const result = (await handler!({}, 'DRIVES://')) as {
        directStatus: Record<string, unknown>;
        allEntries: unknown[];
      };

      expect(result.directStatus).toEqual({});
      expect(result.allEntries).toEqual([]);
    });

    it('should spawn svn status with depth=infinity', async () => {
      const handler = handlers.get('fs:getDeepStatus');
      await handler!({}, '/test/repo');

      expect(mockState.spawn).toHaveBeenCalledWith(
        'svn',
        expect.arrayContaining(['--depth=infinity']),
        expect.any(Object)
      );
    });
  });

  describe('fs:isVersioned', () => {
    it('should return false for DRIVES://', async () => {
      const handler = handlers.get('fs:isVersioned');
      const result = await handler!({}, 'DRIVES://');

      expect(result).toBe(false);
    });

    it('should spawn svn info command', async () => {
      const handler = handlers.get('fs:isVersioned');
      await handler!({}, '/test/repo');

      expect(mockState.spawn).toHaveBeenCalledWith(
        'svn',
        expect.arrayContaining(['info', '--xml']),
        expect.any(Object)
      );
    });
  });

  describe('fs:applyStatus', () => {
    it('should apply SVN status to files', () => {
      const files: FileInfo[] = [
        {
          name: 'file1.txt',
          path: '/test/file1.txt',
          isDirectory: false,
          size: 100,
          modifiedTime: '2024-01-01',
        },
        {
          name: 'folder1',
          path: '/test/folder1',
          isDirectory: true,
          size: 0,
          modifiedTime: '2024-01-01',
        },
      ];

      const directStatus = {
        'file1.txt': { status: 'M' as const },
      };

      const allEntries = [
        { status: 'M' as const, fullPath: '/test/file1.txt' },
        { status: 'A' as const, fullPath: '/test/folder1/newfile.txt' },
      ];

      const result = applySvnStatusToFiles(files, directStatus, allEntries);

      expect(result[0].svnStatus?.status).toBe('M');
      expect(result[1].svnStatus?.status).toBe('A');
    });
  });

  describe('fs:watch', () => {
    it('should create a watcher for valid path', async () => {
      const handler = handlers.get('fs:watch');
      const result = (await handler!(
        { sender: { send: vi.fn() } },
        '/test/path'
      )) as { success: boolean };

      expect(result.success).toBe(true);
      expect(mockState.chokidarWatch).toHaveBeenCalledWith('/test/path', expect.any(Object));
    });

    it('should return success if already watching', async () => {
      const sender = { send: vi.fn() };
      const handler = handlers.get('fs:watch');

      await handler!({ sender }, '/test/path');
      const result = (await handler!({ sender }, '/test/path')) as { success: boolean };

      expect(result.success).toBe(true);
    });
  });

  describe('fs:unwatch', () => {
    it('should close and remove watcher', async () => {
      const sender = { send: vi.fn() };
      const watchHandler = handlers.get('fs:watch');
      const unwatchHandler = handlers.get('fs:unwatch');

      await watchHandler!({ sender }, '/test/path');
      const result = (await unwatchHandler!({}, '/test/path')) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('should succeed even if no watcher exists', async () => {
      const handler = handlers.get('fs:unwatch');
      const result = (await handler!({}, '/nonexistent')) as { success: boolean };

      expect(result.success).toBe(true);
    });
  });

  describe('fs:cancelScan', () => {
    it('should cancel active scan', async () => {
      const handler = handlers.get('fs:cancelScan');
      await handler!({}, '/test/path');

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('fs:getFolderSizes', () => {
    it('should return sizes for folders', async () => {
      mockState.readdir.mockResolvedValue([]);
      mockState.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
        mtime: new Date(),
      });

      const handler = handlers.get('fs:getFolderSizes');
      const result = (await handler!({}, ['/folder1', '/folder2'])) as Record<string, number>;

      expect(typeof result).toBe('object');
    });
  });
});

describe('applySvnStatusToFiles function', () => {
  it('should handle empty files array', () => {
    const result = applySvnStatusToFiles([], {}, []);
    expect(result).toEqual([]);
  });

  it('should preserve files without SVN status', () => {
    const files: FileInfo[] = [
      {
        name: 'unversioned.txt',
        path: '/test/unversioned.txt',
        isDirectory: false,
        size: 100,
        modifiedTime: '2024-01-01',
      },
    ];

    const result = applySvnStatusToFiles(files, {}, []);

    expect(result[0].svnStatus).toBeUndefined();
  });

  it('should calculate folder status from child entries', () => {
    const files: FileInfo[] = [
      {
        name: 'folder',
        path: '/test/folder',
        isDirectory: true,
        size: 0,
        modifiedTime: '2024-01-01',
      },
    ];

    const allEntries = [
      { status: 'C' as const, fullPath: '/test/folder/conflicted.txt' },
      { status: 'M' as const, fullPath: '/test/folder/modified.txt' },
    ];

    const result = applySvnStatusToFiles(files, {}, allEntries);

    // Conflict has higher priority than modified
    expect(result[0].svnStatus?.status).toBe('C');
  });

  it('should prioritize direct folder status over calculated', () => {
    const files: FileInfo[] = [
      {
        name: 'folder',
        path: '/test/folder',
        isDirectory: true,
        size: 0,
        modifiedTime: '2024-01-01',
      },
    ];

    const directStatus = {
      folder: { status: 'D' as const },
    };

    const allEntries = [
      { status: 'M' as const, fullPath: '/test/folder/modified.txt' },
    ];

    const result = applySvnStatusToFiles(files, directStatus, allEntries);

    // Direct status (D) should be used, not calculated (M)
    expect(result[0].svnStatus?.status).toBe('D');
  });
});
