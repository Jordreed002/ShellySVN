import { ipcMain } from 'electron';
import {
  readdir,
  stat,
  copyFile as fsCopyFile,
  writeFile as fsWriteFile,
  mkdir,
  readFile,
  access,
} from 'fs/promises';
import chokidar from 'chokidar';
import { join, basename, normalize, dirname, isAbsolute } from 'path';
import { spawn } from 'child_process';
import { platform } from 'os';
import type { FileInfo, SvnStatusChar } from '@shared/types';
import { MAX_FILE_PREVIEW_SIZE_BYTES, MAX_FILE_WRITE_SIZE_BYTES } from '@shared/constants';
import { validatePath, InputValidationError } from '../utils/validation';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { parseSvnStatusEntriesXml } from '../utils/svn-xml';
import { runSvnText } from '../services/svn-executor';

interface SvnStatusEntry {
  status: SvnStatusChar;
  revision?: number;
  author?: string;
  fullPath: string;
}

export interface SvnStatusMap {
  [filename: string]: {
    status: SvnStatusChar;
    revision?: number;
    author?: string;
  };
}

// Map SVN XML item attribute values to single-char status codes
const SVN_STATUS_MAP: Record<string, SvnStatusChar> = {
  normal: ' ',
  added: 'A',
  conflicted: 'C',
  deleted: 'D',
  ignored: 'I',
  modified: 'M',
  replaced: 'R',
  external: 'X',
  unversioned: '?',
  missing: '!',
  obstructed: '~',
  incomplete: '!',
};

// Status priority (higher = more important to show)
const STATUS_PRIORITY: Record<SvnStatusChar, number> = {
  C: 100,
  '!': 90,
  '~': 85,
  M: 80,
  D: 70,
  R: 60,
  A: 50,
  X: 40,
  '?': 30,
  I: 20,
  O: 10,
  ' ': 0,
};

function getWorstStatus(a: SvnStatusChar, b: SvnStatusChar): SvnStatusChar {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b;
}

/**
 * Parse SVN status XML output into status map and entries
 */
function parseSvnStatusXml(
  xml: string,
  baseDir: string
): {
  directStatus: SvnStatusMap;
  allEntries: SvnStatusEntry[];
} {
  const directStatus: SvnStatusMap = {};
  const allEntries: SvnStatusEntry[] = [];

  for (const entry of parseSvnStatusEntriesXml(xml)) {
    const entryPath = entry.path;
    const statusName = entry.item;
    const status = SVN_STATUS_MAP[statusName] || ' ';
    const fullPath = normalize(isAbsolute(entryPath) ? entryPath : join(baseDir, entryPath));
    const fileName = basename(fullPath);

    allEntries.push({
      status,
      revision: entry.revision,
      author: entry.author,
      fullPath,
    });

    // Direct entries (immediate children)
    const entryParent = normalize(dirname(fullPath));
    if (entryParent === normalize(baseDir)) {
      directStatus[fileName] = {
        status,
        revision: entry.revision,
        author: entry.author,
      };
    }
  }

  return { directStatus, allEntries };
}

/**
 * Get SVN status with configurable depth
 */
async function getSvnStatus(
  dirPath: string,
  depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'immediates'
): Promise<{ directStatus: SvnStatusMap; allEntries: SvnStatusEntry[] }> {
  try {
    const stdout = await runSvnText(['status', '--xml', `--depth=${depth}`, dirPath], {
      cwd: dirPath,
    });
    return parseSvnStatusXml(stdout, dirPath);
  } catch {
    return { directStatus: {}, allEntries: [] };
  }
}

/**
 * Calculate folder status based on child entries
 */
function calculateFolderStatus(
  folderPath: string,
  folderName: string,
  allEntries: SvnStatusEntry[],
  directStatus: SvnStatusMap
): SvnStatusChar {
  if (directStatus[folderName]?.status && directStatus[folderName].status !== ' ') {
    return directStatus[folderName].status;
  }

  const normalizedFolderPath = normalize(folderPath);
  let worstStatus: SvnStatusChar = ' ';

  for (const entry of allEntries) {
    const normalizedEntryPath = normalize(entry.fullPath);
    if (
      normalizedEntryPath.startsWith(normalizedFolderPath + '\\') ||
      normalizedEntryPath.startsWith(normalizedFolderPath + '/')
    ) {
      worstStatus = getWorstStatus(worstStatus, entry.status);
    }
  }

  return worstStatus;
}

