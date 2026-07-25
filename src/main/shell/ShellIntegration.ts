/**
 * Shell Integration Manager
 *
 * Handles Windows icon overlays and context menu integration.
 *
 * On Windows:
 * - Icon overlays require a shell extension DLL (C++ native code)
 * - Context menus can be registered via registry
 *
 * On macOS:
 * - Finder Sync extension (Swift/Objective-C)
 * - Requires separate app extension target
 */

import { app, ipcMain } from 'electron';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import type { ShellIntegrationStatus, SvnStatusChar, SvnStatusEntry } from '@shared/types';
// oxlint-disable-next-line eslint-plugin-import(no-named-as-default)
import debug from '../utils/debug';
import {
  getDefaultLocalStatusSocketPath,
  getLocalStatusServerAuthToken,
} from '../services/local-status-server';

// Icon overlay status mapping
export const OVERLAY_STATUS_MAP: Record<SvnStatusChar, { icon: string; priority: number }> = {
  ' ': { icon: 'normal', priority: 0 },
  A: { icon: 'added', priority: 5 },
  C: { icon: 'conflict', priority: 10 },
  D: { icon: 'deleted', priority: 6 },
  I: { icon: 'ignored', priority: 1 },
  M: { icon: 'modified', priority: 7 },
  R: { icon: 'replaced', priority: 8 },
  X: { icon: 'external', priority: 2 },
  '?': { icon: 'unversioned', priority: 1 },
  '!': { icon: 'missing', priority: 9 },
  '~': { icon: 'obstructed', priority: 3 },
  O: { icon: 'remote-only', priority: 2 },
};

export const WINDOWS_CONTEXT_MENU_COMMANDS = [
  'checkout',
  'update',
  'commit',
  'diff',
  'log',
  'revert',
  'cleanup',
  'resolve',
  'lock',
  'unlock',
  'branch-tag',
  'switch',
  'merge',
  'properties',
] as const;

export const FINDER_CONTEXT_MENU_COMMANDS = [
  'checkout',
  'update',
  'commit',
  'diff',
  'log',
  'revert',
  'cleanup',
  'resolve',
  'lock',
  'unlock',
  'branch-tag',
  'switch',
  'merge',
  'properties',
] as const;

export type FileManagerPresentationStatus = SvnStatusChar | 'locked';

export const FILE_MANAGER_STATUS_PRESENTATION: Record<
  FileManagerPresentationStatus,
  {
    windowsIcon: string;
    finderBadge?: string;
    priority: number;
    label: string;
  }
> = {
  ' ': { windowsIcon: 'normal', finderBadge: 'normal', priority: 0, label: 'Normal' },
  A: { windowsIcon: 'added', finderBadge: 'added', priority: 5, label: 'Added' },
  C: { windowsIcon: 'conflict', finderBadge: 'conflicted', priority: 10, label: 'Conflicted' },
  D: { windowsIcon: 'deleted', priority: 6, label: 'Deleted' },
  I: { windowsIcon: 'ignored', finderBadge: 'ignored', priority: 1, label: 'Ignored' },
  M: { windowsIcon: 'modified', finderBadge: 'modified', priority: 7, label: 'Modified' },
  R: { windowsIcon: 'replaced', priority: 8, label: 'Replaced' },
  X: { windowsIcon: 'external', finderBadge: 'external', priority: 2, label: 'External' },
  '?': {
    windowsIcon: 'unversioned',
    finderBadge: 'unversioned',
    priority: 1,
    label: 'Unversioned',
  },
  '!': { windowsIcon: 'missing', finderBadge: 'missing', priority: 9, label: 'Missing' },
  '~': { windowsIcon: 'obstructed', priority: 3, label: 'Obstructed' },
  O: { windowsIcon: 'remote-only', priority: 2, label: 'Remote only' },
  locked: { windowsIcon: 'locked', finderBadge: 'locked', priority: 4, label: 'Locked' },
};

export const FINDER_BADGE_STATUS_MAP: Partial<Record<SvnStatusChar, string>> = {
  ' ': 'normal',
  A: 'added',
  C: 'conflicted',
  I: 'ignored',
  M: 'modified',
  X: 'external',
  '?': 'unversioned',
  '!': 'missing',
};

export function getFileManagerPresentationStatus(
  entry: Pick<SvnStatusEntry, 'status' | 'lock'>
): FileManagerPresentationStatus {
  if (entry.lock && entry.status === ' ') {
    return 'locked';
  }

  return entry.status;
}

export function createFileManagerHandoffUrl(command: string, selectedPaths: string[]): string {
  const params = new URLSearchParams();
  params.set('command', command);
  for (const selectedPath of selectedPaths) {
    params.append('path', selectedPath);
  }
  return `shellysvn://file-manager-action?${params.toString()}`;
}

interface OverlayIcon {
  id: string;
  path: string;
  status: SvnStatusChar;
}

/**
 * Data structure for Windows shell helper commands
 */
