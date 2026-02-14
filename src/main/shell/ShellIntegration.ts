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

import { app, ipcMain } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import type { SvnStatusChar } from '@shared/types'

// Icon overlay status mapping
export const OVERLAY_STATUS_MAP: Record<SvnStatusChar, { icon: string; priority: number }> = {
  ' ': { icon: 'normal', priority: 0 },
  'A': { icon: 'added', priority: 5 },
  'C': { icon: 'conflict', priority: 10 },
  'D': { icon: 'deleted', priority: 6 },
  'I': { icon: 'ignored', priority: 1 },
  'M': { icon: 'modified', priority: 7 },
  'R': { icon: 'replaced', priority: 8 },
  'X': { icon: 'external', priority: 2 },
  '?': { icon: 'unversioned', priority: 1 },
  '!': { icon: 'missing', priority: 9 },
  '~': { icon: 'obstructed', priority: 3 },
}

interface OverlayIcon {
  id: string
  path: string
  status: SvnStatusChar
}

export class ShellIntegrationManager {
  private isWindows: boolean
  private isMac: boolean
  private overlayCache: Map<string, SvnStatusChar> = new Map()
  private helperPath: string
  private isRegistered: boolean = false
  
  constructor() {
    this.isWindows = process.platform === 'win32'
    this.isMac = process.platform === 'darwin'
    this.helperPath = this.getHelperPath()
  }
  
  private getHelperPath(): string {
    const resourcesPath = app.isPackaged 
      ? join(process.resourcesPath, 'shell')
      : join(__dirname, '../../../resources/shell')
    
    if (this.isWindows) {
      return join(resourcesPath, 'ShellySVNShellHelper.exe')
    } else if (this.isMac) {
      return join(resourcesPath, 'ShellySVNFinderSync')
    }
    return ''
  }
  
  /**
   * Register shell integration
   */
  async register(): Promise<boolean> {
    if (!this.isWindows && !this.isMac) {
      console.log('[Shell] Shell integration not supported on this platform')
      return false
    }
    
    try {
      if (this.isWindows) {
        await this.registerWindowsShellExtension()
      } else if (this.isMac) {
        await this.registerMacFinderSync()
      }
      
      this.isRegistered = true
      return true
    } catch (err) {
      console.error('[Shell] Failed to register shell integration:', err)
      return false
    }
  }
  
  /**
   * Unregister shell integration
   */
  async unregister(): Promise<boolean> {
    if (!this.isRegistered) return true
    
    try {
      if (this.isWindows) {
        await this.unregisterWindowsShellExtension()
      } else if (this.isMac) {
        await this.unregisterMacFinderSync()
      }
      
      this.isRegistered = false
      return true
    } catch (err) {
      console.error('[Shell] Failed to unregister shell integration:', err)
      return false
    }
  }
  
  /**
   * Update overlay icon for a path
   */
  async updateOverlay(path: string, status: SvnStatusChar): Promise<void> {
    this.overlayCache.set(path, status)
    
    if (this.isWindows && this.isRegistered) {
      // Notify Windows shell helper
      await this.notifyWindowsHelper('update-overlay', { path, status })
    }
  }
  
  /**
   * Update overlays for multiple paths
   */
  async updateOverlays(overlays: OverlayIcon[]): Promise<void> {
    for (const overlay of overlays) {
      this.overlayCache.set(overlay.path, overlay.status)
    }
    
    if (this.isWindows && this.isRegistered) {
      await this.notifyWindowsHelper('update-overlays', { overlays })
    }
  }
  
  /**
   * Clear overlay for a path
   */
  async clearOverlay(path: string): Promise<void> {
    this.overlayCache.delete(path)
    
    if (this.isWindows && this.isRegistered) {
      await this.notifyWindowsHelper('clear-overlay', { path })
    }
  }
  
  /**
   * Clear all overlays
   */
  async clearAllOverlays(): Promise<void> {
    this.overlayCache.clear()
    
    if (this.isWindows && this.isRegistered) {
      await this.notifyWindowsHelper('clear-all-overlays', {})
    }
  }
  