/**
 * Check if a directory is under version control
 */
async function isVersioned(dirPath: string): Promise<boolean> {
  try {
    await runSvnText(['info', '--xml', dirPath], { cwd: dirPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * List directory contents from filesystem only (instant)
 */
async function listDirectoryFiles(dirPath: string): Promise<FileInfo[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files: FileInfo[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = join(dirPath, entry.name);

      try {
        const stats = await stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : stats.size,
          modifiedTime: stats.mtime.toISOString(),
          svnStatus: undefined,
        });
      } catch {
        continue;
      }
    }

    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return files;
  } catch {
    return [];
  }
}

/**
 * Apply SVN status to file list
 */
export function applySvnStatusToFiles(
  files: FileInfo[],
  directStatus: SvnStatusMap,
  allEntries: SvnStatusEntry[]
): FileInfo[] {
  return files.map((file) => {
    let svnStatus: FileInfo['svnStatus'];

    if (file.isDirectory) {
      const folderStatus = calculateFolderStatus(file.path, file.name, allEntries, directStatus);
      if (folderStatus !== ' ') {
        svnStatus = { path: file.path, status: folderStatus, isDirectory: true };
      }
    } else {
      const direct = directStatus[file.name];
      if (direct) {
        svnStatus = {
          path: file.path,
          status: direct.status,
          revision: direct.revision,
          author: direct.author,
          isDirectory: false,
        };
      }
    }

    return { ...file, svnStatus };
  });
}

export const MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY = 2;

const EMPTY_STATUS_RESULT = { directStatus: {}, allEntries: [] };

// Track active background scans
const activeScans = new Map<string, AbortController>();
let activeScanCount = 0;

interface QueuedDeepScan {
  dirPath: string;
  controller: AbortController;
  resolve: (result: { directStatus: SvnStatusMap; allEntries: SvnStatusEntry[] }) => void;
}

const queuedScans: QueuedDeepScan[] = [];

// Track active file watchers
const activeWatchers = new Map<string, chokidar.FSWatcher>();

function cancelDeepScan(dirPath: string) {
  const controller = activeScans.get(dirPath);
  if (controller) {
    controller.abort();
    activeScans.delete(dirPath);
  }

  for (let index = queuedScans.length - 1; index >= 0; index--) {
    const queued = queuedScans[index];
    if (queued.dirPath === dirPath) {
      queuedScans.splice(index, 1);
      queued.resolve(EMPTY_STATUS_RESULT);
    }
  }
}

function startQueuedScans() {
  while (activeScanCount < MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY && queuedScans.length > 0) {
    const queued = queuedScans.shift()!;

    if (queued.controller.signal.aborted) {
      queued.resolve(EMPTY_STATUS_RESULT);
      continue;
    }

    activeScanCount++;
    void runDeepScan(queued);
  }
}

async function runDeepScan(queued: QueuedDeepScan) {
  try {
    const stdout = await runSvnText(['status', '--xml', '--depth=infinity', queued.dirPath], {
      cwd: queued.dirPath,
      signal: queued.controller.signal,
    });
    queued.resolve(parseSvnStatusXml(stdout, queued.dirPath));
  } catch {
    queued.resolve(EMPTY_STATUS_RESULT);
  } finally {
    activeScanCount = Math.max(0, activeScanCount - 1);
    if (activeScans.get(queued.dirPath) === queued.controller) {
      activeScans.delete(queued.dirPath);
    }
    startQueuedScans();
  }
}

/**
 * Background deep scan for folder aggregation
 */
export async function startDeepScan(dirPath: string): Promise<{
  directStatus: SvnStatusMap;
  allEntries: SvnStatusEntry[];
}> {
  cancelDeepScan(dirPath);

  const controller = new AbortController();
  activeScans.set(dirPath, controller);

  const result = new Promise<{ directStatus: SvnStatusMap; allEntries: SvnStatusEntry[] }>(
    (resolve) => {
      queuedScans.push({ dirPath, controller, resolve });
      startQueuedScans();
    }
  );

  return result;
}

export function getBackgroundStatusScanStateForTests() {
  return {
    activeScanCount,
    queuedScanCount: queuedScans.length,
    activePaths: Array.from(activeScans.keys()),
  };
}

/**
 * List available drives (Windows) or root mount points (Unix)
 */
async function listDrives(): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  if (platform() === 'win32') {
    // Windows: Use wmic to get drive letters
    return new Promise((resolve) => {
      const proc = spawn('wmic', ['logicaldisk', 'get', 'caption,volumename']);
      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      proc.on('close', () => {
        const lines = stdout.split('\n').slice(1); // Skip header
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const match = trimmed.match(/^([A-Z]:)\s*(.*)/);
          if (match) {
            const driveLetter = match[1];
            const volumeName = match[2].trim() || 'Local Disk';

            files.push({
              name: `${volumeName} (${driveLetter})`,
              path: driveLetter + '\\',
              isDirectory: true,
              size: 0,
              modifiedTime: new Date().toISOString(),
              svnStatus: undefined,
            });
          }
        }
        resolve(files);
      });
      proc.on('error', () => resolve([]));
    });
  } else {
    // Unix: List /Volumes (macOS) or /mnt (Linux)
    const mountPoints = ['/Volumes', '/mnt', '/media'];

    for (const mountPoint of mountPoints) {
      try {
        await access(mountPoint);
        const entries = await readdir(mountPoint, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            files.push({
              name: entry.name,
              path: join(mountPoint, entry.name),
              isDirectory: true,
              size: 0,
              modifiedTime: new Date().toISOString(),
              svnStatus: undefined,
            });
          }
        }
      } catch {
        /* skip inaccessible mount points */
      }
    }

    // Always add root
    files.unshift({
      name: 'Root',
      path: '/',
      isDirectory: true,
      size: 0,
      modifiedTime: new Date().toISOString(),
      svnStatus: undefined,
    });
  }

  return files;
}

