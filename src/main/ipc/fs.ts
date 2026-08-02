import { ipcMain, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import chokidar from 'chokidar';
import { join, normalize, dirname } from 'path';
import { spawn } from 'child_process';
import os from 'node:os';
import type {
  DeepStatusProgress,
  DirectoryMetadataResult,
  FileInfo,
  SvnStatusChar,
} from '@shared/types';
import { MAX_FILE_PREVIEW_SIZE_BYTES, MAX_FILE_WRITE_SIZE_BYTES } from '@shared/constants';
import { validatePath, InputValidationError } from '../utils/validation';
import { assertPathApprovedForIpc, isPathApprovedForIpc } from '../utils/approved-paths';
import { resolveSvnExecution, runSvnText } from '../services/svn-executor';
import { getWorkerFsStatus } from '../services/svn-status-worker';
import {
  classifyWorkingCopyUpgradeError,
  getInfo,
  getWorkingCopyContext,
} from '../services/svn-working-copy';
import { getStatusService } from '../services/status-service';
import { getSharedWorkerPool } from '../workers/WorkerPool';
import { sendToRenderer } from '../utils/safe-renderer-send';

const { readdir, stat, copyFile: fsCopyFile, writeFile: fsWriteFile, mkdir, readFile } = fs;

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
 * Get SVN status with configurable depth
 */
async function getSvnStatus(
  dirPath: string,
  depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'immediates'
): Promise<{ directStatus: SvnStatusMap; allEntries: SvnStatusEntry[] }> {
  try {
    return getWorkerFsStatus(dirPath, depth);
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
    const visibleEntries = entries.filter((entry) => !entry.name.startsWith('.'));
    const metadataConcurrency = 32;
    const files: FileInfo[] = [];

    for (let index = 0; index < visibleEntries.length; index += metadataConcurrency) {
      const batch = visibleEntries.slice(index, index + metadataConcurrency);
      const batchFiles = await Promise.all(
        batch.map(async (entry): Promise<FileInfo | null> => {
          const fullPath = join(dirPath, entry.name);

          try {
            const stats = await stat(fullPath);
            return {
              name: entry.name,
              path: fullPath,
              isDirectory: entry.isDirectory(),
              size: entry.isDirectory() ? 0 : stats.size,
              modifiedTime: stats.mtime.toISOString(),
              svnStatus: undefined,
            };
          } catch {
            return null;
          }
        })
      );

      for (const file of batchFiles) {
        if (file) files.push(file);
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
export const FOLDER_SIZE_WORKER_TIMEOUT_MS = 30_000;

const EMPTY_STATUS_RESULT = { directStatus: {}, allEntries: [] };

// Track active background scans
const activeScans = new Map<string, AbortController>();
const activeScanProgress = new Map<string, (progress: DeepStatusProgress) => void>();
let activeScanCount = 0;

interface QueuedDeepScan {
  dirPath: string;
  jobId: string;
  controller: AbortController;
  startedAt: number;
  onProgress?: (progress: DeepStatusProgress) => void;
  resolve: (result: { directStatus: SvnStatusMap; allEntries: SvnStatusEntry[] }) => void;
}

async function getDirectoryMetadata(
  dirPath: string,
  hasFiles = true
): Promise<DirectoryMetadataResult> {
  const parentPath = getParentPath(dirPath);

  if (dirPath === 'DRIVES://') {
    return {
      parentPath,
      isVersioned: false,
      statusData: EMPTY_STATUS_RESULT,
      svnInfo: null,
      workingCopyUpgradeStatus: null,
      workingCopyContext: null,
    };
  }

  let svnInfo: DirectoryMetadataResult['svnInfo'] = null;
  let isVersionedResult = false;
  let workingCopyUpgradeStatus: DirectoryMetadataResult['workingCopyUpgradeStatus'] = null;

  try {
    svnInfo = await getInfo(dirPath);
    isVersionedResult = true;
    workingCopyUpgradeStatus = { path: dirPath, required: false };
  } catch (error) {
    // `getWorkingCopyUpgradeStatus` would run the same `svn info` again; the
    // error we already have answers the question, so classify it in-process.
    workingCopyUpgradeStatus = classifyWorkingCopyUpgradeError(dirPath, error);
  }

  const [statusData, workingCopyContext] = await Promise.all([
    isVersionedResult ? getSvnStatus(dirPath, 'immediates') : Promise.resolve(EMPTY_STATUS_RESULT),
    !svnInfo || !hasFiles ? getWorkingCopyContext(dirPath) : Promise.resolve(null),
  ]);

  return {
    parentPath,
    isVersioned: isVersionedResult,
    statusData,
    svnInfo,
    workingCopyUpgradeStatus,
    workingCopyContext,
  };
}

const queuedScans: QueuedDeepScan[] = [];

// Track active file watchers
interface OwnedWatcher {
  watcher: chokidar.FSWatcher;
  owner: WebContents;
  path: string;
}

const activeWatchers = new Map<string, OwnedWatcher>();

function watcherKey(owner: WebContents, path: string): string {
  return `${owner.id}:${path}`;
}

async function closeWatchersOwnedBy(owner: WebContents): Promise<void> {
  const matches = Array.from(activeWatchers.entries()).filter(
    ([, subscription]) => subscription.owner === owner
  );
  await Promise.allSettled(matches.map(([, subscription]) => subscription.watcher.close()));
  for (const [key] of matches) activeWatchers.delete(key);
}

export async function closeAllFileWatchers(): Promise<void> {
  const subscriptions = Array.from(activeWatchers.values());
  activeWatchers.clear();
  await Promise.allSettled(subscriptions.map(({ watcher }) => watcher.close()));
}

function createDeepStatusProgress(
  queued: QueuedDeepScan,
  phase: DeepStatusProgress['phase'],
  overrides: Partial<Pick<DeepStatusProgress, 'filesFound' | 'error'>> = {}
): DeepStatusProgress {
  return {
    path: queued.dirPath,
    jobId: queued.jobId,
    phase,
    activeScans: activeScanCount,
    queuedScans: queuedScans.length,
    elapsedMs: Date.now() - queued.startedAt,
    ...overrides,
  };
}

function emitDeepStatusProgress(
  queued: QueuedDeepScan,
  phase: DeepStatusProgress['phase'],
  overrides: Partial<Pick<DeepStatusProgress, 'filesFound' | 'error'>> = {}
) {
  queued.onProgress?.(createDeepStatusProgress(queued, phase, overrides));
}

function createDeepStatusProgressSender(
  sender: WebContents,
  dirPath: string
): (progress: DeepStatusProgress) => void {
  return (progress) => {
    if (progress.path === dirPath && !sender.isDestroyed()) {
      sender.send('fs:deepStatus:progress', progress);
    }
  };
}

function cancelDeepScan(dirPath: string) {
  const controller = activeScans.get(dirPath);
  if (controller) {
    controller.abort();
    const pool = getSharedWorkerPool();
    pool.cancel(`deep-status:${dirPath}`);
    const onProgress = activeScanProgress.get(dirPath);
    onProgress?.({
      path: dirPath,
      jobId: `deep-status:${dirPath}`,
      phase: 'cancelled',
      activeScans: activeScanCount,
      queuedScans: queuedScans.length,
      elapsedMs: 0,
    });
    activeScans.delete(dirPath);
    activeScanProgress.delete(dirPath);
  }

  for (let index = queuedScans.length - 1; index >= 0; index--) {
    const queued = queuedScans[index];
    if (queued.dirPath === dirPath) {
      const pool = getSharedWorkerPool();
      pool.cancel(queued.jobId);
      queuedScans.splice(index, 1);
      emitDeepStatusProgress(queued, 'cancelled');
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
    if (queued.onProgress) {
      activeScanProgress.set(queued.dirPath, queued.onProgress);
    }
    void runDeepScan(queued);
  }
}

async function runDeepScan(queued: QueuedDeepScan) {
  emitDeepStatusProgress(queued, 'running');
  const progressInterval = setInterval(() => {
    emitDeepStatusProgress(queued, 'running');
  }, 1000);
  progressInterval.unref?.();

  try {
    const { svnCommand, context } = await resolveSvnExecution();

    if (queued.controller.signal.aborted) {
      emitDeepStatusProgress(queued, 'cancelled');
      queued.resolve(EMPTY_STATUS_RESULT);
      return;
    }

    const pool = getSharedWorkerPool();
    const result = await pool.run(
      'svn:deepStatus',
      {
        dirPath: queued.dirPath,
        svnCommand,
        context,
      },
      {
        id: queued.jobId,
        priority: 'background',
      }
    );

    emitDeepStatusProgress(queued, 'complete', { filesFound: result.allEntries.length });
    queued.resolve(result);
  } catch (error) {
    if (queued.controller.signal.aborted) {
      emitDeepStatusProgress(queued, 'cancelled');
    } else {
      emitDeepStatusProgress(queued, 'error', {
        error: error instanceof Error ? error.message : String(error || ''),
      });
    }
    queued.resolve(EMPTY_STATUS_RESULT);
  } finally {
    clearInterval(progressInterval);
    activeScanCount = Math.max(0, activeScanCount - 1);
    if (activeScans.get(queued.dirPath) === queued.controller) {
      activeScans.delete(queued.dirPath);
    }
    if (queued.onProgress && activeScanProgress.get(queued.dirPath) === queued.onProgress) {
      activeScanProgress.delete(queued.dirPath);
    }
    startQueuedScans();
  }
}

/**
 * Background deep scan for folder aggregation
 */
export async function startDeepScan(
  dirPath: string,
  onProgress?: (progress: DeepStatusProgress) => void
): Promise<{
  directStatus: SvnStatusMap;
  allEntries: SvnStatusEntry[];
}> {
  cancelDeepScan(dirPath);

  const controller = new AbortController();
  const jobId = `deep-status:${dirPath}`;
  activeScans.set(dirPath, controller);
  const startedAt = Date.now();

  const result = new Promise<{ directStatus: SvnStatusMap; allEntries: SvnStatusEntry[] }>(
    (resolve) => {
      const queued: QueuedDeepScan = {
        dirPath,
        jobId,
        controller,
        startedAt,
        onProgress,
        resolve,
      };
      queuedScans.push(queued);
      emitDeepStatusProgress(queued, 'queued');
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

  if (os.platform() === 'win32') {
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
        await stat(mountPoint);
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
export function getParentPath(path: string): string | null {
  if (path === '/' || path === 'DRIVES://') return null;

  const normalized = normalize(path);
  const parent = dirname(normalized);

  // On Windows, if we're at the root of a drive (e.g., C:\), return DRIVES://
  if (os.platform() === 'win32' && parent.length === 2 && parent[1] === ':') {
    return 'DRIVES://';
  }

  // If same as input (we were at root), return null
  if (parent === normalized) return null;

  return parent;
}

/**
 * Calculate sizes for multiple folders
 */
async function calculateFolderSizes(folderPaths: string[]): Promise<Record<string, number>> {
  const approvedPaths = folderPaths.map((folderPath) =>
    assertPathApprovedForIpc(folderPath, 'Folder size calculation')
  );

  return getSharedWorkerPool().run(
    'fs:folderSizes',
    { folderPaths: approvedPaths },
    {
      id: `fs-folder-sizes:${approvedPaths.join('|')}`,
      priority: 'background',
      timeoutMs: FOLDER_SIZE_WORKER_TIMEOUT_MS,
      joinExisting: true,
    }
  );
}

function assertApprovedFsPath(path: string, operation: string): string {
  const validatedPath = validatePath(path, { allowAbsolute: true });
  return assertPathApprovedForIpc(validatedPath, operation);
}

function getApprovedParentPath(path: string): string | null {
  const parentPath = getParentPath(path);
  if (!parentPath || parentPath === 'DRIVES://') {
    return parentPath;
  }

  return isPathApprovedForIpc(parentPath) ? parentPath : null;
}

export function registerFsHandlers(): void {
  // Fast directory listing (filesystem only, no SVN)
  ipcMain.handle('fs:listDirectory', async (_, path: string): Promise<FileInfo[]> => {
    try {
      // Handle special DRIVES:// path for listing drives
      if (path === 'DRIVES://') {
        return listDrives();
      }
      return listDirectoryFiles(assertApprovedFsPath(path, 'Directory listing'));
    } catch (error) {
      if (
        (error instanceof Error ? error.message : String(error)).includes(
          'selected through ShellySVN'
        )
      )
        throw error;
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

  ipcMain.handle(
    'fs:getDirectoryMetadata',
    async (_, path: string, hasFiles?: boolean): Promise<DirectoryMetadataResult> => {
      try {
        return getDirectoryMetadata(assertApprovedFsPath(path, 'Directory metadata'), hasFiles);
      } catch (error) {
        if (
          (error instanceof Error ? error.message : String(error)).includes(
            'selected through ShellySVN'
          )
        )
          throw error;
        console.error('[FS] Directory metadata error:', error);
        return {
          parentPath: null,
          isVersioned: false,
          statusData: EMPTY_STATUS_RESULT,
          svnInfo: null,
          workingCopyUpgradeStatus: null,
          workingCopyContext: null,
        };
      }
    }
  );

  // Get parent directory
  ipcMain.handle('fs:getParent', async (_, path: string): Promise<string | null> => {
    if (path === 'DRIVES://') return null;

    try {
      return getApprovedParentPath(assertApprovedFsPath(path, 'Parent lookup'));
    } catch {
      return null;
    }
  });

  // Shallow SVN status (fast, --depth=immediates)
  ipcMain.handle('fs:getStatus', async (_, path: string) => {
    try {
      // Don't get SVN status for drives list
      if (path === 'DRIVES://') {
        return { directStatus: {}, allEntries: [] };
      }
      return getSvnStatus(assertApprovedFsPath(path, 'SVN status'), 'immediates');
    } catch (error) {
      console.error('[FS] Status error:', error);
      return { directStatus: {}, allEntries: [] };
    }
  });

  // Deep SVN status (slower, --depth=infinity) for folder aggregation
  ipcMain.handle('fs:getDeepStatus', async (event, path: string) => {
    try {
      // Don't get SVN status for drives list
      if (path === 'DRIVES://') {
        return { directStatus: {}, allEntries: [] };
      }
      const approvedPath = assertApprovedFsPath(path, 'Deep SVN status');
      const statusService = getStatusService();
      const cached = statusService.getDeepStatus(approvedPath);
      if (cached) {
        sendToRenderer(event.sender, 'fs:deepStatus:progress', {
          path: approvedPath,
          jobId: `deep-status:${approvedPath}`,
          phase: 'complete',
          activeScans: activeScanCount,
          queuedScans: queuedScans.length,
          elapsedMs: 0,
          filesFound: cached.allEntries.length,
        } satisfies DeepStatusProgress);
        return cached;
      }

      const result = await startDeepScan(
        approvedPath,
        createDeepStatusProgressSender(event.sender, approvedPath)
      );
      statusService.setDeepStatus(approvedPath, result);
      return result;
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
    try {
      return isVersioned(assertApprovedFsPath(path, 'Version check'));
    } catch {
      return false;
    }
  });

  // Read file content
  ipcMain.handle(
    'fs:readFile',
    async (_, path: string): Promise<{ success: boolean; content?: string; error?: string }> => {
      try {
        // File explorer entries are absolute paths. Keep reads constrained to roots
        // selected through ShellySVN, then apply the file-specific validation.
        const approvedPath = assertApprovedFsPath(path, 'File preview');
        const validatedPath = validatePath(approvedPath, {
          allowAbsolute: true,
          mustExist: true,
          mustBeFile: true,
          maxSize: MAX_FILE_PREVIEW_SIZE_BYTES,
        });

        const stats = await stat(validatedPath);

        // Limit file size for preview
        if (stats.size > MAX_FILE_PREVIEW_SIZE_BYTES) {
          return {
            success: false,
            error: `File too large for preview (>${MAX_FILE_PREVIEW_SIZE_BYTES / 1024 / 1024}MB)`,
          };
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
        const approvedPath = assertApprovedFsPath(filePath, 'Image preview');
        const validatedPath = validatePath(approvedPath, {
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
    try {
      cancelDeepScan(assertApprovedFsPath(path, 'Scan cancellation'));
    } catch {
      // Ignore cancellation for paths the renderer is not allowed to address.
    }
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

  ipcMain.handle(
    'fs:writeFileBase64',
    async (
      _,
      path: string,
      contentBase64: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)
        ) {
          return { success: false, error: 'Invalid base64 file content' };
        }
        const content = Buffer.from(contentBase64, 'base64');
        if (content.byteLength > 32 * 1024 * 1024) {
          return { success: false, error: 'Content too large (max 32MB)' };
        }

        const validatedPath = validatePath(path, { allowAbsolute: true });
        const approvedPath = assertPathApprovedForIpc(validatedPath, 'Binary file write');
        await mkdir(dirname(approvedPath), { recursive: true });
        await fsWriteFile(approvedPath, content);
        return { success: true };
      } catch (err) {
        if (err instanceof InputValidationError) {
          return { success: false, error: `Validation error: ${err.message}` };
        }
        console.error('[FS] Binary file write error:', err);
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
        const key = watcherKey(event.sender, approvedPath);

        if (activeWatchers.has(key)) {
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

          if (
            !sendToRenderer(event.sender, 'fs:watch:change', {
              path,
              eventType,
              changedPath,
            })
          ) {
            void closeWatchersOwnedBy(event.sender);
          }
        });

        watcher.on('error', (error) => {
          console.error('[FS] Watcher error:', error);
        });

        activeWatchers.set(key, { watcher, owner: event.sender, path: approvedPath });
        event.sender.once('destroyed', () => {
          void closeWatchersOwnedBy(event.sender);
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('fs:unwatch', async (event, path: string): Promise<{ success: boolean }> => {
    const approvedPath = assertPathApprovedForIpc(path, 'File watching');
    const key = watcherKey(event.sender, approvedPath);
    const subscription = activeWatchers.get(key);
    if (subscription) {
      await subscription.watcher.close();
      activeWatchers.delete(key);
    }
    return { success: true };
  });

  ipcMain.handle('fs:exists', async (_, path: string): Promise<boolean> => {
    try {
      await stat(assertApprovedFsPath(path, 'Path existence check'));
      return true;
    } catch {
      return false;
    }
  });
}