  /**
   * Get cached status for a path
   */
  getCachedStatus(path: string): SvnStatusChar | undefined {
    return this.overlayCache.get(path)
  }
  
  // ========================================
  // Windows Implementation
  // ========================================
  
  private async registerWindowsShellExtension(): Promise<void> {
    // Check if helper exists
    const fs = require('fs')
    if (!fs.existsSync(this.helperPath)) {
      console.log('[Shell] Windows shell helper not found at:', this.helperPath)
      console.log('[Shell] Shell integration requires compilation of native shell extension')
      return
    }
    
    // Register the shell extension via helper
    await this.notifyWindowsHelper('register', {
      appId: 'com.shellysvn.app',
      appName: 'ShellySVN',
      iconPath: join(app.getPath('userData'), 'icons')
    })
    
    console.log('[Shell] Windows shell extension registered')
  }
  
  private async unregisterWindowsShellExtension(): Promise<void> {
    await this.notifyWindowsHelper('unregister', {})
    console.log('[Shell] Windows shell extension unregistered')
  }
  
  private async notifyWindowsHelper(command: string, data: any): Promise<void> {
    return new Promise((resolve) => {
      if (!this.helperPath) {
        resolve()
        return
      }
      
      const proc = spawn(this.helperPath, [command, JSON.stringify(data)], {
        detached: true,
        stdio: 'ignore'
      })
      
      proc.on('error', (err) => {
        console.error('[Shell] Helper error:', err)
        resolve() // Don't fail the operation
      })
      
      proc.unref()
      resolve()
    })
  }
  
  // ========================================
  // macOS Implementation
  // ========================================
  
  private async registerMacFinderSync(): Promise<void> {
    // Finder Sync extensions require:
    // 1. A separate app extension target in Xcode
    // 2. Proper provisioning profile
    // 3. App Store distribution OR Developer ID signing
    
    console.log('[Shell] macOS Finder Sync requires native extension compilation')
    console.log('[Shell] See resources/shell/ShellySVNFinderSync for implementation')
    
    // For now, we'll use a simpler approach: Finder toolbar item
    // This can be done via AppleScript
  }
  
  private async unregisterMacFinderSync(): Promise<void> {
    // Remove Finder toolbar item if added
  }
}

// Singleton instance
let shellIntegrationManager: ShellIntegrationManager | null = null

export function getShellIntegration(): ShellIntegrationManager {
  if (!shellIntegrationManager) {
    shellIntegrationManager = new ShellIntegrationManager()
  }
  return shellIntegrationManager
}

// IPC Handlers
export function registerShellIntegrationHandlers(): void {
  // Register shell integration
  ipcMain.handle('shell:register', async () => {
    const shell = getShellIntegration()
    return { success: await shell.register() }
  })
  
  // Unregister shell integration
  ipcMain.handle('shell:unregister', async () => {
    const shell = getShellIntegration()
    return { success: await shell.unregister() }
  })
  
  // Update overlay
  ipcMain.handle('shell:updateOverlay', async (_, path: string, status: SvnStatusChar) => {
    const shell = getShellIntegration()
    await shell.updateOverlay(path, status)
    return { success: true }
  })
  
  // Update overlays batch
  ipcMain.handle('shell:updateOverlays', async (_, overlays: OverlayIcon[]) => {
    const shell = getShellIntegration()
    await shell.updateOverlays(overlays)
    return { success: true }
  })
  
  // Clear overlay
  ipcMain.handle('shell:clearOverlay', async (_, path: string) => {
    const shell = getShellIntegration()
    await shell.clearOverlay(path)
    return { success: true }
  })
  
  // Clear all overlays
  ipcMain.handle('shell:clearAllOverlays', async () => {
    const shell = getShellIntegration()
    await shell.clearAllOverlays()
    return { success: true }
  })
  
  // Check if registered
  ipcMain.handle('shell:isRegistered', async () => {
    // Check registration status
    return { registered: false } // Placeholder
  })
}
