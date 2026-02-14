import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { XMLParser } from 'fast-xml-parser'
import type { 
  SvnStatusResult, SvnLogResult, SvnInfoResult, SvnDiffResult, 
  SvnDiffFile, SvnDiffHunk, SvnChangelistResult, SvnShelveListResult, 
  CheckoutOptions, SvnBlameResult, SvnListResult, SvnPatchResult, SvnExternal,
  SvnExecutionContext
} from '@shared/types'

/**
 * XML parser configuration
 * Always validate and parse attributes for proper XML handling
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true
})

/**
 * SSL failure types that can be bypassed
 * SECURITY: 'other' is excluded as it's too broad and may bypass security checks
 */
const ALLOWED_SSL_FAILURES = ['unknown-ca', 'hostname-mismatch', 'expired', 'not-yet-valid'] as const

/**
 * Create a temporary SVN config directory with proxy settings
 * SECURITY: This avoids putting credentials in environment variables
 */
async function createTempSvnConfig(
  proxySettings: SvnExecutionContext['proxySettings']
): Promise<string | null> {
  if (!proxySettings?.enabled || !proxySettings.host || !proxySettings.port) {
    return null
  }
  
  const configDir = await mkdtemp(join(tmpdir(), 'svn-config-'))
  const serversPath = join(configDir, 'servers')
  const serversDir = dirname(serversPath)
  
  if (!existsSync(serversDir)) {
    mkdirSync(serversDir, { recursive: true })
  }
  
  // Build servers config file
  const configLines = [
    '[global]',
    `http-proxy-host = ${proxySettings.host}`,
    `http-proxy-port = ${proxySettings.port}`,
  ]
  
  if (proxySettings.username) {
    configLines.push(`http-proxy-username = ${proxySettings.username}`)
  }
  
  if (proxySettings.password) {
    // SECURITY: Password stored in temp file with restricted permissions
    // File is deleted after SVN operation completes
    configLines.push(`http-proxy-password = ${proxySettings.password}`)
  }
  
  if (proxySettings.bypassForLocal) {
    configLines.push('http-proxy-exceptions = localhost, 127.0.0.1')
  }
  
  await writeFile(serversPath, configLines.join('\n'), { mode: 0o600 })
  
  return configDir
}

/**
 * Clean up temporary SVN config directory
 */
async function cleanupTempSvnConfig(configDir: string): Promise<void> {
  try {
    await rm(configDir, { recursive: true, force: true })
  } catch (error) {
    console.warn('[SVN] Failed to cleanup temp config dir:', error)
  }
}

/**
 * Execute SVN command directly (for development)
 * In production, this would use the bundled logic engine
 */
async function executeSvn(
  args: string[], 
  cwd?: string, 
  context?: SvnExecutionContext
): Promise<string> {
  // Create temp config if proxy settings are provided
  let tempConfigDir: string | null = null
  
  if (context?.proxySettings?.enabled) {
    tempConfigDir = await createTempSvnConfig(context.proxySettings)
  }
  
  return new Promise((resolve, reject) => {
    // Use system SVN for development
    const svnCommand = process.platform === 'win32' ? 'svn.exe' : 'svn'
    
    // Build environment - no credentials in environment variables
    const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'en_US.UTF-8' }
    
    // Build final args
    const finalArgs: string[] = []
    
    // Add config directory if using proxy
    if (tempConfigDir) {
      finalArgs.push('--config-dir', tempConfigDir)
    }
    
    finalArgs.push(...args)
    
    // Build SSL options if needed
    if (context?.sslVerify === false) {
      // Add SSL trust options for non-interactive mode
      if (!finalArgs.includes('--non-interactive')) {
        finalArgs.push('--non-interactive')
      }
      
      // SECURITY: Only allow specific failure types, exclude 'other'
      const failures = ALLOWED_SSL_FAILURES.join(',')
      finalArgs.push('--trust-server-cert-failures', failures)
      
      // Log SSL bypass for security audit
      console.warn(`[SECURITY] SSL verification bypassed for: ${cwd || process.cwd()}`)
    }
    
    console.log(`[SVN] Running: svn ${finalArgs.join(' ')} in ${cwd || process.cwd()}`)
    
    const proc = spawn(svnCommand, finalArgs, {
      cwd: cwd || process.cwd(),
      env,
      windowsHide: true  // Hide from process listing on Windows
    })
    
    let stdout = ''
    let stderr = ''
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    
    // Set up timeout if specified
    let timeoutId: NodeJS.Timeout | null = null
    if (context?.connectionTimeout && context.connectionTimeout > 0) {
      timeoutId = setTimeout(() => {
        proc.kill()
        if (tempConfigDir) cleanupTempSvnConfig(tempConfigDir)
        reject(new Error(`SVN operation timed out after ${context.connectionTimeout} seconds`))
      }, context.connectionTimeout * 1000)
    }
    
    proc.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (tempConfigDir) cleanupTempSvnConfig(tempConfigDir)
      
      console.log(`[SVN] Exit code: ${code}`)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `SVN exited with code ${code}`))
      }
    })
    
    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (tempConfigDir) cleanupTempSvnConfig(tempConfigDir)
      console.error(`[SVN] Error:`, err)
      reject(err)
    })
  })
}

