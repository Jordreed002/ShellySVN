import { ipcMain } from 'electron'
import { readdir, stat, copyFile as fsCopyFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, normalize, dirname } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { platform } from 'os'
import type { FileInfo, SvnStatusChar } from '@shared/types'

interface SvnStatusEntry {
  status: SvnStatusChar
  revision?: number
  author?: string
  fullPath: string
}

export interface SvnStatusMap {
  [filename: string]: {
    status: SvnStatusChar
    revision?: number
    author?: string
  }
}

// Map SVN XML item attribute values to single-char status codes
const SVN_STATUS_MAP: Record<string, SvnStatusChar> = {
  'normal': ' ',
  'added': 'A',
  'conflicted': 'C',
  'deleted': 'D',
  'ignored': 'I',
  'modified': 'M',
  'replaced': 'R',
  'external': 'X',
  'unversioned': '?',
  'missing': '!',
  'obstructed': '~',
  'incomplete': '!'
}

// Status priority (higher = more important to show)
const STATUS_PRIORITY: Record<SvnStatusChar, number> = {
  'C': 100, '!': 90, '~': 85, 'M': 80, 'D': 70, 'R': 60, 'A': 50, 'X': 40, '?': 30, 'I': 20, ' ': 0
}

function getWorstStatus(a: SvnStatusChar, b: SvnStatusChar): SvnStatusChar {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b
}

/**
 * Parse SVN status XML output into status map and entries
 */
function parseSvnStatusXml(xml: string, baseDir: string): {
  directStatus: SvnStatusMap
  allEntries: SvnStatusEntry[]
} {
  const directStatus: SvnStatusMap = {}
  const allEntries: SvnStatusEntry[] = []
  
  const entryMatches = xml.matchAll(/<entry[^>]*path="([^"]+)"[^>]*>[\s\S]*?<wc-status[^>]*item="([^"]*)"/g)
  
  for (const match of entryMatches) {
    const entryPath = match[1]
    const statusName = match[2]
    const status = SVN_STATUS_MAP[statusName] || ' '
    const fullPath = normalize(entryPath)
    const fileName = basename(entryPath)
    
    allEntries.push({ status, fullPath })
    
    // Direct entries (immediate children)
    const entryParent = normalize(join(entryPath, '..'))
    if (entryParent === normalize(baseDir)) {
      directStatus[fileName] = { status }
    }
  }
  
  return { directStatus, allEntries }
}

/**
 * Get SVN status with configurable depth
 */
async function getSvnStatus(
  dirPath: string, 
  depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'immediates'
): Promise<{ directStatus: SvnStatusMap; allEntries: SvnStatusEntry[] }> {
  return new Promise((resolve) => {
    const svnCommand = process.platform === 'win32' ? 'svn.exe' : 'svn'
    
    const proc = spawn(svnCommand, ['status', '--xml', `--depth=${depth}`, dirPath], {
      cwd: dirPath,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    
    let stdout = ''
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    
    proc.on('close', () => resolve(parseSvnStatusXml(stdout, dirPath)))
    proc.on('error', () => resolve({ directStatus: {}, allEntries: [] }))
  })
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
    return directStatus[folderName].status
  }
  
  const normalizedFolderPath = normalize(folderPath)
  let worstStatus: SvnStatusChar = ' '
  
  for (const entry of allEntries) {
    const normalizedEntryPath = normalize(entry.fullPath)
    if (normalizedEntryPath.startsWith(normalizedFolderPath + '\\') || 
        normalizedEntryPath.startsWith(normalizedFolderPath + '/')) {
      worstStatus = getWorstStatus(worstStatus, entry.status)
    }
  }
  
  return worstStatus
}

/**
 * Check if a directory is under version control
 */
async function isVersioned(dirPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const svnCommand = process.platform === 'win32' ? 'svn.exe' : 'svn'
    const proc = spawn(svnCommand, ['info', '--xml', dirPath], { cwd: dirPath })
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}

/**
 * List directory contents from filesystem only (instant)
 */
async function listDirectoryFiles(dirPath: string): Promise<FileInfo[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: FileInfo[] = []
  
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    
    const fullPath = join(dirPath, entry.name)
    
    try {
      const stats = await stat(fullPath)
      files.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : stats.size,
        modifiedTime: stats.mtime.toISOString(),
        svnStatus: undefined
      })
    } catch { continue }
  }
  
  files.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
  
  return files
}

/**
 * Apply SVN status to file list
 */
