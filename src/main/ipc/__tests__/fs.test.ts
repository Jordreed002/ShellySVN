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
 * NOTE: Tests that require actual filesystem access or spawn are skipped.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { join, resolve } from 'path';

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
  workerRun: vi.fn().mockResolvedValue({}),
  workerCancel: vi.fn().mockReturnValue(true),
}));

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: mockState.ipcMainHandle,
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readdir: mockState.readdir,
    stat: mockState.stat,
    readFile: mockState.readFile,
    writeFile: mockState.writeFile,
    copyFile: mockState.copyFile,
    mkdir: mockState.mkdir,
  },
  readdir: mockState.readdir,
  stat: mockState.stat,
  readFile: mockState.readFile,
  writeFile: mockState.writeFile,
  copyFile: mockState.copyFile,
  mkdir: mockState.mkdir,
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: mockState.readdir,
    stat: mockState.stat,
    readFile: mockState.readFile,
    writeFile: mockState.writeFile,
    copyFile: mockState.copyFile,
    mkdir: mockState.mkdir,
  },
  readdir: mockState.readdir,
  stat: mockState.stat,
  readFile: mockState.readFile,
  writeFile: mockState.writeFile,
  copyFile: mockState.copyFile,
  mkdir: mockState.mkdir,
}));