/**
 * Parse SVN status XML output using proper XML parser
 */
function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  const entries: SvnStatusResult['entries'] = []
  
  try {
    const parsed = xmlParser.parse(xml) as {
      status?: {
        target?: {
          '@_path'?: string
          entry?: Array<{
            '@_path': string
            'wc-status'?: {
              '@_item': string
              '@_revision'?: string
              commit?: {
                '@_revision': string
                author?: string
                date?: string
              }
            }
          }> | {
            '@_path': string
            'wc-status'?: {
              '@_item': string
              '@_revision'?: string
              commit?: {
                '@_revision': string
                author?: string
                date?: string
              }
            }
          }
        }
      }
    }
    
    const target = parsed.status?.target
    if (!target) {
      return { path: basePath, entries: [], revision: 0 }
    }
    
    const entryList = target.entry
    if (!entryList) {
      return { path: basePath, entries: [], revision: 0 }
    }
    
    // Handle single entry (not array) or array of entries
    const entriesArray = Array.isArray(entryList) ? entryList : [entryList]
    
    for (const entry of entriesArray) {
      if (!entry || typeof entry !== 'object') continue
      
      const wcStatus = entry['wc-status']
      if (!wcStatus) continue
      
      const path = entry['@_path'] || ''
      const status = wcStatus['@_item'] || 'normal'
      
      // Extract commit info if present
      let revision: number | undefined
      let author: string | undefined
      let date: string | undefined
      
      if (wcStatus.commit) {
        revision = wcStatus.commit['@_revision'] ? parseInt(wcStatus.commit['@_revision'], 10) : undefined
        author = wcStatus.commit.author
        date = wcStatus.commit.date
      }
      
      entries.push({
        path,
        status: status as SvnStatusResult['entries'][0]['status'],
        revision,
        author,
        date,
        isDirectory: false // Will be determined by file system check if needed
      })
    }
  } catch (error) {
    console.error('[SVN] Failed to parse status XML:', error)
    // Return empty result on parse error
  }
  
  return {
    path: basePath,
    entries,
    revision: 0
  }
}

/**
 * Parse SVN info XML output using proper XML parser
 */
function parseSvnInfoXml(xml: string): SvnInfoResult {
  try {
    const parsed = xmlParser.parse(xml) as {
      info?: {
        entry?: {
          '@_path'?: string
          '@_revision'?: string
          url?: string
          repository?: {
            root?: string
            uuid?: string
          }
          commit?: {
            '@_revision'?: string
            author?: string
            date?: string
          }
        }
      }
    }
    
    const entry = parsed.info?.entry
    if (!entry) {
      return {
        path: '',
        url: '',
        repositoryRoot: '',
        repositoryUuid: '',
        revision: 0,
        nodeKind: 'dir',
        lastChangedAuthor: '',
        lastChangedRevision: 0,
        lastChangedDate: ''
      }
    }
    
    const revision = entry['@_revision'] ? parseInt(entry['@_revision'], 10) : 0
    const commitRevision = entry.commit?.['@_revision'] ? parseInt(entry.commit['@_revision'], 10) : 0
    
    return {
      path: entry['@_path'] || '',
      url: entry.url || '',
      repositoryRoot: entry.repository?.root || '',
      repositoryUuid: entry.repository?.uuid || '',
      revision,
      nodeKind: 'dir',
      lastChangedAuthor: entry.commit?.author || '',
      lastChangedRevision: commitRevision,
      lastChangedDate: entry.commit?.date || ''
    }
  } catch (error) {
    console.error('[SVN] Failed to parse info XML:', error)
    return {
      path: '',
      url: '',
      repositoryRoot: '',
      repositoryUuid: '',
      revision: 0,
      nodeKind: 'dir',
      lastChangedAuthor: '',
      lastChangedRevision: 0,
      lastChangedDate: ''
    }
  }
}