interface WindowsHelperData {
  appId?: string;
  appName?: string;
  iconPath?: string;
  statusSocketPath?: string;
  statusAuthToken?: string;
  path?: string;
  status?: SvnStatusChar;
  overlays?: OverlayIcon[];
}

export interface ShellIntegrationResult {
  success: boolean;
  error?: string;
}

export class ShellIntegrationManager {
  private isWindows: boolean;
  private isMac: boolean;
  private overlayCache: Map<string, SvnStatusChar> = new Map();
  private helperPath: string;
  private isRegistered: boolean = false;

  constructor() {
    this.isWindows = process.platform === 'win32';
    this.isMac = process.platform === 'darwin';
    this.helperPath = this.getHelperPath();
  }

  private getHelperPath(): string {
    const resourcesPath = app.isPackaged
      ? join(process.resourcesPath, 'shell')
      : join(__dirname, '../../../resources/shell');

    if (this.isWindows) {
      return join(resourcesPath, 'ShellySVNShellHelper.exe');
    } else if (this.isMac) {
      return join(resourcesPath, 'ShellySVNFinderSync');
    }
    return '';
  }

  getStatus(): ShellIntegrationStatus {
    const helperExists = this.helperPath ? existsSync(this.helperPath) : false;
    const platform = this.isWindows
      ? 'windows'
      : this.isMac
        ? 'macos'
        : process.platform === 'linux'
          ? 'linux'
          : 'unsupported';
    const supported = this.isWindows || this.isMac;
    const registered = this.isRegistered && helperExists;
    const missingHelperMessage = this.isWindows
      ? 'Windows shell helper is missing. Explorer context menus and overlays are unavailable until the native helper is installed.'
      : this.isMac
        ? 'macOS Finder Sync helper is missing. Finder context menus and badges are unavailable until the app extension is installed.'
        : 'Native file manager integration is not supported on this platform yet.';

    const repairActions: string[] = [];
    const limitations: string[] = [];

    if (!supported) {
      repairActions.push(
        'Use ShellySVN app actions from the file explorer, command palette, and toolbar.'
      );
      limitations.push(
        'Linux file manager integration is deferred until Windows and macOS parity is stable.'
      );
    } else if (!helperExists) {
      repairActions.push(
        this.isWindows
          ? 'Install a packaged build that includes ShellySVNShellHelper.exe.'
          : 'Install a packaged build that includes the ShellySVN Finder Sync extension.'
      );
      repairActions.push('Run packaged-app diagnostics after installing the native helper.');
      limitations.push(
        'The standalone app remains fully usable for commit, update, diff, log, merge, and conflict workflows.'
      );
    } else if (!registered) {
      repairActions.push(
        this.isWindows
          ? 'Register the Windows shell helper from Settings > Integration.'
          : 'Enable the Finder Sync extension in macOS System Settings, then register from ShellySVN.'
      );
    }

    if (this.isWindows) {
      limitations.push('Explorer may require restart or sign-out before overlay changes appear.');
    }

    if (this.isMac) {
      limitations.push('Finder Sync badge availability depends on macOS extension permissions.');
    }

    return {
      platform,
      supported,
      registered,
      helperPath: this.helperPath || null,
      helperExists,
      contextMenuAvailable: registered,
      iconOverlaysAvailable: this.isWindows && registered,
      finderBadgesAvailable: this.isMac && registered,
      needsAdmin: this.isWindows && !registered,
      fallbackAvailable: true,
      message: registered
        ? 'Native file manager integration is registered.'
        : helperExists
          ? 'Native file manager helper is installed but not registered.'
          : missingHelperMessage,
      repairActions,
      limitations,
    };
  }