/**
 * Get parent directory path
 */
function getParentPath(path: string): string | null {
  if (path === '/' || path === 'DRIVES://') return null;

  const normalized = normalize(path);
  const parent = dirname(normalized);

  // On Windows, if we're at the root of a drive (e.g., C:\), return DRIVES://
  if (platform() === 'win32' && parent.length === 2 && parent[1] === ':') {
    return 'DRIVES://';
  }

  // If same as input (we were at root), return null
  if (parent === normalized) return null;

  return parent;
}

/**
 * Calculate folder size recursively
 */
async function calculateFolderSize(folderPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await readdir(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and common exclude patterns
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.svn') continue;

      const fullPath = join(folderPath, entry.name);

      try {
        if (entry.isDirectory()) {
          totalSize += await calculateFolderSize(fullPath);
        } else if (entry.isFile()) {
          const stats = await stat(fullPath);
          totalSize += stats.size;
        }
      } catch {
        // Skip files/folders we can't access
        continue;
      }
    }
  } catch {
    // Can't read directory
    return 0;
  }

  return totalSize;
}

/**
 * Calculate sizes for multiple folders
 */
async function calculateFolderSizes(folderPaths: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  for (const folderPath of folderPaths) {
    const approvedPath = assertPathApprovedForIpc(folderPath, 'Folder size calculation');
    results[folderPath] = await calculateFolderSize(approvedPath);
  }

  return results;
}