/**
 * Parse SVN log XML output using proper XML parser
 */
function parseSvnLogXml(xml: string): SvnLogResult {
  const entries: SvnLogResult['entries'] = []
  
  try {
    const parsed = xmlParser.parse(xml) as {
      log?: {
        logentry?: Array<{
          '@_revision': string
          author?: string
          date?: string
          msg?: string
          paths?: {
            path?: Array<{
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }> | {
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }
          }
        }> | {
          '@_revision': string
          author?: string
          date?: string
          msg?: string
          paths?: {
            path?: Array<{
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }> | {
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }
          }
        }
      }
    }
    
    const logEntries = parsed.log?.logentry
    if (!logEntries) {
      return { entries: [], startRevision: 0, endRevision: 0 }
    }
    
    // Handle single entry (not array) or array of entries
    const entriesArray = Array.isArray(logEntries) ? logEntries : [logEntries]
    
    for (const entry of entriesArray) {
      if (!entry || typeof entry !== 'object') continue
      
      // Parse paths if present
      const paths: Array<{ path: string; action: 'A' | 'D' | 'M' | 'R'; kind: string }> = []
      if (entry.paths?.path) {
        const pathList = Array.isArray(entry.paths.path) ? entry.paths.path : [entry.paths.path]
        for (const p of pathList) {
          if (p && typeof p === 'object') {
            paths.push({
              path: p['#text'] || '',
              action: (p['@_action'] || '') as 'A' | 'D' | 'M' | 'R',
              kind: p['@_kind'] || ''
            })
          }
        }
      }
      
      entries.push({
        revision: parseInt(entry['@_revision'], 10) || 0,
        author: entry.author || 'unknown',
        date: entry.date || '',
        message: entry.msg || '',
        paths
      })
    }
  } catch (error) {
    console.error('[SVN] Failed to parse log XML:', error)
    // Return empty result on parse error
  }
  
  const revisions = entries.map(e => e.revision)
  
  return {
    entries,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0
  }
}

/**
 * Parse unified diff output into structured format
 */
function parseSvnDiff(diffOutput: string): SvnDiffResult {
  if (!diffOutput || diffOutput.trim() === '') {
    return { files: [], hasChanges: false }
  }
  
  // Check for binary file indicator
  if (diffOutput.includes('Cannot display: file marked as a binary type')) {
    return {
      files: [],
      hasChanges: true,
      isBinary: true,
      rawDiff: diffOutput
    }
  }
  
  const files: SvnDiffFile[] = []
  const lines = diffOutput.split('\n')
  
  let currentFile: SvnDiffFile | null = null
  let currentHunk: SvnDiffHunk | null = null
  let oldLineNum = 0
  let newLineNum = 0
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Index line indicates start of file diff
    if (line.startsWith('Index: ')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk)
      }
      if (currentFile) {
        files.push(currentFile)
      }
      currentFile = {
        oldPath: '',
        newPath: '',
        hunks: []
      }
      currentHunk = null
      continue
    }
    
    // === separator
    if (line.startsWith('=======')) {
      continue
    }
    
    // --- indicates old file path
    if (line.startsWith('--- ')) {
      if (currentFile) {
        currentFile.oldPath = line.substring(4).trim()
      }
      continue
    }
    
    // +++ indicates new file path
    if (line.startsWith('+++ ')) {
      if (currentFile) {
        currentFile.newPath = line.substring(4).trim()
      }
      continue
    }
    
    // Hunk header @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunkMatch) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk)
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: []
      }
      oldLineNum = currentHunk.oldStart
      newLineNum = currentHunk.newStart
      
      // Add the hunk header line
      currentHunk.lines.push({
        type: 'hunk',
        content: line
      })
      continue
    }
    
    // Diff content lines (only if we're in a hunk)
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'added',
          content: line,
          newLineNumber: newLineNum++
        })
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'removed',
          content: line,
          oldLineNumber: oldLineNum++
        })
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++
        })
      } else if (line === '') {
        // Empty line is context
        currentHunk.lines.push({
          type: 'context',
          content: '',
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++
        })
      }
    }
  }
  
  // Don't forget last hunk and file
  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk)
  }
  if (currentFile) {
    files.push(currentFile)
  }
  
  return {
    files,
    hasChanges: files.length > 0
  }
}