export function applySvnStatusToFiles(
  files: FileInfo[], 
  directStatus: SvnStatusMap, 
  allEntries: SvnStatusEntry[]
): FileInfo[] {
  return files.map(file => {
    let svnStatus: FileInfo['svnStatus']
    
    if (file.isDirectory) {
      const folderStatus = calculateFolderStatus(file.path, file.name, allEntries, directStatus)
      if (folderStatus !== ' ') {
        svnStatus = { path: file.path, status: folderStatus, isDirectory: true }
      }
    } else {
      const direct = directStatus[file.name]
      if (direct) {
        svnStatus = {
          path: file.path,
          status: direct.status,
          revision: direct.revision,
          author: direct.author,
          isDirectory: false
        }
      }
    }
    
    return { ...file, svnStatus }
  })
}

// Track active background scans
const activeScans = new Map<string, ChildProcess>()

function cancelDeepScan(dirPath: string) {
  const proc = activeScans.get(dirPath)
  if (proc) {
    proc.kill()
    activeScans.delete(dirPath)
  }
}

/**
 * Background deep scan for folder aggregation
 */
async function startDeepScan(dirPath: string): Promise<{
  directStatus: SvnStatusMap
  allEntries: SvnStatusEntry[]
}> {
  cancelDeepScan(dirPath)
  
  return new Promise((resolve) => {
    const svnCommand = process.platform === 'win32' ? 'svn.exe' : 'svn'
    
    const proc = spawn(svnCommand, ['status', '--xml', '--depth=infinity', dirPath], {
      cwd: dirPath,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    
    activeScans.set(dirPath, proc)
    
    let stdout = ''
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    
    proc.on('close', () => {
      activeScans.delete(dirPath)
      resolve(parseSvnStatusXml(stdout, dirPath))
    })
    
    proc.on('error', () => {
      activeScans.delete(dirPath)
      resolve({ directStatus: {}, allEntries: [] })
    })
  })
}

/**
 * List available drives (Windows) or root mount points (Unix)
 */
async function listDrives(): Promise<FileInfo[]> {
  const files: FileInfo[] = []
  
  if (platform() === 'win32') {
    // Windows: Use wmic to get drive letters
    return new Promise((resolve) => {
      const proc = spawn('wmic', ['logicaldisk', 'get', 'caption,volumename'])
      let stdout = ''
      
      proc.stdout.on('data', (data) => { stdout += data.toString() })
      proc.on('close', () => {
        const lines = stdout.split('\n').slice(1) // Skip header
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          
          const match = trimmed.match(/^([A-Z]:)\s*(.*)/)
          if (match) {
            const driveLetter = match[1]
            const volumeName = match[2].trim() || 'Local Disk'
            
            files.push({
              name: `${volumeName} (${driveLetter})`,
              path: driveLetter + '\\',
              isDirectory: true,
              size: 0,
              modifiedTime: new Date().toISOString(),
              svnStatus: undefined
            })
          }
        }
        resolve(files)
      })
      proc.on('error', () => resolve([]))
    })
  } else {
    // Unix: List /Volumes (macOS) or /mnt (Linux)
    const mountPoints = ['/Volumes', '/mnt', '/media']
    
    for (const mountPoint of mountPoints) {
      if (existsSync(mountPoint)) {
        try {
          const entries = await readdir(mountPoint, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              files.push({
                name: entry.name,
                path: join(mountPoint, entry.name),
                isDirectory: true,
                size: 0,
                modifiedTime: new Date().toISOString(),
                svnStatus: undefined
              })
            }
          }
        } catch { /* skip inaccessible mount points */ }
      }
    }
    
    // Always add root
    files.unshift({
      name: 'Root',
      path: '/',
      isDirectory: true,
      size: 0,
      modifiedTime: new Date().toISOString(),
      svnStatus: undefined
    })
  }
  
  return files
}

/**
 * Get parent directory path
 */
function getParentPath(path: string): string | null {
  if (path === '/' || path === 'DRIVES://') return null
  
  const normalized = normalize(path)
  const parent = dirname(normalized)
  
  // On Windows, if we're at the root of a drive (e.g., C:\), return DRIVES://
  if (platform() === 'win32' && parent.length === 2 && parent[1] === ':') {
    return 'DRIVES://'
  }
  
  // If same as input (we were at root), return null
  if (parent === normalized) return null
  
  return parent
}

/**
 * Calculate folder size recursively
 */
