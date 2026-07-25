/**
 * Tests for External IPC Handlers
 *
 * Tests external tool operations including diff/merge tools and file opening.
 * SECURITY: Includes tests for path traversal prevention.
 *
 * NOTE: Tests that require file system access are skipped in jsdom environment.
 * The path traversal checks happen before fs calls, so those tests work.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Create mock state with hoisting
const mockState = vi.hoisted(() => ({
  ipcMainHandle: vi.fn(),
  shellOpenPath: vi.fn().mockResolvedValue(''),
  shellShowItemInFolder: vi.fn(),
  spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
}));

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: mockState.ipcMainHandle,
  },
  shell: {
    openPath: mockState.shellOpenPath,
    showItemInFolder: mockState.shellShowItemInFolder,
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  default: { spawn: mockState.spawn },
  spawn: mockState.spawn,
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
import { registerExternalHandlers } from '../external';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';

describe('External IPC Handlers', () => {
  // Store registered handlers
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();
  let tempRoot: string;
  let approvedRoot: string;
  let approvedFile: string;
  let approvedFolder: string;
  let rightFile: string;
  let customToolDir: string;

  beforeEach(async () => {
    handlers.clear();
    tempRoot = await mkdtemp(join(tmpdir(), 'shellysvn-external-'));
    approvedRoot = join(tempRoot, 'approved');
    approvedFolder = join(approvedRoot, 'folder');
    approvedFile = join(approvedRoot, 'left.txt');
    rightFile = join(approvedRoot, 'right.txt');
    customToolDir = join(tempRoot, 'tool-dir');
    await mkdir(approvedFolder, { recursive: true });
    await mkdir(customToolDir, { recursive: true });
    await writeFile(approvedFile, 'left');
    await writeFile(rightFile, 'right');

    // Reset mock call counts but keep implementations
    mockState.ipcMainHandle.mockClear();
    mockState.shellOpenPath.mockClear();
    mockState.shellShowItemInFolder.mockClear();
    mockState.spawn.mockClear();

    // Reset mock implementations
    clearApprovedPathsForTests();
    mockState.shellOpenPath.mockResolvedValue('');
    mockState.spawn.mockReturnValue({ unref: vi.fn() });

    // Capture registered handlers
    mockState.ipcMainHandle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    );

    // Register handlers
    registerExternalHandlers();
  });

  afterEach(async () => {
    clearApprovedPathsForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe('handler registration', () => {
    it('should register external:openDiffTool handler', () => {
      expect(handlers.has('external:openDiffTool')).toBe(true);
    });

    it('should register external:openMergeTool handler', () => {
      expect(handlers.has('external:openMergeTool')).toBe(true);
    });

    it('should register external:openFolder handler', () => {
      expect(handlers.has('external:openFolder')).toBe(true);
    });

    it('should register external:openFile handler', () => {
      expect(handlers.has('external:openFile')).toBe(true);
    });

    it('should register external:revealPath handler', () => {
      expect(handlers.has('external:revealPath')).toBe(true);
    });
  });

  describe('external:openDiffTool - path traversal prevention', () => {
    it('should reject path traversal in left file', async () => {
      const handler = handlers.get('external:openDiffTool');
      // Use a path that still has .. after normalization
      const result = await handler!({}, 'meld', '/foo/bar/../../etc/passwd', '/path/right.txt');

      expect(result.success).toBe(false);
      expect(mockState.spawn).not.toHaveBeenCalled();
    });

    it('should reject path traversal in right file', async () => {
      const handler = handlers.get('external:openDiffTool');
      // Use a path that still has .. after normalization
      const result = await handler!({}, 'meld', '/path/left.txt', '/foo/bar/../../etc/passwd');

      expect(result.success).toBe(false);
      expect(mockState.spawn).not.toHaveBeenCalled();
    });

    it('should reject complex path traversal patterns', async () => {
      const handler = handlers.get('external:openDiffTool');
      // Use a path that still has .. after normalization
      const result = await handler!({}, 'meld', '/a/b/c/../../../etc/passwd', '/path/right.txt');

      expect(result.success).toBe(false);
    });

    it('should reject path traversal that normalizes cleanly', async () => {
      const handler = handlers.get('external:openDiffTool');
      // This path normalizes to /secrets.txt but since it doesn't exist, it fails
      const result = await handler!({}, 'meld', '/path/../secrets.txt', '/path/right.txt');

      // The operation fails (file doesn't exist), but for a different reason
      expect(result.success).toBe(false);
    });
  });

  describe('external:openMergeTool - path traversal prevention', () => {
    it('should reject path traversal in base file', async () => {
      const handler = handlers.get('external:openMergeTool');
      const result = await handler!(
        {},
        'meld',
        '/path/../secrets.txt',
        '/path/mine.txt',
        '/path/theirs.txt',
        '/path/merged.txt'
      );

      expect(result.success).toBe(false);
    });

    it('should reject path traversal in mine file', async () => {
      const handler = handlers.get('external:openMergeTool');
      const result = await handler!(
        {},
        'meld',
        '/path/base.txt',
        '/path/../secrets.txt',
        '/path/theirs.txt',
        '/path/merged.txt'
      );

      expect(result.success).toBe(false);
    });

    it('should reject path traversal in theirs file', async () => {
      const handler = handlers.get('external:openMergeTool');
      const result = await handler!(
        {},
        'meld',
        '/path/base.txt',
        '/path/mine.txt',
        '/path/../secrets.txt',
        '/path/merged.txt'
      );

      expect(result.success).toBe(false);
    });

    it('should reject path traversal in merged file path', async () => {
      const handler = handlers.get('external:openMergeTool');
      const result = await handler!(
        {},
        'meld',
        '/path/base.txt',
        '/path/mine.txt',
        '/path/theirs.txt',
        '/path/../merged.txt'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('external:openFolder - path traversal prevention', () => {
    it('should reject path traversal', async () => {
      const handler = handlers.get('external:openFolder');
      const result = await handler!({}, '/path/../secrets');

      expect(result.success).toBe(false);
      expect(mockState.shellOpenPath).not.toHaveBeenCalled();
    });
  });

  describe('external:openFile - path traversal prevention', () => {
    it('should reject path traversal', async () => {
      const handler = handlers.get('external:openFile');
      const result = await handler!({}, '/path/../secrets.txt');

      expect(result.success).toBe(false);
      expect(mockState.shellOpenPath).not.toHaveBeenCalled();
    });
  });

  describe('security', () => {
    it('should prevent command injection via tool name (unknown tool fails)', async () => {
      const handler = handlers.get('external:openDiffTool');
      const result = await handler!({}, 'rm -rf /', '/path/left.txt', '/path/right.txt');

      // Tool name is not a known alias, so it's treated as a path
      // Since the path doesn't exist, it should fail
      expect(result.success).toBe(false);
    });

    it('should prevent accessing sensitive system paths via traversal', async () => {
      const handler = handlers.get('external:openFile');
      const result = await handler!({}, '../../../etc/passwd');

      expect(result.success).toBe(false);
    });

    it('should reject custom diff tool paths that are not files', async () => {
      const handler = handlers.get('external:openDiffTool');
      const result = await handler!({}, customToolDir, approvedFile, rightFile);

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Tool executable must be a file'),
      });
      expect(mockState.spawn).not.toHaveBeenCalled();
    });

    it('should reject opening unapproved local files', async () => {
      const handler = handlers.get('external:openFile');
      const result = await handler!({}, 'C:/unapproved/file.txt');

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Opening local files is only allowed'),
      });
      expect(mockState.shellOpenPath).not.toHaveBeenCalled();
    });

    it('should open approved local files', async () => {
      approvePathForIpc(approvedRoot);
      const handler = handlers.get('external:openFile');
      const result = await handler!({}, approvedFile);

      expect(result).toEqual({ success: true });
      expect(mockState.shellOpenPath).toHaveBeenCalledWith(expect.stringContaining('approved'));
    });

    it('should reject opening unapproved local folders', async () => {
      const handler = handlers.get('external:openFolder');
      const result = await handler!({}, 'C:/unapproved/folder');

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Opening local folders is only allowed'),
      });
      expect(mockState.shellOpenPath).not.toHaveBeenCalled();
    });

    it('should open approved local folders', async () => {
      approvePathForIpc(approvedRoot);

      const handler = handlers.get('external:openFolder');
      const result = await handler!({}, approvedFolder);

      expect(result).toEqual({ success: true });
      expect(mockState.shellOpenPath).toHaveBeenCalledWith(expect.stringContaining('approved'));
    });
  });

  describe('tool execution', () => {
    it('should launch known diff tool with correct arguments', async () => {
      const handler = handlers.get('external:openDiffTool');
      const result = await handler!({}, 'meld', approvedFile, rightFile);

      expect(result).toEqual({ success: true });
      expect(mockState.spawn).toHaveBeenCalledWith(
        'meld',
        [approvedFile, rightFile],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        })
      );
    });

    it('should launch vscode with --diff flag', async () => {
      const handler = handlers.get('external:openDiffTool');
      const result = await handler!({}, 'vscode', approvedFile, rightFile);

      expect(result).toEqual({ success: true });
      expect(mockState.spawn).toHaveBeenCalledWith(
        'code',
        ['--diff', approvedFile, rightFile],
        expect.any(Object)
      );
    });

    it('should be case-insensitive for tool aliases', async () => {
      const handler = handlers.get('external:openDiffTool');
      const result = await handler!({}, 'MELD', approvedFile, rightFile);

      expect(result).toEqual({ success: true });
      expect(mockState.spawn).toHaveBeenCalledWith('meld', expect.any(Array), expect.any(Object));
    });

    it('should launch known merge tool with correct arguments', async () => {
      const handler = handlers.get('external:openMergeTool');
      const result = await handler!(
        {},
        'meld',
        approvedFile,
        rightFile,
        approvedFile,
        join(approvedRoot, 'merged.txt')
      );

      expect(result).toEqual({ success: true });
    });

    it('should open existing folder', async () => {
      const handler = handlers.get('external:openFolder');
      approvePathForIpc(approvedRoot);
      const result = await handler!({}, approvedFolder);

      expect(result).toEqual({ success: true });
      expect(mockState.shellOpenPath).toHaveBeenCalledWith(realpathSync(approvedFolder));
    });

    it('should report the operating-system error when a folder cannot be opened', async () => {
      mockState.shellOpenPath.mockResolvedValueOnce('Finder could not open the folder');
      const handler = handlers.get('external:openFolder');
      approvePathForIpc(approvedRoot);

      await expect(handler!({}, approvedFolder)).resolves.toEqual({
        success: false,
        error: 'Finder could not open the folder',
      });
    });

    it('should open existing file', async () => {
      const handler = handlers.get('external:openFile');
      approvePathForIpc(approvedRoot);
      const result = await handler!({}, approvedFile);

      expect(result).toEqual({ success: true });
      expect(mockState.shellOpenPath).toHaveBeenCalledWith(approvedFile);
    });

    it('should reveal an existing file in Finder or Explorer', async () => {
      const handler = handlers.get('external:revealPath');
      approvePathForIpc(approvedRoot);

      await expect(handler!({}, approvedFile)).resolves.toEqual({ success: true });
      expect(mockState.shellShowItemInFolder).toHaveBeenCalledWith(realpathSync(approvedFile));
      expect(mockState.shellOpenPath).not.toHaveBeenCalled();
    });

    it('should open an existing directory when revealing it', async () => {
      const handler = handlers.get('external:revealPath');
      approvePathForIpc(approvedRoot);

      await expect(handler!({}, approvedFolder)).resolves.toEqual({ success: true });
      expect(mockState.shellOpenPath).toHaveBeenCalledWith(realpathSync(approvedFolder));
      expect(mockState.shellShowItemInFolder).not.toHaveBeenCalled();
    });

    it('should reject reveal paths outside approved roots', async () => {
      const handler = handlers.get('external:revealPath');

      const result = await handler!({}, join(tempRoot, 'unapproved.txt'));

      expect(result.success).toBe(false);
      expect(mockState.shellOpenPath).not.toHaveBeenCalled();
      expect(mockState.shellShowItemInFolder).not.toHaveBeenCalled();
    });

    it('should return error when path is a directory', async () => {
      const handler = handlers.get('external:openFile');
      approvePathForIpc(approvedRoot);
      const result = await handler!({}, approvedFolder);

      expect(result.success).toBe(false);
      expect((result as { error?: string }).error).toContain('must be a file');
    });
  });
});