export function registerSvnHandlers(): void {
  // SVN Status
  ipcMain.handle('svn:status', async (_, path: string): Promise<SvnStatusResult> => {
    try {
      const xml = await executeSvn(['status', '--xml', path])
      return parseSvnStatusXml(xml, path)
    } catch (error) {
      console.error('[SVN] Status error:', error)
      // Return empty result instead of throwing
      return { path, entries: [], revision: 0 }
    }
  })

  // SVN Log
  ipcMain.handle('svn:log', async (_, path: string, limit = 100): Promise<SvnLogResult> => {
    try {
      const xml = await executeSvn(['log', '--xml', '-l', String(limit), path])
      return parseSvnLogXml(xml)
    } catch (error) {
      console.error('[SVN] Log error:', error)
      return { entries: [], startRevision: 0, endRevision: 0 }
    }
  })

  // SVN Info
  ipcMain.handle('svn:info', async (_, path: string): Promise<SvnInfoResult> => {
    try {
      const xml = await executeSvn(['info', '--xml', path])
      return parseSvnInfoXml(xml)
    } catch (error) {
      console.error('[SVN] Info error:', error)
      throw error
    }
  })
  
  // SVN Diff
  ipcMain.handle('svn:diff', async (_, path: string, revision?: string): Promise<SvnDiffResult> => {
    try {
      const args = ['diff']
      if (revision) {
        args.push('-c', revision)
      }
      args.push(path)
      
      const output = await executeSvn(args)
      return parseSvnDiff(output)
    } catch (error) {
      console.error('[SVN] Diff error:', error)
      return { files: [], hasChanges: false, rawDiff: (error as Error).message }
    }
  })

  // SVN Update
  ipcMain.handle('svn:update', async (_, path: string) => {
    const output = await executeSvn(['update', path])
    const match = output.match(/Updated to revision (\d+)\./)
    return { 
      success: true, 
      revision: match ? parseInt(match[1], 10) : 0 
    }
  })

  // SVN Commit
  ipcMain.handle('svn:commit', async (_, paths: string[], message: string) => {
    const output = await executeSvn(['commit', '-m', message, ...paths])
    const match = output.match(/Committed revision (\d+)\./)
    return { 
      success: true, 
      revision: match ? parseInt(match[1], 10) : 0 
    }
  })

  // SVN Revert
  ipcMain.handle('svn:revert', async (_, paths: string[]) => {
    await executeSvn(['revert', ...paths])
    return { success: true }
  })

  // SVN Add
  ipcMain.handle('svn:add', async (_, paths: string[]) => {
    await executeSvn(['add', ...paths])
    return { success: true }
  })

  // SVN Delete
  ipcMain.handle('svn:delete', async (_, paths: string[]) => {
    await executeSvn(['delete', ...paths])
    return { success: true }
  })

  // SVN Cleanup
  ipcMain.handle('svn:cleanup', async (_, path: string) => {
    await executeSvn(['cleanup', path])
    return { success: true }
  })

  // SVN Checkout
  ipcMain.handle('svn:checkout', async (_, url: string, path: string, revision?: string, depth?: 'empty' | 'files' | 'immediates' | 'infinity', options?: CheckoutOptions) => {
    const args = ['checkout', '--non-interactive']
    
    // Add revision if specified
    if (revision) args.push('-r', revision)
    
    // Add depth if specified
    if (depth) args.push('--depth', depth)
    
    // Add SSL trust options
    if (options?.trustSsl) {
      // Map failure types to SVN's expected format
      const failures = options.sslFailures || ['unknown-ca']
      const failureStr = failures.map(f => {
        switch (f) {
          case 'untrusted-issuer':
          case 'unknown-ca':
            return 'unknown-ca'
          case 'hostname-mismatch':
            return 'hostname-mismatch'
          case 'expired':
            return 'expired'
          case 'not-yet-valid':
            return 'not-yet-valid'
          default:
            return 'other'
        }
      }).join(',')
      
      if (options.trustPermanently) {
        args.push('--trust-server-cert-failures', failureStr)
      } else {
        // For temporary trust, still use the failures flag
        args.push('--trust-server-cert-failures', failureStr)
      }
    }
    
    // Add credentials if provided
    if (options?.credentials) {
      args.push('--username', options.credentials.username)
      if (options.credentials.password) {
        args.push('--password', options.credentials.password)
      }
    }
    
    // Add URL and path
    args.push(url, path)
    
    try {
      const output = await executeSvn(args)
      const match = output.match(/Checked out revision (\d+)\./)
      return { 
        success: true, 
        revision: match ? parseInt(match[1], 10) : 0,
        output
      }
    } catch (error) {
      // Return error with output for parsing
      const errorMsg = (error as Error).message || 'Checkout failed'
      return {
        success: false,
        revision: 0,
        output: errorMsg
      }
    }
  })

  // SVN Export
  ipcMain.handle('svn:export', async (_, url: string, path: string, revision?: string) => {
    const args = ['export', url, path]
    if (revision) args.push('-r', revision)
    const output = await executeSvn(args)
    const match = output.match(/Exported revision (\d+)\./)
    return { 
      success: true, 
      revision: match ? parseInt(match[1], 10) : 0,
      output
    }
  })

  // SVN Import
  ipcMain.handle('svn:import', async (_, path: string, url: string, message: string) => {
    const output = await executeSvn(['import', '-m', message, path, url])
    const match = output.match(/Committed revision (\d+)\./)
    return { 
      success: true, 
      revision: match ? parseInt(match[1], 10) : 0,
      output
    }
  })

  // SVN Lock
  ipcMain.handle('svn:lock', async (_, path: string, message?: string) => {
    const args = ['lock']
    if (message) args.push('-m', message)
    args.push(path)
    const output = await executeSvn(args)
    return { success: true, output }
  })

  // SVN Unlock
  ipcMain.handle('svn:unlock', async (_, path: string, force?: boolean) => {
    const args = ['unlock']
    if (force) args.push('--force')
    args.push(path)
    const output = await executeSvn(args)
    return { success: true, output }
  })

  // SVN Resolve
  ipcMain.handle('svn:resolve', async (_, path: string, resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict') => {
    await executeSvn(['resolve', '--accept', resolution, path])
    return { success: true }
  })

  // SVN Switch
  ipcMain.handle('svn:switch', async (_, path: string, url: string, revision?: string) => {
    const args = ['switch', url, path]
    if (revision) args.push('-r', revision)
    const output = await executeSvn(args)
    const match = output.match(/Updated to revision (\d+)\./)
    return { 
      success: true, 
      revision: match ? parseInt(match[1], 10) : 0,
      output
    }
  })

  // SVN Copy (Branch/Tag)
  ipcMain.handle('svn:copy', async (_, src: string, dst: string, message: string) => {
    const output = await executeSvn(['copy', '-m', message, src, dst])
    const match = output.match(/Committed revision (\d+)\./)
    return { 
      success: true, 
      revision: match ? parseInt(match[1], 10) : 0,
      output
    }
  })

  // SVN Merge
  ipcMain.handle('svn:merge', async (_, source: string, target: string, revisions?: string[], ranges?: Array<{ start: number; end: number }>) => {
    const args = ['merge', source, target]
    if (revisions && revisions.length > 0) {
      args.push('-c', revisions.join(','))
    }
    if (ranges && ranges.length > 0) {
      for (const range of ranges) {
        args.push('-r', `${range.start}:${range.end}`)
      }
    }
    const output = await executeSvn(args)
    return { success: true, output }
  })

  // SVN Relocate
  ipcMain.handle('svn:relocate', async (_, from: string, to: string, path: string) => {
    const output = await executeSvn(['relocate', from, to, path])
    return { success: true, output }
  })

  // SVN Changelist - Add to changelist
  ipcMain.handle('svn:changelist:add', async (_, paths: string[], changelist: string) => {
    await executeSvn(['changelist', changelist, ...paths])
    return { success: true }
  })

  // SVN Changelist - Remove from changelist
  ipcMain.handle('svn:changelist:remove', async (_, paths: string[]) => {
    await executeSvn(['changelist', '--remove', ...paths])
    return { success: true }
  })

  // SVN Changelist - List changelists
  ipcMain.handle('svn:changelist:list', async (_, path: string): Promise<SvnChangelistResult> => {
    try {
      const xml = await executeSvn(['status', '--xml', path])
      const changelists: Map<string, string[]> = new Map()
      const defaultFiles: string[] = []
      
      // Parse changelist info from status XML
      const entryMatches = xml.matchAll(/<entry[^>]*path="([^"]+)"[^>]*>[\s\S]*?(<changelist[^>]*>([^<]*)<\/changelist>)?/g)
      
      for (const match of entryMatches) {
        const filePath = match[1]
        const changelistName = match[3]
        
        if (changelistName) {
          if (!changelists.has(changelistName)) {
            changelists.set(changelistName, [])
          }
          changelists.get(changelistName)!.push(filePath)
        } else {
          defaultFiles.push(filePath)
        }
      }
      
      return {
        changelists: Array.from(changelists.entries()).map(([name, files]) => ({ name, files })),
        defaultFiles
      }
    } catch {
      return { changelists: [], defaultFiles: [] }
    }
  })

  // SVN Changelist - Create new changelist
  ipcMain.handle('svn:changelist:create', async (_, _name: string, _comment?: string) => {
    // Changelists are created implicitly when files are added to them
    // This handler exists for consistency but doesn't need to do anything
    // The UI should use changelist.add to add files, which creates the changelist automatically
    return { success: true }
  })

  // SVN Changelist - Delete changelist (remove all files from it)
  ipcMain.handle('svn:changelist:delete', async (_, name: string, path: string) => {
    try {
      // Get all files in this changelist
      const xml = await executeSvn(['status', '--xml', path])
      
      // Parse to find files in this changelist
      const filesToRemove: string[] = []
      const entryMatches = xml.matchAll(/<entry[^>]*path="([^"]+)"[^>]*>[\s\S]*?(<changelist[^>]*>([^<]*)<\/changelist>)?/g)
      
      for (const match of entryMatches) {
        const filePath = match[1]
        const changelistName = match[3]
        
        if (changelistName === name) {
          filesToRemove.push(filePath)
        }
      }
      
      // Remove all files from the changelist
      if (filesToRemove.length > 0) {
        await executeSvn(['changelist', '--remove', ...filesToRemove])
      }
      
      return { success: true }
    } catch (error) {
      console.error('[SVN] Changelist delete error:', error)
      return { success: false }
    }
  })

  // SVN Move
  ipcMain.handle('svn:move', async (_, src: string, dst: string) => {
    const output = await executeSvn(['move', src, dst])
    return { success: true, output }
  })

  // SVN Rename
  ipcMain.handle('svn:rename', async (_, src: string, dst: string) => {
    const output = await executeSvn(['move', src, dst]) // svn rename is an alias for move
    return { success: true, output }
  })

  // SVN Shelve - List shelves
  ipcMain.handle('svn:shelve:list', async (_, path: string): Promise<SvnShelveListResult> => {
    try {
      const output = await executeSvn(['shelve', '--list', '--xml', path])
      // Parse shelves from XML
      const shelves: SvnShelveListResult['shelves'] = []
      const shelfMatches = output.matchAll(/<shelf[^>]*name="([^"]+)"[^>]*>[\s\S]*?<path>([^<]+)<\/path>[\s\S]*?<date>([^<]+)<\/date>/g)
      for (const match of shelfMatches) {
        shelves.push({
          name: match[1],
          path: match[2],
          date: match[3]
        })
      }
      return { shelves }
    } catch {
      return { shelves: [] }
    }
  })

  // SVN Shelve - Save
  ipcMain.handle('svn:shelve:save', async (_, name: string, path: string, message?: string) => {
    const args = ['shelve', name]
    if (message) args.push('-m', message)
    args.push(path)
    await executeSvn(args)
    return { success: true }
  })

  // SVN Shelve - Apply
  ipcMain.handle('svn:shelve:apply', async (_, name: string, path: string) => {
    await executeSvn(['unshelve', name, path])
    return { success: true }
  })

  // SVN Shelve - Delete
  ipcMain.handle('svn:shelve:delete', async (_, name: string, path: string) => {
    await executeSvn(['shelve', '--delete', name, path])
    return { success: true }
  })

  // SVN Proplist
  ipcMain.handle('svn:proplist', async (_, path: string) => {
    const output = await executeSvn(['proplist', '--xml', '-v', path])
    const props: { name: string; value: string }[] = []
    const propMatches = output.matchAll(/<property[^>]*name="([^"]+)"[^>]*>([^<]*)<\/property>/g)
    for (const match of propMatches) {
      props.push({ name: match[1], value: match[2] })
    }
    return props
  })

  // SVN Propset
  ipcMain.handle('svn:propset', async (_, path: string, name: string, value: string) => {
    await executeSvn(['propset', name, value, path])
    return { success: true }
  })

  // SVN Propdel
  ipcMain.handle('svn:propdel', async (_, path: string, name: string) => {
    await executeSvn(['propdel', name, path])
    return { success: true }
  })
  
  // ============================================
  // SVN Blame (Annotate)
  // ============================================
  
  ipcMain.handle('svn:blame', async (_, path: string, startRevision?: number, endRevision?: number): Promise<SvnBlameResult> => {
    try {
      const args = ['blame', '--xml', '-v']
      if (startRevision !== undefined && endRevision !== undefined) {
        args.push('-r', `${startRevision}:${endRevision}`)
      }
      args.push(path)
      
      const xml = await executeSvn(args)
      return parseSvnBlameXml(xml, path)
    } catch (error) {
      console.error('[SVN] Blame error:', error)
      return { path, lines: [], startRevision: 0, endRevision: 0 }
    }
  })
  
  // ============================================
  // SVN List (Repository Browser)
  // ============================================
  
  ipcMain.handle('svn:list', async (_, url: string, revision?: string, depth?: 'empty' | 'immediates' | 'infinity'): Promise<SvnListResult> => {
    try {
      const args = ['list', '--xml', '-v']
      if (revision) args.push('-r', revision)
      if (depth) args.push('--depth', depth)
      args.push(url)
      
      const xml = await executeSvn(args)
      return parseSvnListXml(xml, url)
    } catch (error) {
      console.error('[SVN] List error:', error)
      return { path: url, entries: [] }
    }
  })
  
  // ============================================
  // SVN Patch Operations
  // ============================================
  
  ipcMain.handle('svn:patch:create', async (_, paths: string[], outputPath: string): Promise<{ success: boolean; output: string }> => {
    try {
      const args = ['diff', ...paths]
      const output = await executeSvn(args)
      
      // Write patch to file
      await writeFile(outputPath, output, 'utf-8')
      return { success: true, output }
    } catch (error) {
      console.error('[SVN] Patch create error:', error)
      return { success: false, output: (error as Error).message }
    }
  })
  
  ipcMain.handle('svn:patch:apply', async (_, patchPath: string, targetPath: string, dryRun?: boolean): Promise<SvnPatchResult> => {
    try {
      const args = ['patch', patchPath, targetPath]
      if (dryRun) args.push('--dry-run')
      
      const output = await executeSvn(args)
      
      // Parse output for stats
      const filesPatchedMatch = output.match(/Patched\s+(\d+)\s+files?/i)
      const rejectsMatch = output.match(/(\d+)\s+rejects?/i)
      
      return {
        success: !output.includes('FAILED') && !output.includes('rejected'),
        filesPatched: filesPatchedMatch ? parseInt(filesPatchedMatch[1], 10) : 0,
        rejects: rejectsMatch ? parseInt(rejectsMatch[1], 10) : 0,
        output
      }
    } catch (error) {
      console.error('[SVN] Patch apply error:', error)
      return {
        success: false,
        filesPatched: 0,
        rejects: 0,
        output: (error as Error).message
      }
    }
  })
  
  // ============================================
  // SVN Externals Management
  // ============================================
  
  ipcMain.handle('svn:externals:list', async (_, path: string): Promise<SvnExternal[]> => {
    try {
      const output = await executeSvn(['propget', 'svn:externals', '-R', path])
      return parseSvnExternals(output, path)
    } catch (error) {
      console.error('[SVN] Externals list error:', error)
      return []
    }
  })
  
  ipcMain.handle('svn:externals:add', async (_, workingCopyPath: string, external: Omit<SvnExternal, 'name'> & { name?: string }): Promise<{ success: boolean }> => {
    try {
      // Get current externals
      let current = ''
      try {
        current = await executeSvn(['propget', 'svn:externals', workingCopyPath])
      } catch {
        // No existing externals
      }
      
      // Build external definition string
      const extName = external.name || external.path.split('/').pop() || 'external'
      let extDef = ''
      if (external.revision) {
        extDef = `-r${external.revision} `
      }
      extDef += `${external.url} ${extName}`
      
      // Append new external
      const newValue = current.trim() ? `${current.trim()}\n${extDef}` : extDef
      
      await executeSvn(['propset', 'svn:externals', newValue, workingCopyPath])
      return { success: true }
    } catch (error) {
      console.error('[SVN] Externals add error:', error)
      return { success: false }
    }
  })
  
  ipcMain.handle('svn:externals:remove', async (_, workingCopyPath: string, externalPath: string): Promise<{ success: boolean }> => {
    try {
      const current = await executeSvn(['propget', 'svn:externals', workingCopyPath])
      const lines = current.split('\n').filter(l => {
        // Check if this line contains the external path or name
        const parts = l.trim().split(/\s+/)
        const name = parts[parts.length - 1]
        return name !== externalPath && !l.includes(externalPath)
      })
      
      if (lines.length > 0 && lines.some(l => l.trim())) {
        await executeSvn(['propset', 'svn:externals', lines.join('\n'), workingCopyPath])
      } else {
        await executeSvn(['propdel', 'svn:externals', workingCopyPath])
      }
      return { success: true }
    } catch (error) {
      console.error('[SVN] Externals remove error:', error)
      return { success: false }
    }
  })
}