// Mock node:fs for sync operations
vi.mock('node:fs', () => ({
  default: {
    existsSync: mockState.existsSync,
    statSync: mockState.statSync,
  },
  existsSync: mockState.existsSync,
  statSync: mockState.statSync,
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockState.existsSync,
    statSync: mockState.statSync,
  },
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

// Mock os module with named export
vi.mock('os', () => ({
  default: { platform: vi.fn(() => 'darwin') },
  platform: vi.fn(() => 'darwin'),
}));

vi.mock('node:os', () => ({
  default: { platform: vi.fn(() => 'darwin') },
  platform: vi.fn(() => 'darwin'),
}));

// Mock debug module
vi.mock('../../utils/debug', () => ({
  default: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../workers/WorkerPool', () => ({
  getSharedWorkerPool: () => ({
    run: mockState.workerRun,
    cancel: mockState.workerCancel,
  }),
}));

// Import after mocking
import { registerFsHandlers, applySvnStatusToFiles } from '../fs';
import {
  approvePathForIpc,
  clearApprovedPathsForTests,
  isPathApprovedForIpc,
} from '../../utils/approved-paths';
import type { FileInfo } from '@shared/types';

describe('FS IPC Handlers', () => {
  // Store registered handlers
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  beforeEach(() => {
    handlers.clear();
    clearApprovedPathsForTests();

    // Reset mock call counts but keep implementations
    mockState.ipcMainHandle.mockClear();
    mockState.readdir.mockClear();
    mockState.stat.mockClear();
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
    mockState.readFile.mockResolvedValue(Buffer.from('test content'));
    mockState.writeFile.mockResolvedValue(undefined);
    mockState.copyFile.mockResolvedValue(undefined);
    mockState.mkdir.mockResolvedValue(undefined);
    mockState.existsSync.mockReturnValue(true);
    mockState.statSync.mockReturnValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    });
    mockState.workerRun.mockResolvedValue({});
    mockState.workerCancel.mockReturnValue(true);

    // Capture registered handlers
    mockState.ipcMainHandle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    );

    // Register handlers
    registerFsHandlers();
  });

  afterEach(() => {
    clearApprovedPathsForTests();
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

    it('should reject parent lookup outside approved roots', async () => {
      const handler = handlers.get('fs:getParent');
      const result = await handler!({}, '/unapproved/project');

      expect(result).toBeNull();
    });

    it('should return parent for approved paths', async () => {
      const rootPath = resolve('/test/path');
      const childPath = join(rootPath, 'child');
      approvePathForIpc(rootPath);

      const handler = handlers.get('fs:getParent');
      const result = await handler!({}, childPath);

      expect(result).toBe(rootPath);
    });

    it('should not return parents outside approved roots', async () => {
      const rootPath = resolve('/test/path');
      approvePathForIpc(rootPath);

      const handler = handlers.get('fs:getParent');
      const result = await handler!({}, rootPath);

      expect(result).toBeNull();
    });
  });

  describe('fs:exists', () => {
    it('should return false for unapproved paths', async () => {
      const handler = handlers.get('fs:exists');
      const result = await handler!({}, '/unapproved/file.txt');

      expect(result).toBe(false);
      expect(mockState.stat).not.toHaveBeenCalled();
    });

    it('should check approved paths', async () => {
      const filePath = resolve('/test/path/file.txt');
      approvePathForIpc(filePath);
      expect(isPathApprovedForIpc(filePath)).toBe(true);

      const handler = handlers.get('fs:exists');
      const result = await handler!({}, filePath);

      expect(result).toBe(true);
      expect(mockState.stat).toHaveBeenCalled();
    });

    it('should return false when path does not exist', async () => {
      approvePathForIpc('/nonexistent');
      mockState.stat.mockRejectedValue(new Error('ENOENT'));

      const handler = handlers.get('fs:exists');
      const result = await handler!({}, '/nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('fs:listDirectory', () => {
    it('should reject directory listing outside approved roots', async () => {
      const handler = handlers.get('fs:listDirectory');
      const result = await handler!({}, '/unapproved');

      expect(result).toEqual([]);
      expect(mockState.readdir).not.toHaveBeenCalled();
    });

    it('should list approved descendant directories', async () => {
      const rootPath = resolve('/test/path');
      const childPath = join(rootPath, 'child');
      approvePathForIpc(rootPath);
      mockState.readdir.mockResolvedValue([
        {
          name: 'nested',
          isDirectory: () => true,
        },
      ]);

      const handler = handlers.get('fs:listDirectory');
      const result = (await handler!({}, childPath)) as FileInfo[];

      expect(mockState.readdir).toHaveBeenCalledWith(childPath, { withFileTypes: true });
      expect(result).toEqual([
        expect.objectContaining({
          name: 'nested',
          isDirectory: true,
        }),
      ]);
    });

    it('should return empty array on error', async () => {
      approvePathForIpc('/protected');
      mockState.readdir.mockRejectedValue(new Error('Permission denied'));

      const handler = handlers.get('fs:listDirectory');
      const result = await handler!({}, '/protected');

      expect(result).toEqual([]);
    });
  });

  describe('fs:getDirectoryMetadata', () => {
    it('should reject metadata lookup outside approved roots', async () => {
      const handler = handlers.get('fs:getDirectoryMetadata');
      const result = (await handler!({}, '/unapproved', false)) as {
        parentPath: string | null;
        isVersioned: boolean;
      };

      expect(result.parentPath).toBeNull();
      expect(result.isVersioned).toBe(false);
      expect(mockState.spawn).not.toHaveBeenCalled();
    });
  });

  describe('fs:readFile - input validation', () => {
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

    it('should reject absolute paths outside approved roots', async () => {
      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, '/etc/passwd')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('only allowed inside a folder selected through ShellySVN');
      expect(mockState.readFile).not.toHaveBeenCalled();
    });

    it('should read an absolute file path inside an approved root', async () => {
      approvePathForIpc('/workspace');
      mockState.readFile.mockResolvedValue('preview content');

      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, '/workspace/readme.txt')) as {
        success: boolean;
        content?: string;
      };

      expect(result).toEqual({ success: true, content: 'preview content' });
      expect(mockState.readFile).toHaveBeenCalledWith('/workspace/readme.txt', 'utf-8');
    });

    it('should reject unapproved Windows absolute, drive-relative, and UNC paths', async () => {
      const handler = handlers.get('fs:readFile');

      for (const path of [
        'C:\\Windows\\win.ini',
        'C:Windows\\win.ini',
        '\\\\server\\share\\file.txt',
      ]) {
        const result = (await handler!({}, path)) as {
          success: boolean;
          error?: string;
        };

        expect(result.success).toBe(false);
        expect(result.error).toContain('only allowed inside a folder selected through ShellySVN');
      }
    });

    it('should reject path traversal in original path', async () => {
      const handler = handlers.get('fs:readFile');
      // This path normalizes to /secrets.txt but contains .. in original
      const result = (await handler!({}, '../../../etc/passwd')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });
  });

  describe('fs:readImageAsBase64 - security validation', () => {
    it('should reject path traversal in image path', async () => {
      const handler = handlers.get('fs:readImageAsBase64');
      const result = (await handler!({}, '../../../etc/passwd.png')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });

    it('should reject absolute paths (security)', async () => {
      const handler = handlers.get('fs:readImageAsBase64');
      const result = (await handler!({}, '/path/to/image.png')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('Absolute');
    });
  });

  describe('fs:copyFile - path validation', () => {
    it('should reject path traversal in source', async () => {
      const handler = handlers.get('fs:copyFile');
      const result = (await handler!({}, '../../../etc/passwd', '/target/file')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });
  });

  describe('fs:writeFile - security validation', () => {
    it('should reject path traversal attempts', async () => {
      const handler = handlers.get('fs:writeFile');
      const result = (await handler!({}, '../../../etc/passwd', 'content')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
    });

    it('should reject writes outside approved roots', async () => {
      const handler = handlers.get('fs:writeFile');
      const result = (await handler!({}, '/tmp/outside.txt', 'content')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('selected through ShellySVN');
      expect(mockState.writeFile).not.toHaveBeenCalled();
    });

    it('should reject Windows writes outside approved roots', async () => {
      approvePathForIpc('C:\\workspace');

      const handler = handlers.get('fs:writeFile');
      const result = (await handler!(
        {},
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
        'content'
      )) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toContain('selected through ShellySVN');
      expect(mockState.writeFile).not.toHaveBeenCalled();
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
      const result = (await handler!({}, 'file.txt', largeContent)) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
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

    it('should reject status lookup outside approved roots', async () => {
      const handler = handlers.get('fs:getStatus');
      const result = (await handler!({}, '/unapproved')) as {
        directStatus: Record<string, unknown>;
        allEntries: unknown[];
      };

      expect(result.directStatus).toEqual({});
      expect(result.allEntries).toEqual([]);
      expect(mockState.spawn).not.toHaveBeenCalled();
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

    it('should reject deep status lookup outside approved roots', async () => {
      const handler = handlers.get('fs:getDeepStatus');
      const result = (await handler!({ sender: { send: vi.fn() } }, '/unapproved')) as {
        directStatus: Record<string, unknown>;
        allEntries: unknown[];
      };

      expect(result.directStatus).toEqual({});
      expect(result.allEntries).toEqual([]);
      expect(mockState.workerRun).not.toHaveBeenCalled();
    });
  });

  describe('fs:isVersioned', () => {
    it('should return false for DRIVES://', async () => {
      const handler = handlers.get('fs:isVersioned');
      const result = await handler!({}, 'DRIVES://');

      expect(result).toBe(false);
    });

    it('should reject version checks outside approved roots', async () => {
      const handler = handlers.get('fs:isVersioned');
      const result = await handler!({}, '/unapproved');

      expect(result).toBe(false);
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
      approvePathForIpc('/test/path');

      const handler = handlers.get('fs:watch');
      const result = (await handler!({ sender: { send: vi.fn() } }, '/test/path')) as {
        success: boolean;
      };

      expect(result.success).toBe(true);
      expect(mockState.chokidarWatch).toHaveBeenCalledWith(
        expect.stringContaining('test'),
        expect.any(Object)
      );
    });

    it('should return success if already watching', async () => {
      approvePathForIpc('/test/path');

      const sender = { send: vi.fn() };
      const handler = handlers.get('fs:watch');

      await handler!({ sender }, '/test/path');
      const result = (await handler!({ sender }, '/test/path')) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('should reject Windows watch paths outside approved roots', async () => {
      approvePathForIpc('C:\\workspace');

      const handler = handlers.get('fs:watch');
      const result = (await handler!({ sender: { send: vi.fn() } }, 'C:\\Windows\\System32')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('selected through ShellySVN');
      expect(mockState.chokidarWatch).not.toHaveBeenCalled();
    });
  });

  describe('fs:unwatch', () => {
    it('should close and remove watcher', async () => {
      approvePathForIpc('/test/path');

      const sender = { send: vi.fn() };
      const watchHandler = handlers.get('fs:watch');
      const unwatchHandler = handlers.get('fs:unwatch');

      await watchHandler!({ sender }, '/test/path');
      const result = (await unwatchHandler!({}, '/test/path')) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('should succeed even if no watcher exists', async () => {
      approvePathForIpc('/nonexistent');

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
      approvePathForIpc('/folder1');
      approvePathForIpc('/folder2');

      mockState.workerRun.mockResolvedValue({
        '/folder1': 100,
        '/folder2': 200,
      });

      const handler = handlers.get('fs:getFolderSizes');
      const result = (await handler!({}, ['/folder1', '/folder2'])) as Record<string, number>;

      expect(result).toEqual({
        '/folder1': 100,
        '/folder2': 200,
      });
      expect(mockState.workerRun).toHaveBeenCalledWith(
        'fs:folderSizes',
        {
          folderPaths: [expect.stringContaining('folder1'), expect.stringContaining('folder2')],
        },
        expect.objectContaining({ priority: 'background' })
      );
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

    const allEntries = [{ status: 'M' as const, fullPath: '/test/folder/modified.txt' }];

    const result = applySvnStatusToFiles(files, directStatus, allEntries);

    // Direct status (D) should be used, not calculated (M)
    expect(result[0].svnStatus?.status).toBe('D');
  });
});
