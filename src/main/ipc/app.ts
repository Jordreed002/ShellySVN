import { ipcMain, app, shell, BrowserWindow } from 'electron';
import { readdir, stat, unlink, rmdir } from 'fs/promises';
import { join } from 'path';

/**
 * Allowed URL schemes for external links
 */
const ALLOWED_EXTERNAL_SCHEMES = ['http:', 'https:', 'mailto:'];

/**
 * Cache type definitions
 */
interface CacheBreakdown {
  electron: number;
  logs: number;
  auth: number;
}

/**
 * Validate a URL before opening externally
 * SECURITY: Only allow specific schemes to prevent potential abuse
 */
function isValidExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_EXTERNAL_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
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
        await unlink(fullPath);
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

  // Log cache directory
  const logDir = join(userDataPath, 'shelly-cache', 'logs');

  // Auth cache directory (stored in shelly-cache/auth)
  const authDir = join(userDataPath, 'shelly-cache', 'auth');

  let electronSize = 0;
  let logsSize = 0;
  let authSize = 0;

  // Calculate Electron cache size
  for (const dir of electronDirs) {
    const result = await getDirectorySize(dir);
    electronSize += result.size;
  }

  // Calculate logs size
  const logsResult = await getDirectorySize(logDir);
  logsSize = logsResult.size;

  // Calculate auth size
  const authResult = await getDirectorySize(authDir);
  authSize = authResult.size;

  return {
    electron: electronSize,
    logs: logsSize,
    auth: authSize,
  };
}

/**
 * Clear specific cache types
 */
async function clearCacheTypes(types: ('electron' | 'logs' | 'auth')[]): Promise<{ success: boolean; error?: string }> {
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
      const logDir = join(userDataPath, 'shelly-cache', 'logs');
      await clearDirectory(logDir);
    }

    if (types.includes('auth')) {
      const authDir = join(userDataPath, 'shelly-cache', 'auth');
      await clearDirectory(authDir);
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

  ipcMain.handle(
    'app:getPath',
    (_, name: 'home' | 'appData' | 'desktop' | 'documents' | 'temp') => {
      if (name === 'temp') {
        return app.getPath('temp');
      }
      return app.getPath(name);
    }
  );

  ipcMain.handle('app:openExternal', async (_, url: string) => {
    // SECURITY: Validate URL before opening
    if (!isValidExternalUrl(url)) {
      console.warn('[SECURITY] Blocked attempt to open invalid URL:', url.substring(0, 100));
      return {
        success: false,
        error: 'Invalid URL scheme. Only http, https, and mailto are allowed.',
      };
    }

    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('app:clearCache', async () => {
    try {
      const userDataPath = app.getPath('userData');

      // Clear specific cache directories
      const cacheDirs = [
        join(userDataPath, 'Cache'),
        join(userDataPath, 'Code Cache'),
        join(userDataPath, 'GPUCache'),
        join(userDataPath, 'DawnCache'),
        join(userDataPath, 'GrShaderCache'),
      ];

      // Clear log cache (our custom cache)
      const logCachePath = join(userDataPath, 'shelly-cache', 'logs');
      cacheDirs.push(logCachePath);

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
        join(userDataPath, 'shelly-cache', 'logs'),
      ];

      let totalSize = 0;
      let totalFiles = 0;

      for (const cacheDir of cacheDirs) {
        const result = await getDirectorySize(cacheDir);
        totalSize += result.size;
        totalFiles += result.files;
      }

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
    async (_, types: ('electron' | 'logs' | 'auth')[]): Promise<{ success: boolean; error?: string }> => {
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