// ============================================
// Parsing Functions
// ============================================

function parseSvnBlameXml(xml: string, path: string): SvnBlameResult {
  const lines: SvnBlameResult['lines'] = []
  
  // SVN blame XML format:
  // <blame><target path="..."><entry line-number="1">...
  const entryMatches = xml.matchAll(/<entry[^>]*line-number="(\d+)"[^>]*>([\s\S]*?)<\/entry>/g)
  
  for (const match of entryMatches) {
    const lineNumber = parseInt(match[1], 10)
    const content = match[2]
    
    const revMatch = content.match(/<commit[^>]*revision="(\d+)"/)
    const authorMatch = content.match(/<author>([^<]+)<\/author>/)
    const dateMatch = content.match(/<date>([^<]+)<\/date>/)
    const textMatch = content.match(/<text>([^<]*)<\/text>/)
    
    lines.push({
      lineNumber,
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: authorMatch?.[1] || 'unknown',
      date: dateMatch?.[1] || '',
      content: textMatch?.[1] || ''
    })
  }
  
  const revisions = lines.map(l => l.revision).filter(r => r > 0)
  
  return {
    path,
    lines,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0
  }
}

function parseSvnListXml(xml: string, baseUrl: string): SvnListResult {
  const entries: SvnListResult['entries'] = []
  
  // SVN list XML format:
  // <lists><list path="..."><entry kind="file">...
  const entryMatches = xml.matchAll(/<entry[^>]*kind="([^"]*)"[^>]*>([\s\S]*?)<\/entry>/g)
  
  for (const match of entryMatches) {
    const kind = match[1]
    const content = match[2]
    
    const nameMatch = content.match(/<name>([^<]+)<\/name>/)
    const sizeMatch = content.match(/<size>(\d+)<\/size>/)
    const revMatch = content.match(/<commit[^>]*revision="(\d+)"/)
    const authorMatch = content.match(/<author>([^<]+)<\/author>/)
    const dateMatch = content.match(/<date>([^<]+)<\/date>/)
    
    const name = nameMatch?.[1] || ''
    // Remove trailing slash from directory names for URL building
    const cleanName = name.replace(/\/$/, '')
    
    entries.push({
      name,
      path: baseUrl + '/' + cleanName,
      url: baseUrl + '/' + cleanName,
      kind: kind as 'file' | 'dir',
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: authorMatch?.[1] || '',
      date: dateMatch?.[1] || ''
    })
  }
  
  return { path: baseUrl, entries }
}