export function registerFsHandlers(): void {
  // Fast directory listing (filesystem only, no SVN)
  ipcMain.handle('fs:listDirectory', async (_, path: string): Promise<FileInfo[]> => {
    try {
      // Handle special DRIVES:// path for listing drives
      if (path === 'DRIVES://') {
        return listDrives();
      }
      return listDirectoryFiles(path);
    } catch (error) {
      console.error('[FS] List error:', error);
      return [];
    }
  });

  // List available drives
  ipcMain.handle('fs:listDrives', async (): Promise<FileInfo[]> => {
    try {
      return listDrives();
    } catch (error) {
      console.error('[FS] List drives error:', error);
      return [];
    }
  });

  // Get parent directory
  ipcMain.handle('fs:getParent', async (_, path: string): Promise<string | null> => {
    return getParentPath(path);
  });

  // Shallow SVN status (fast, --depth=immediates)
  ipcMain.handle('fs:getStatus', async (_, path: string) => {
    try {
      // Don't get SVN status for drives list
      if (path === 'DRIVES://') {
        return { directStatus: {}, allEntries: [] };
      }
      return getSvnStatus(path, 'immediates');
    } catch (error) {
      console.error('[FS] Status error:', error);
      return { directStatus: {}, allEntries: [] };
    }
  });

  // Deep SVN status (slower, --depth=infinity) for folder aggregation
  ipcMain.handle('fs:getDeepStatus', async (_, path: string) => {
    try {
      // Don't get SVN status for drives list
      if (path === 'DRIVES://') {
        return { directStatus: {}, allEntries: [] };
      }
      return startDeepScan(path);
    } catch (error) {
      console.error('[FS] Deep status error:', error);
      return { directStatus: {}, allEntries: [] };
    }
  });

  // Apply status to files (helper for renderer)
  ipcMain.handle(
    'fs:applyStatus',
    async (_, files: FileInfo[], directStatus: SvnStatusMap, allEntries: SvnStatusEntry[]) => {
      return applySvnStatusToFiles(files, directStatus, allEntries);
    }
  );

  // Check if versioned
  ipcMain.handle('fs:isVersioned', async (_, path: string): Promise<boolean> => {
    // Drives list is never versioned
    if (path === 'DRIVES://') return false;
    return isVersioned(path);
  });

  // Read file content
  ipcMain.handle(
    'fs:readFile',
    async (_, path: string): Promise<{ success: boolean; content?: string; error?: string }> => {
      try {
        // SECURITY: Validate path input
        const validatedPath = validatePath(path, {
          mustExist: true,
          mustBeFile: true,
          maxSize: MAX_FILE_PREVIEW_SIZE_BYTES,
        });

        // PERFORMANCE: Use async file operations to avoid blocking
        const { stat, readFile } = await import('fs/promises');
        const stats = await stat(validatedPath);

        // Limit file size for preview
        if (stats.size > MAX_FILE_PREVIEW_SIZE_BYTES) {
          return { success: false, error: `File too large for preview (>${MAX_FILE_PREVIEW_SIZE_BYTES / 1024 / 1024}MB)` };
        }

        const content = await readFile(validatedPath, 'utf-8');
        return { success: true, content };
      } catch (err) {
        if (err instanceof InputValidationError) {
          return { success: false, error: `Validation error: ${err.message}` };
        }
        return { success: false, error: (err as Error).message };
      }
    }
  );

  // Read image file as base64 for thumbnails
  ipcMain.handle(
    'fs:readImageAsBase64',
    async (_, filePath: string): Promise<{ success: boolean; data?: string; error?: string }> => {
      try {
        // SECURITY: Validate path and allowed extensions
        const validatedPath = validatePath(filePath, {
          mustExist: true,
          mustBeFile: true,
          allowedExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'],
          maxSize: MAX_FILE_WRITE_SIZE_BYTES,
        });

        const buffer = await readFile(validatedPath);
        const base64 = buffer.toString('base64');
        // Detect mime type from extension
        const ext = validatedPath.split('.').pop()?.toLowerCase() || '';
        const mimeTypes: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          ico: 'image/x-icon',
          bmp: 'image/bmp',
        };
        const mimeType = mimeTypes[ext] || 'image/png';
        return { success: true, data: `data:${mimeType};base64,${base64}` };
      } catch (error) {
        if (error instanceof InputValidationError) {
          return { success: false, error: `Validation error: ${error.message}` };
        }
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Cancel active scan
  ipcMain.handle('fs:cancelScan', async (_, path: string) => {
    cancelDeepScan(path);
  });

  // Calculate folder sizes (can be slow for large directories)
  ipcMain.handle(
    'fs:getFolderSizes',
    async (_, folderPaths: string[]): Promise<Record<string, number>> => {
      try {
        return calculateFolderSizes(folderPaths);
      } catch (error) {
        console.error('[FS] Folder size error:', error);
        return {};
      }
    }
  );

  // Copy file (for non-versioned files)
  ipcMain.handle(
    'fs:copyFile',
    async (_, source: string, target: string): Promise<{ success: boolean; error?: string }> => {
      try {
        // SECURITY: Validate both paths
        const validatedSource = validatePath(source, {
          mustExist: true,
          mustBeFile: true,
          allowAbsolute: true,
        });
        const validatedTarget = validatePath(target, { allowAbsolute: true });
        const approvedSource = assertPathApprovedForIpc(validatedSource, 'File copy source');
        const approvedTarget = assertPathApprovedForIpc(validatedTarget, 'File copy target');

        // Ensure target directory exists (mkdir with recursive won't throw if exists)
        const targetDir = dirname(approvedTarget);
        await mkdir(targetDir, { recursive: true });

        await fsCopyFile(approvedSource, approvedTarget);
        return { success: true };
      } catch (err) {
        if (err instanceof InputValidationError) {
          return { success: false, error: `Validation error: ${err.message}` };
        }
        console.error('[FS] Copy file error:', err);
        return { success: false, error: (err as Error).message };
      }
    }
  );

  // Write file (for plugins)
  ipcMain.handle(
    'fs:writeFile',
    async (_, path: string, content: string): Promise<{ success: boolean; error?: string }> => {
      try {
        // SECURITY: Validate path (allow absolute for plugin files)
        // Validate content size (limit to 10MB for safety)
        if (content.length > 10 * 1024 * 1024) {
          return { success: false, error: 'Content too large (max 10MB)' };
        }

        const validatedPath = validatePath(path, { allowAbsolute: true });
        const approvedPath = assertPathApprovedForIpc(validatedPath, 'File write');

        // Ensure directory exists
        const dir = dirname(approvedPath);
        await mkdir(dir, { recursive: true });

        await fsWriteFile(approvedPath, content, 'utf-8');
        return { success: true };
      } catch (err) {
        if (err instanceof InputValidationError) {
          return { success: false, error: `Validation error: ${err.message}` };
        }
        console.error('[FS] Write file error:', err);
        return { success: false, error: (err as Error).message };
      }
    }
  );

  // File System Watching
  ipcMain.handle(
    'fs:watch',
    async (
      event,
      path: string,
      options?: {
        watchSvnOnly?: boolean;
      }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const approvedPath = assertPathApprovedForIpc(path, 'File watching');

        if (activeWatchers.has(approvedPath)) {
          return { success: true };
        }

        const watchSvnOnly = options?.watchSvnOnly ?? false;

        const watcher = chokidar.watch(approvedPath, {
          ignored: [
            /(^|[/\\])\../, // hidden files
            /node_modules/,
          ],
          ignoreInitial: true,
          awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100,
          },
          depth: watchSvnOnly ? 0 : undefined,
        });

        watcher.on('all', (eventType, changedPath) => {
          if (watchSvnOnly && !changedPath.includes('.svn')) {
            return;
          }

          event.sender.send('fs:watch:change', {
            path,
            eventType,
            changedPath,
          });
        });

        watcher.on('error', (error) => {
          console.error('[FS] Watcher error:', error);
        });

        activeWatchers.set(approvedPath, watcher);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('fs:unwatch', async (_, path: string): Promise<{ success: boolean }> => {
    const approvedPath = assertPathApprovedForIpc(path, 'File watching');
    const watcher = activeWatchers.get(approvedPath);
    if (watcher) {
      await watcher.close();
      activeWatchers.delete(approvedPath);
    }
    return { success: true };
  });

  ipcMain.handle('fs:exists', async (_, path: string): Promise<boolean> => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  });
}
