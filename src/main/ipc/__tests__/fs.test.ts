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
import { EventEmitter } from 'node:events';
import os from 'node:os';
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
  chokidarWatch: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn().mockReturnValue({
    isFile: () => true,
    isDirectory: () => false,
    size: 100,
  }),
  // path-guard symlink auditing: identity realpath by default (no symlinks);
  // individual tests override this to simulate symlink redirection.
  realpathSync: (() => {
    const fn = vi.fn((p: string) => p);
    return Object.assign(fn, { native: fn });
  })(),
  lstatSync: vi.fn().mockReturnValue({ isSymbolicLink: () => false }),
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
    realpathSync: mockState.realpathSync,
    lstatSync: mockState.lstatSync,
  },
  existsSync: mockState.existsSync,
  statSync: mockState.statSync,
  realpathSync: mockState.realpathSync,
  lstatSync: mockState.lstatSync,
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockState.existsSync,
    statSync: mockState.statSync,
    realpathSync: mockState.realpathSync,
    lstatSync: mockState.lstatSync,
  },
  existsSync: mockState.existsSync,
  statSync: mockState.statSync,
  realpathSync: mockState.realpathSync,
  lstatSync: mockState.lstatSync,
}));

// Mock child_process — expose spawn both as a named export and on default so
// `import { spawn } from 'child_process'` resolves under CJS/ESM interop.
vi.mock('child_process', () => {
  const mock = { spawn: mockState.spawn };
  return { ...mock, default: mock };
});

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
import {
  registerFsHandlers,
  applySvnStatusToFiles,
  getParentPath,
  closeAllFileWatchers,
  closeFileWatchersForPath,
  FILE_WATCH_EVENT_DEBOUNCE_MS,
  FILE_WATCH_EVENT_MAX_WAIT_MS,
  getActiveFileWatcherPathsForTests,
} from '../fs';
import {
  approvePathForIpc,
  clearApprovedPathsForTests,
  isPathApprovedForIpc,
} from '../../utils/approved-paths';
import type { FileInfo } from '@shared/types';