function parseSvnExternals(output: string, basePath: string): SvnExternal[] {
  const externals: SvnExternal[] = []
  
  // SVN externals format per line:
  // [path] - [external definition]
  // External definition: [-rREV] URL [PATH]
  
  const lines = output.split('\n').filter(l => l.trim())
  let currentPath = basePath
  
  for (const line of lines) {
    // Check if line starts with a path (properties on path:)
    const pathMatch = line.match(/^(.+?)\s*-\s*(.+)$/)
    if (pathMatch) {
      currentPath = pathMatch[1].trim()
      const def = pathMatch[2].trim()
      const parsed = parseExternalDef(def, currentPath)
      if (parsed) externals.push(parsed)
    } else if (line.trim()) {
      // Just an external definition
      const parsed = parseExternalDef(line.trim(), currentPath)
      if (parsed) externals.push(parsed)
    }
  }
  
  return externals
}

function parseExternalDef(def: string, basePath: string): SvnExternal | null {
  // Format: [-rREV] URL [LOCAL_PATH]
  // Examples:
  //   -r123 http://example.com/repo local/path
  //   http://example.com/repo local/path
  //   ^/trunk/subdir local/path
  
  let revision: number | undefined
  let remaining = def
  
  // Check for revision
  const revMatch = remaining.match(/^-r(\d+)\s*/)
  if (revMatch) {
    revision = parseInt(revMatch[1], 10)
    remaining = remaining.substring(revMatch[0].length)
  }
  
  // Split remaining into URL and local path
  const parts = remaining.trim().split(/\s+/)
  if (parts.length < 1) return null
  
  const url = parts[0]
  const localPath = parts.length > 1 ? parts[parts.length - 1] : url.split('/').pop() || 'external'
  
  return {
    name: localPath,
    url,
    path: basePath + '/' + localPath,
    revision
  }
}
