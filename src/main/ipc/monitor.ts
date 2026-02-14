import { ipcMain } from 'electron'
import type { WorkingCopyInfo } from '@shared/types'

// In-memory storage for monitored working copies
let monitoredWorkingCopies: Map<string, WorkingCopyInfo> = new Map()
let monitorInterval: NodeJS.Timeout | null = null

export function registerMonitorHandlers(): void {
  // Get all monitored working copies
  ipcMain.handle('monitor:getWorkingCopies', async (): Promise<WorkingCopyInfo[]> => {
    return Array.from(monitoredWorkingCopies.values())
  })

  // Add a working copy to monitor
  ipcMain.handle('monitor:addWorkingCopy', async (_, path: string): Promise<{ success: boolean }> => {
    try {
      // Get info about the working copy
      const info = await getSvnInfo(path)
      if (info) {
        monitoredWorkingCopies.set(path, {
          path,
          url: info.url,
          revision: info.revision,
          hasChanges: false,
          lastChecked: Date.now(),
          isMonitored: true
        })
      }
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  // Remove a working copy from monitor
  ipcMain.handle('monitor:removeWorkingCopy', async (_, path: string): Promise<{ success: boolean }> => {
    monitoredWorkingCopies.delete(path)
    return { success: true }
  })

  // Refresh status of a working copy
  ipcMain.handle('monitor:refreshStatus', async (_, path: string): Promise<WorkingCopyInfo | null> => {
    const info = monitoredWorkingCopies.get(path)
    if (!info) return null
    
    try {
      const status = await getSvnStatus(path)
      info.hasChanges = status.entries.length > 0
      info.lastChecked = Date.now()
      monitoredWorkingCopies.set(path, info)
      return info
    } catch {
      return info
    }
  })

  // Start monitoring (periodic refresh)
  ipcMain.handle('monitor:startMonitoring', async () => {
    if (monitorInterval) return
    
    monitorInterval = setInterval(async () => {
      for (const [path, info] of monitoredWorkingCopies) {
        if (info.isMonitored) {
          try {
            const status = await getSvnStatus(path)
            info.hasChanges = status.entries.length > 0
            info.lastChecked = Date.now()
            monitoredWorkingCopies.set(path, info)
          } catch {
            // Ignore errors during background refresh
          }
        }
      }
    }, 60000) // Check every minute
  })

  // Stop monitoring
  ipcMain.handle('monitor:stopMonitoring', async () => {
    if (monitorInterval) {
      clearInterval(monitorInterval)
      monitorInterval = null
    }
  })
}

// Helper to get SVN info
async function getSvnInfo(path: string): Promise<{ url: string; revision: number } | null> {
  const { spawn } = require('child_process')
  
  return new Promise((resolve) => {
    const svnCommand = process.platform === 'win32' ? 'svn.exe' : 'svn'
    const proc = spawn(svnCommand, ['info', '--xml', path], {
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    
    let stdout = ''
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    
    proc.on('close', (code: number) => {
      if (code === 0) {
        const urlMatch = stdout.match(/<url>([^<]+)<\/url>/)
        const revMatch = stdout.match(/revision="(\d+)"/)
        resolve({
          url: urlMatch?.[1] || '',
          revision: revMatch ? parseInt(revMatch[1], 10) : 0
        })
      } else {
        resolve(null)
      }
    })
    
    proc.on('error', () => resolve(null))
  })
}

// Helper to get SVN status
async function getSvnStatus(path: string): Promise<{ entries: { path: string }[] }> {
  const { spawn } = require('child_process')
  
  return new Promise((resolve) => {
    const svnCommand = process.platform === 'win32' ? 'svn.exe' : 'svn'
    const proc = spawn(svnCommand, ['status', '--xml', path], {
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    
    let stdout = ''
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    
    proc.on('close', () => {
      // Count entries
      const entryMatches = stdout.match(/<entry[^>]*path="/g) || []
      resolve({ entries: entryMatches.map(() => ({ path: '' })) })
    })
    
    proc.on('error', () => resolve({ entries: [] }))
  })
}