  /**
   * Register shell integration
   */
  async register(): Promise<ShellIntegrationResult> {
    if (!this.isWindows && !this.isMac) {
      debug.log('[Shell] Shell integration not supported on this platform');
      return { success: false, error: 'Shell integration is not supported on this platform.' };
    }

    try {
      if (this.isWindows) {
        await this.registerWindowsShellExtension();
      } else if (this.isMac) {
        await this.registerMacFinderSync();
      }

      if (!this.getStatus().helperExists) {
        throw new Error(this.getStatus().message);
      }

      this.isRegistered = true;
      return { success: true };
    } catch (err) {
      debug.error('[Shell] Failed to register shell integration:', err);
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Unregister shell integration
   */
  async unregister(): Promise<boolean> {
    if (!this.isRegistered) return true;

    try {
      if (this.isWindows) {
        await this.unregisterWindowsShellExtension();
      } else if (this.isMac) {
        await this.unregisterMacFinderSync();
      }

      this.isRegistered = false;
      return true;
    } catch (err) {
      debug.error('[Shell] Failed to unregister shell integration:', err);
      return false;
    }
  }

  /**
   * Update overlay icon for a path
   */
  async updateOverlay(path: string, status: SvnStatusChar): Promise<void> {
    this.overlayCache.set(path, status);

    if (this.isWindows && this.isRegistered) {
      // Notify Windows shell helper
      await this.notifyWindowsHelper('update-overlay', { path, status });
    }
  }

  /**
   * Update overlays for multiple paths
   */
  async updateOverlays(overlays: OverlayIcon[]): Promise<void> {
    for (const overlay of overlays) {
      this.overlayCache.set(overlay.path, overlay.status);
    }

    if (this.isWindows && this.isRegistered) {
      await this.notifyWindowsHelper('update-overlays', { overlays });
    }
  }

  /**
   * Clear overlay for a path
   */
  async clearOverlay(path: string): Promise<void> {
    this.overlayCache.delete(path);

    if (this.isWindows && this.isRegistered) {
      await this.notifyWindowsHelper('clear-overlay', { path });
    }
  }

  /**
   * Clear all overlays
   */
  async clearAllOverlays(): Promise<void> {
    this.overlayCache.clear();

    if (this.isWindows && this.isRegistered) {
      await this.notifyWindowsHelper('clear-all-overlays', {});
    }
  }

  /**
   * Get cached status for a path
   */
  getCachedStatus(path: string): SvnStatusChar | undefined {
    return this.overlayCache.get(path);
  }

  /**
   * Check if shell integration is currently registered
   */
  getIsRegistered(): boolean {
    return this.getStatus().registered;
  }

  // ========================================
  // Windows Implementation
  // ========================================

  private async registerWindowsShellExtension(): Promise<void> {
    // Check if helper exists
    if (!existsSync(this.helperPath)) {
      debug.log('[Shell] Windows shell helper not found at:', this.helperPath);
      debug.log('[Shell] Shell integration requires compilation of native shell extension');
      throw new Error(
        'Windows shell helper is missing. Native shell integration is not installed.'
      );
    }

    // Register the shell extension via helper
    await this.notifyWindowsHelper('register', {
      appId: 'com.shellysvn.app',
      appName: 'ShellySVN',
      iconPath: join(app.getPath('userData'), 'icons'),
      statusSocketPath: getDefaultLocalStatusSocketPath(app.getPath('userData')),
      statusAuthToken: getLocalStatusServerAuthToken() ?? undefined,
    });

    debug.log('[Shell] Windows shell extension registered');
  }

  private async unregisterWindowsShellExtension(): Promise<void> {
    await this.notifyWindowsHelper('unregister', {});
    debug.log('[Shell] Windows shell extension unregistered');
  }

  private async notifyWindowsHelper(command: string, data: WindowsHelperData): Promise<void> {
    return new Promise((resolve) => {
      if (!this.helperPath) {
        resolve();
        return;
      }

      const proc = spawn(this.helperPath, [command, JSON.stringify(data)], {
        detached: true,
        stdio: 'ignore',
      });

      proc.on('error', (err) => {
        debug.error('[Shell] Helper error:', err);
        resolve(); // Don't fail the operation
      });

      proc.unref();
      resolve();
    });
  }

  // ========================================
  // macOS Implementation
  // ========================================

  private async registerMacFinderSync(): Promise<void> {
    // Finder Sync extensions require:
    // 1. A separate app extension target in Xcode
    // 2. Proper provisioning profile
    // 3. App Store distribution OR Developer ID signing

    debug.log('[Shell] macOS Finder Sync requires native extension compilation');
    debug.log('[Shell] See resources/shell/ShellySVNFinderSync for implementation');

    throw new Error(
      'macOS Finder Sync helper is missing. Native shell integration is not installed.'
    );
  }

  private async unregisterMacFinderSync(): Promise<void> {
    // Remove Finder toolbar item if added
  }
}

// Singleton instance
let shellIntegrationManager: ShellIntegrationManager | null = null;

export function getShellIntegration(): ShellIntegrationManager {
  if (!shellIntegrationManager) {
    shellIntegrationManager = new ShellIntegrationManager();
  }
  return shellIntegrationManager;
}

// IPC Handlers
export function registerShellIntegrationHandlers(): void {
  // Register shell integration
  ipcMain.handle('shell:register', async () => {
    const shell = getShellIntegration();
    return shell.register();
  });

  // Unregister shell integration
  ipcMain.handle('shell:unregister', async () => {
    const shell = getShellIntegration();
    return { success: await shell.unregister() };
  });

  // Update overlay
  ipcMain.handle('shell:updateOverlay', async (_, path: string, status: SvnStatusChar) => {
    const shell = getShellIntegration();
    await shell.updateOverlay(path, status);
    return { success: true };
  });

  // Clear overlay
  ipcMain.handle('shell:clearOverlay', async (_, path: string) => {
    const shell = getShellIntegration();
    await shell.clearOverlay(path);
    return { success: true };
  });

  // Clear all overlays
  ipcMain.handle('shell:clearAllOverlays', async () => {
    const shell = getShellIntegration();
    await shell.clearAllOverlays();
    return { success: true };
  });

  // Check if registered
  ipcMain.handle('shell:isRegistered', async () => {
    const shell = getShellIntegration();
    return { registered: shell.getIsRegistered() };
  });

  ipcMain.handle('shell:getStatus', async () => {
    const shell = getShellIntegration();
    return shell.getStatus();
  });
}
