import { ipcMain, app, BrowserWindow } from 'electron';
import { readdir, stat, unlink as removeFile, rmdir } from 'fs/promises';
import { join } from 'path';
import { openValidatedExternalUrl } from '../utils/external-url';
import { getSvnCacheService } from '../services/svn-cache-service';

/**
 * Cache type definitions
 */
interface CacheBreakdown {
  electron: number;
  logs: number;
  offline: number;
  auth: number;
}

function getAuthCachePath(): string {
  return join(app.getPath('userData'), 'auth-cache.json');
}

async function getFileSize(filePath: string): Promise<{ size: number; files: number }> {
  try {
    const stats = await stat(filePath);
    return stats.isFile() ? { size: stats.size, files: 1 } : { size: 0, files: 0 };
  } catch {
    return { size: 0, files: 0 };
  }
}

async function getDirectorySize(dirPath: string): Promise<{ size: number; files: number }> {
  let totalSize = 0;
  let fileCount = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subDir = await getDirectorySize(fullPath);
        totalSize += subDir.size;
        fileCount += subDir.files;
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        totalSize += stats.size;
        fileCount++;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return { size: totalSize, files: fileCount };
}

async function clearDirectory(dirPath: string): Promise<void> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await clearDirectory(fullPath);
        await rmdir(fullPath);
      } else {
        await removeFile(fullPath);
      }
    }
  } catch {
    // File/directory doesn't exist or can't be deleted
  }
}

/**
 * Get cache breakdown by type
 */
async function getCacheBreakdown(): Promise<CacheBreakdown> {
  const userDataPath = app.getPath('userData');

  // Electron cache directories
  const electronDirs = [
    join(userDataPath, 'Cache'),
    join(userDataPath, 'Code Cache'),
    join(userDataPath, 'GPUCache'),
    join(userDataPath, 'DawnCache'),
    join(userDataPath, 'GrShaderCache'),
  ];

  const authCachePath = getAuthCachePath();

  let electronSize = 0;
  let authSize = 0;

  // Calculate Electron cache size
  for (const dir of electronDirs) {
    const result = await getDirectorySize(dir);
    electronSize += result.size;
  }

  // Calculate auth size
  const authResult = await getFileSize(authCachePath);
  authSize = authResult.size;

  const svnCache = await getSvnCacheService().stats();
  return {
    electron: electronSize,
    logs: svnCache.logSize,
    offline: svnCache.offlineSize,
    auth: authSize,
  };
}

/**
 * Clear specific cache types
 */
async function clearCacheTypes(
  types: ('electron' | 'logs' | 'offline' | 'auth')[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const userDataPath = app.getPath('userData');

    if (types.includes('electron')) {
      const electronDirs = [
        join(userDataPath, 'Cache'),
        join(userDataPath, 'Code Cache'),
        join(userDataPath, 'GPUCache'),
        join(userDataPath, 'DawnCache'),
        join(userDataPath, 'GrShaderCache'),
      ];
      for (const dir of electronDirs) {
        await clearDirectory(dir);
      }
    }

    if (types.includes('logs')) {
      await getSvnCacheService().clearNamespace('log');
    }

    if (types.includes('offline')) {
      const clearedAt = Date.now();
      await Promise.all([
        getSvnCacheService().clearNamespace('info', clearedAt),
        getSvnCacheService().clearNamespace('status', clearedAt),
        getSvnCacheService().clearNamespace('entries', clearedAt),
      ]);
    }

    if (types.includes('auth')) {
      try {
        await removeFile(getAuthCachePath());
      } catch {
        // Auth cache may not exist yet.
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export function registerAppHandlers(): void {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getPlatform', () => process.platform);

  ipcMain.handle('app:openExternal', async (_, url: string) => {
    return openValidatedExternalUrl(url);
  });

  ipcMain.handle('app:clearCache', async () => {
    try {
      const clearedAt = Date.now();
      await getSvnCacheService().clearAll(clearedAt);
      const userDataPath = app.getPath('userData');

      // Clear specific cache directories
      const cacheDirs = [
        join(userDataPath, 'Cache'),
        join(userDataPath, 'Code Cache'),
        join(userDataPath, 'GPUCache'),
        join(userDataPath, 'DawnCache'),
        join(userDataPath, 'GrShaderCache'),
      ];

      for (const cacheDir of cacheDirs) {
        await clearDirectory(cacheDir);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('app:getCacheSize', async () => {
    try {
      const userDataPath = app.getPath('userData');

      const cacheDirs = [
        join(userDataPath, 'Cache'),
        join(userDataPath, 'Code Cache'),
        join(userDataPath, 'GPUCache'),
        join(userDataPath, 'DawnCache'),
        join(userDataPath, 'GrShaderCache'),
      ];

      let totalSize = 0;
      let totalFiles = 0;

      for (const cacheDir of cacheDirs) {
        const result = await getDirectorySize(cacheDir);
        totalSize += result.size;
        totalFiles += result.files;
      }

      const svnCache = await getSvnCacheService().stats();
      totalSize += svnCache.totalSize;
      totalFiles +=
        svnCache.infoCount + svnCache.statusCount + svnCache.logCount + svnCache.entriesCount;

      return { size: totalSize, files: totalFiles };
    } catch {
      return { size: 0, files: 0 };
    }
  });

  // Get cache breakdown by type
  ipcMain.handle('app:getCacheBreakdown', async (): Promise<CacheBreakdown> => {
    return getCacheBreakdown();
  });

  // Clear specific cache types
  ipcMain.handle(
    'app:clearCacheTypes',
    async (
      _,
      types: ('electron' | 'logs' | 'offline' | 'auth')[]
    ): Promise<{ success: boolean; error?: string }> => {
      return clearCacheTypes(types);
    }
  );

  // Window control handlers
  ipcMain.handle('app:window:minimize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.minimize();
  });

  ipcMain.handle('app:window:maximize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.handle('app:window:close', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.close();
  });

  ipcMain.handle('app:window:isMaximized', () => {
    const window = BrowserWindow.getFocusedWindow();
    return window?.isMaximized() ?? false;
  });
}