describe('FS IPC Handlers', () => {
  // Store registered handlers
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();
  // Fresh chokidar watcher mock per fs:watch call, for lifecycle assertions.
  const createdWatchers: Array<{
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];

  beforeEach(() => {
    handlers.clear();
    clearApprovedPathsForTests();
    createdWatchers.length = 0;

    // Reset mock call counts but keep implementations
    mockState.ipcMainHandle.mockClear();
    mockState.readdir.mockClear();
    mockState.stat.mockClear();
    mockState.readFile.mockClear();
    mockState.writeFile.mockClear();
    mockState.copyFile.mockClear();
    mockState.mkdir.mockClear();
    mockState.spawn.mockClear();
    mockState.chokidarWatch.mockReset();
    mockState.existsSync.mockClear();
    mockState.statSync.mockClear();
    mockState.realpathSync.mockClear();
    mockState.lstatSync.mockClear();

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
    // Identity realpath (and realpathSync.native — same function) plus
    // regular-file lstat: the default "no symlinks on disk" world.
    mockState.realpathSync.mockImplementation((p: string) => p);
    mockState.lstatSync.mockReturnValue({ isSymbolicLink: () => false });
    mockState.chokidarWatch.mockImplementation(() => {
      const watcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      createdWatchers.push(watcher);
      return watcher;
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

  afterEach(async () => {
    clearApprovedPathsForTests();
    await closeAllFileWatchers();
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
      await expect(handler!({}, '/unapproved')).rejects.toThrow('selected through ShellySVN');
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
      await expect(handler!({}, '/unapproved', false)).rejects.toThrow(
        'selected through ShellySVN'
      );
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
      // The handler canonicalizes the path via resolve(), which on Windows
      // turns '/workspace/readme.txt' into 'C:\\workspace\\readme.txt'.
      expect(mockState.readFile).toHaveBeenCalledWith(resolve('/workspace/readme.txt'), 'utf-8');
    });

    it('should reject unapproved Windows absolute paths', async () => {
      const handler = handlers.get('fs:readFile');

      const result = (await handler!({}, 'C:\\Windows\\win.ini')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('only allowed inside a folder selected through ShellySVN');
    });

    it('should reject drive-relative paths and UNC paths at sanitization', async () => {
      const handler = handlers.get('fs:readFile');

      // 'C:Windows\\win.ini' is drive-relative; '\\\\server\\share' is UNC.
      // Both are rejected by the path-guard sanitizer before containment runs.
      const driveRelative = (await handler!({}, 'C:Windows\\win.ini')) as {
        success: boolean;
        error?: string;
      };
      expect(driveRelative.success).toBe(false);
      expect(driveRelative.error).toContain('drive-relative paths are not accepted');

      const unc = (await handler!({}, '\\\\server\\share\\file.txt')) as {
        success: boolean;
        error?: string;
      };
      expect(unc.success).toBe(false);
      expect(unc.error).toContain('UNC or Win32 namespace paths are not accepted');
      expect(mockState.readFile).not.toHaveBeenCalled();
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
      expect(result.error).toContain('only allowed inside');
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
      const sender = { id: 1, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() };
      const result = (await handler!({ sender }, '/test/path')) as {
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

      const sender = { id: 2, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() };
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

      const sender = { id: 3, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() };
      const watchHandler = handlers.get('fs:watch');
      const unwatchHandler = handlers.get('fs:unwatch');

      await watchHandler!({ sender }, '/test/path');
      const watcher = createdWatchers[createdWatchers.length - 1];
      const result = (await unwatchHandler!({ sender }, '/test/path')) as { success: boolean };

      expect(result.success).toBe(true);
      expect(watcher.close).toHaveBeenCalledTimes(1);
      expect(getActiveFileWatcherPathsForTests()).toEqual([]);
    });

    it('should succeed even if no watcher exists', async () => {
      approvePathForIpc('/nonexistent');

      const handler = handlers.get('fs:unwatch');
      const sender = { id: 4, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() };
      const result = (await handler!({ sender }, '/nonexistent')) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('should never reject, even for unapproved paths', async () => {
      const handler = handlers.get('fs:unwatch');
      const sender = { id: 5, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() };
      // The renderer fires unwatch without awaiting; a rejection would surface
      // as an unhandled promise rejection.
      await expect(handler!({ sender }, '/unapproved/path')).resolves.toEqual({
        success: true,
      });
    });
  });

  describe('path-guard hardening on fs handlers (Item 7)', () => {
    it('fs:readFile rejects null bytes inside an otherwise approved root', async () => {
      approvePathForIpc('/test');

      const handler = handlers.get('fs:readFile');
      const result = (await handler!({}, '/test/file\0.txt')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('null byte');
      expect(mockState.readFile).not.toHaveBeenCalled();
    });

    it('fs:writeFile rejects null bytes and device names inside an approved root', async () => {
      approvePathForIpc('/test');

      const handler = handlers.get('fs:writeFile');

      const nullByte = (await handler!({}, '/test/file\0.txt', 'data')) as {
        success: boolean;
        error?: string;
      };
      expect(nullByte.success).toBe(false);
      expect(nullByte.error).toContain('null byte');

      const device = (await handler!({}, '/test/con', 'data')) as {
        success: boolean;
        error?: string;
      };
      expect(device.success).toBe(false);
      expect(device.error).toContain('reserved Windows device name');
      expect(mockState.writeFile).not.toHaveBeenCalled();
    });

    it('fs:watch rejects null bytes before creating a watcher', async () => {
      approvePathForIpc('/test/path');

      const handler = handlers.get('fs:watch');
      const sender = { id: 11, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() };
      const result = (await handler!({ sender }, '/test/path\0')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('null byte');
      expect(mockState.chokidarWatch).not.toHaveBeenCalled();
    });

    it('fs:writeFile blocks paths whose realpath escapes the approved root via symlink', async () => {
      approvePathForIpc('/test/path');
      // Simulate `/test/path/escape` being a symlink to /etc on disk.
      mockState.realpathSync.mockImplementation((p: string) =>
        p.startsWith('/test/path/escape') ? p.replace('/test/path/escape', '/etc') : p
      );

      const handler = handlers.get('fs:writeFile');
      const result = (await handler!({}, '/test/path/escape/passwd', 'pwn')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      // Either containment layer may report the escape.
      expect(result.error).toMatch(/selected through ShellySVN|symlinks/);
      expect(mockState.writeFile).not.toHaveBeenCalled();
    });

    it('fs:copyFile guards both ends of the copy against realpath escapes', async () => {
      approvePathForIpc('/test/path');
      mockState.realpathSync.mockImplementation((p: string) =>
        p.startsWith('/test/path/escape') ? p.replace('/test/path/escape', '/etc') : p
      );

      const handler = handlers.get('fs:copyFile');
      const result = (await handler!({}, '/test/path/escape/passwd', '/test/path/copy.txt')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/selected through ShellySVN|symlinks/);
      expect(mockState.copyFile).not.toHaveBeenCalled();
    });
  });

  describe('fs:watch — burst debouncing (Item 26)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function watchAndGetAllHandler(id: number, path = '/test/path') {
      approvePathForIpc(path);
      const sender = {
        id,
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
        once: vi.fn(),
      };
      const handler = handlers.get('fs:watch')!;
      return handler({ sender }, path).then(() => {
        const watcher = createdWatchers[createdWatchers.length - 1];
        const allCall = watcher.on.mock.calls.find(([event]) => event === 'all');
        const onAll = allCall?.[1] as (eventType: string, changedPath: string) => void;
        return { sender, onAll };
      });
    }

    it('coalesces a save-storm into a single trailing change notification', async () => {
      const { sender, onAll } = await watchAndGetAllHandler(20);

      for (let index = 0; index < 25; index++) {
        onAll('change', `/test/path/file-${index}.ts`);
      }

      await vi.advanceTimersByTimeAsync(FILE_WATCH_EVENT_DEBOUNCE_MS - 10);
      expect(sender.send).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(FILE_WATCH_EVENT_DEBOUNCE_MS + 10);
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledWith('fs:watch:change', {
        path: '/test/path',
        eventType: 'change',
        changedPath: '/test/path/file-24.ts',
      });
    });

    it('flushes at the max-wait cap during a sustained burst', async () => {
      const { sender, onAll } = await watchAndGetAllHandler(21);

      onAll('change', '/test/path/first.ts');
      // Keep resetting the trailing edge; the max-wait cap must still fire.
      for (let step = 0; step < 7; step++) {
        await vi.advanceTimersByTimeAsync(250);
        onAll('change', `/test/path/burst-${step}.ts`);
      }

      // Virtual time is now 1750ms; the max-wait timer (armed at t=0) fires
      // at 2000ms while the trailing edge keeps being pushed past it.
      await vi.advanceTimersByTimeAsync(249);
      expect(sender.send).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledWith(
        'fs:watch:change',
        expect.objectContaining({ changedPath: '/test/path/burst-6.ts' })
      );

      await vi.advanceTimersByTimeAsync(FILE_WATCH_EVENT_MAX_WAIT_MS * 2);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('honors watchSvnOnly filtering before queueing notifications', async () => {
      approvePathForIpc('/test/path');
      const sender = { id: 22, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() };
      await (handlers.get('fs:watch') as (...args: unknown[]) => unknown)(
        { sender },
        '/test/path',
        { watchSvnOnly: true }
      );
      const watcher = createdWatchers[createdWatchers.length - 1];
      const onAll = watcher.on.mock.calls.find(([event]) => event === 'all')?.[1] as (
        eventType: string,
        changedPath: string
      ) => void;

      onAll('change', '/test/path/regular-file.ts');
      await vi.advanceTimersByTimeAsync(FILE_WATCH_EVENT_DEBOUNCE_MS + 100);
      expect(sender.send).not.toHaveBeenCalled();

      onAll('change', '/test/path/.svn/wc.db');
      await vi.advanceTimersByTimeAsync(FILE_WATCH_EVENT_DEBOUNCE_MS + 100);
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledWith(
        'fs:watch:change',
        expect.objectContaining({ changedPath: '/test/path/.svn/wc.db' })
      );
    });

    it('drops pending burst events when the watcher is unwatched', async () => {
      const { sender, onAll } = await watchAndGetAllHandler(23);

      onAll('change', '/test/path/pending.ts');
      await (handlers.get('fs:unwatch') as (...args: unknown[]) => unknown)(
        { sender: { id: 23, send: vi.fn(), isDestroyed: vi.fn(() => false), once: vi.fn() } },
        '/test/path'
      );

      await vi.advanceTimersByTimeAsync(FILE_WATCH_EVENT_MAX_WAIT_MS * 2);
      expect(sender.send).not.toHaveBeenCalled();
    });
  });

  describe('fs:watch — lifecycle (Item 26)', () => {
    function makeSender(id: number) {
      return {
        id,
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
        once: vi.fn(),
      };
    }

    it('closes watchers when the owning webContents is destroyed', async () => {
      approvePathForIpc('/test/path');
      const sender = makeSender(30);

      await (handlers.get('fs:watch') as (...args: unknown[]) => unknown)(
        { sender },
        '/test/path'
      );
      const watcher = createdWatchers[createdWatchers.length - 1];
      expect(getActiveFileWatcherPathsForTests()).toHaveLength(1);

      const destroyedCall = sender.once.mock.calls.find(([event]) => event === 'destroyed');
      const onDestroyed = destroyedCall?.[1] as () => void;
      onDestroyed();
      // closeWatchersOwnedBy awaits watcher.close() before removing the entry.
      await vi.waitFor(() => expect(getActiveFileWatcherPathsForTests()).toEqual([]));

      expect(watcher.close).toHaveBeenCalledTimes(1);
    });

    it('closes watchers on and under a removed working-copy path, leaving others running', async () => {
      approvePathForIpc('/test/wc');
      approvePathForIpc('/other');

      await (handlers.get('fs:watch') as (...args: unknown[]) => unknown)(
        { sender: makeSender(31) },
        '/test/wc'
      );
      await (handlers.get('fs:watch') as (...args: unknown[]) => unknown)(
        { sender: makeSender(32) },
        '/test/wc/sub'
      );
      await (handlers.get('fs:watch') as (...args: unknown[]) => unknown)(
        { sender: makeSender(33) },
        '/other'
      );

      const [wcWatcher, subWatcher, otherWatcher] = createdWatchers;
      await closeFileWatchersForPath('/test/wc');

      expect(wcWatcher.close).toHaveBeenCalledTimes(1);
      expect(subWatcher.close).toHaveBeenCalledTimes(1);
      expect(otherWatcher.close).not.toHaveBeenCalled();
      expect(getActiveFileWatcherPathsForTests()).toEqual(['/other']);
    });

    it('allows re-watching a path after its working copy was removed', async () => {
      approvePathForIpc('/test/wc');
      const sender = makeSender(34);

      await (handlers.get('fs:watch') as (...args: unknown[]) => unknown)(
        { sender },
        '/test/wc'
      );
      await closeFileWatchersForPath('/test/wc');

      await (handlers.get('fs:watch') as (...args: unknown[]) => unknown)(
        { sender },
        '/test/wc'
      );
      expect(createdWatchers).toHaveLength(2);
      expect(getActiveFileWatcherPathsForTests()).toHaveLength(1);
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

  /*
   * listDrives on Windows spawns `wmic logicaldisk get caption,volumename` and
   * parses the tabular stdout into drive entries. The os.platform mock (default
   * 'darwin') is flipped to 'win32' and spawn emits canned wmic output, so the
   * Windows parsing branch runs deterministically on any host.
   */
  describe('listDrives — Windows wmic enumeration', () => {
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue('win32');
    });

    afterEach(() => {
      vi.mocked(os.platform).mockReturnValue('darwin');
    });

    function wmicChild(output: string): EventEmitter {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      // Emit after the parser attaches its stdout/close listeners.
      queueMicrotask(() => {
        proc.stdout.emit('data', Buffer.from(output));
        proc.emit('close', 0);
      });
      return proc;
    }

    it('parses wmic output into named drive entries with trailing separators', async () => {
      mockState.spawn.mockReturnValue(
        wmicChild('Caption  VolumeName\nC:       Local Disk\nD:       Data\n')
      );

      const result = (await handlers.get('fs:listDrives')!({})) as Array<{
        name: string;
        path: string;
        isDirectory: boolean;
      }>;

      expect(mockState.spawn).toHaveBeenCalledWith(
        'wmic',
        ['logicaldisk', 'get', 'caption,volumename'],
        { windowsHide: true }
      );
      expect(result).toEqual([
        expect.objectContaining({ name: 'Local Disk (C:)', path: 'C:\\', isDirectory: true }),
        expect.objectContaining({ name: 'Data (D:)', path: 'D:\\', isDirectory: true }),
      ]);
    });

    it('falls back to "Local Disk" when the volume name is blank', async () => {
      mockState.spawn.mockReturnValue(wmicChild('Caption  VolumeName\nE:\n'));

      const result = (await handlers.get('fs:listDrives')!({})) as Array<{ name: string }>;

      expect(result).toEqual([expect.objectContaining({ name: 'Local Disk (E:)' })]);
    });

    it('resolves to an empty list when wmic fails to spawn', async () => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      mockState.spawn.mockReturnValue(proc);
      queueMicrotask(() => proc.emit('error', new Error('ENOENT')));

      await expect(handlers.get('fs:listDrives')!({})).resolves.toEqual([]);
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

/*
 * getParentPath drives the "up" navigation in the file explorer. It reads
 * os.platform() and uses the host's path module, so its Windows drive-root
 * behaviour is exercised on a real Windows host (skipped elsewhere). The
 * notable Windows branch: the parent of a drive-relative path is the virtual
 * DRIVES:// root that lists all drives.
 */
describe.skipIf(process.platform !== 'win32')('getParentPath — Windows drive navigation', () => {
  // The file-wide os mock defaults platform() to 'darwin'; flip it to win32 so
  // getParentPath's drive-root branch is exercised. The host's real win32 path
  // module supplies normalize()/dirname() behavior.
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('win32');
  });

  afterEach(() => {
    vi.mocked(os.platform).mockReturnValue('darwin');
  });

  it('returns the containing directory for an absolute Windows subpath', () => {
    expect(getParentPath('C:\\Users')).toBe('C:\\');
    expect(getParentPath('C:\\Users\\test\\repo')).toBe('C:\\Users\\test');
  });

  it('returns null at a drive root (no further parent)', () => {
    expect(getParentPath('C:\\')).toBeNull();
  });

  it('returns null for the virtual drive list itself', () => {
    expect(getParentPath('DRIVES://')).toBeNull();
  });

  it('yields DRIVES:// as the parent of a drive-relative path', () => {
    // Drive-relative paths (C:foo) are anchored to the drive's current dir;
    // walking above them lands at the virtual drive list.
    expect(getParentPath('C:foo')).toBe('DRIVES://');
  });
});
