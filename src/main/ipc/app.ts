import { ipcMain, app, shell } from 'electron'
import { readdir, stat, unlink, rmdir } from 'fs/promises'
import { join } from 'path'

async function getDirectorySize(dirPath: string): Promise<{ size: number; files: number }> {
  let totalSize = 0
  let fileCount = 0
  
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      
      if (entry.isDirectory()) {
        const subDir = await getDirectorySize(fullPath)
        totalSize += subDir.size
        fileCount += subDir.files
      } else if (entry.isFile()) {
        const stats = await stat(fullPath)
        totalSize += stats.size
        fileCount++
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  
  return { size: totalSize, files: fileCount }
}

async function clearDirectory(dirPath: string): Promise<void> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      
      if (entry.isDirectory()) {
        await clearDirectory(fullPath)
        await rmdir(fullPath)
      } else {
        await unlink(fullPath)
      }
    }
  } catch {
    // File/directory doesn't exist or can't be deleted
  }
}

export function registerAppHandlers(): void {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('app:getPath', (_, name: 'home' | 'appData' | 'desktop' | 'documents') => {
    return app.getPath(name)
  })

  ipcMain.handle('app:openExternal', async (_, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('app:clearCache', async () => {
    try {
      const userDataPath = app.getPath('userData')
      
      // Clear specific cache directories
      const cacheDirs = [
        join(userDataPath, 'Cache'),
        join(userDataPath, 'Code Cache'),
        join(userDataPath, 'GPUCache'),
        join(userDataPath, 'DawnCache'),
        join(userDataPath, 'GrShaderCache'),
      ]
      
      // Clear log cache (our custom cache)
      const logCachePath = join(userDataPath, 'shelly-cache', 'logs')
      cacheDirs.push(logCachePath)
      
      for (const cacheDir of cacheDirs) {
        await clearDirectory(cacheDir)
      }
      
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('app:getCacheSize', async () => {
    try {
      const userDataPath = app.getPath('userData')
      
      const cacheDirs = [
        join(userDataPath, 'Cache'),
        join(userDataPath, 'Code Cache'),
        join(userDataPath, 'GPUCache'),
        join(userDataPath, 'DawnCache'),
        join(userDataPath, 'GrShaderCache'),
        join(userDataPath, 'shelly-cache', 'logs'),
      ]
      
      let totalSize = 0
      let totalFiles = 0
      
      for (const cacheDir of cacheDirs) {
        const result = await getDirectorySize(cacheDir)
        totalSize += result.size
        totalFiles += result.files
      }
      
      return { size: totalSize, files: totalFiles }
    } catch {
      return { size: 0, files: 0 }
    }
  })
}