async function calculateFolderSize(folderPath: string): Promise<number> {
  let totalSize = 0
  
  try {
    const entries = await readdir(folderPath, { withFileTypes: true })
    
    for (const entry of entries) {
      // Skip hidden files and common exclude patterns
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.svn') continue
      
      const fullPath = join(folderPath, entry.name)
      
      try {
        if (entry.isDirectory()) {
          totalSize += await calculateFolderSize(fullPath)
        } else if (entry.isFile()) {
          const stats = await stat(fullPath)
          totalSize += stats.size
        }
      } catch {
        // Skip files/folders we can't access
        continue
      }
    }
  } catch {
    // Can't read directory
    return 0
  }
  
  return totalSize
}

/**
 * Calculate sizes for multiple folders
 */
async function calculateFolderSizes(folderPaths: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {}
  
  for (const folderPath of folderPaths) {
    results[folderPath] = await calculateFolderSize(folderPath)
  }
  
  return results
}

export function registerFsHandlers(): void {
  // Fast directory listing (filesystem only, no SVN)
  ipcMain.handle('fs:listDirectory', async (_, path: string): Promise<FileInfo[]> => {
    try {
      // Handle special DRIVES:// path for listing drives
      if (path === 'DRIVES://') {
        return listDrives()
      }
      return listDirectoryFiles(path)
    } catch (error) {
      console.error('[FS] List error:', error)
      return []
    }
  })
  
  // List available drives
  ipcMain.handle('fs:listDrives', async (): Promise<FileInfo[]> => {
    try {
      return listDrives()
    } catch (error) {
      console.error('[FS] List drives error:', error)
      return []
    }
  })
  
  // Get parent directory
  ipcMain.handle('fs:getParent', async (_, path: string): Promise<string | null> => {
    return getParentPath(path)
  })
  
  // Shallow SVN status (fast, --depth=immediates)
  ipcMain.handle('fs:getStatus', async (_, path: string) => {
    try {
      // Don't get SVN status for drives list
      if (path === 'DRIVES://') {
        return { directStatus: {}, allEntries: [] }
      }
      return getSvnStatus(path, 'immediates')
    } catch (error) {
      console.error('[FS] Status error:', error)
      return { directStatus: {}, allEntries: [] }
    }
  })
  
  // Deep SVN status (slower, --depth=infinity) for folder aggregation
  ipcMain.handle('fs:getDeepStatus', async (_, path: string) => {
    try {
      // Don't get SVN status for drives list
      if (path === 'DRIVES://') {
        return { directStatus: {}, allEntries: [] }
      }
      return startDeepScan(path)
    } catch (error) {
      console.error('[FS] Deep status error:', error)
      return { directStatus: {}, allEntries: [] }
    }
  })
  
  // Apply status to files (helper for renderer)
  ipcMain.handle('fs:applyStatus', async (_, files: FileInfo[], directStatus: SvnStatusMap, allEntries: SvnStatusEntry[]) => {
    return applySvnStatusToFiles(files, directStatus, allEntries)
  })
  
  // Check if versioned
  ipcMain.handle('fs:isVersioned', async (_, path: string): Promise<boolean> => {
    // Drives list is never versioned
    if (path === 'DRIVES://') return false
    return isVersioned(path)
  })
  
  // Read file content
  ipcMain.handle('fs:readFile', async (_, path: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      const fs = await import('fs')
      const stats = fs.statSync(path)
      
      // Limit file size to 1MB for preview
      if (stats.size > 1024 * 1024) {
        return { success: false, error: 'File too large for preview (>1MB)' }
      }
      
      const content = fs.readFileSync(path, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  
  // Cancel active scan
  ipcMain.handle('fs:cancelScan', async (_, path: string) => {
    cancelDeepScan(path)
  })
  
  // Calculate folder sizes (can be slow for large directories)
  ipcMain.handle('fs:getFolderSizes', async (_, folderPaths: string[]): Promise<Record<string, number>> => {
    try {
      return calculateFolderSizes(folderPaths)
    } catch (error) {
      console.error('[FS] Folder size error:', error)
      return {}
    }
  })
  
  // Copy file (for non-versioned files)
  ipcMain.handle('fs:copyFile', async (_, source: string, target: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Ensure target directory exists
      const targetDir = dirname(target)
      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true })
      }
      
      await fsCopyFile(source, target)
      return { success: true }
    } catch (err) {
      console.error('[FS] Copy file error:', err)
      return { success: false, error: (err as Error).message }
    }
  })
}
