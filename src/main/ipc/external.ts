import { ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { normalize } from 'path'

/**
 * SECURITY: Whitelist of allowed diff tools
 * Prevents arbitrary command execution via tool parameter
 */
const ALLOWED_DIFF_TOOLS: Record<string, { command: string; getArgs: (left: string, right: string) => string[] }> = {
  'bcompare': { command: 'bcompare', getArgs: (l, r) => [l, r] },
  'bcomp': { command: 'bcomp', getArgs: (l, r) => [l, r] },
  'meld': { command: 'meld', getArgs: (l, r) => [l, r] },
  'kdiff3': { command: 'kdiff3', getArgs: (l, r) => [l, r] },
  'diffmerge': { command: 'diffmerge', getArgs: (l, r) => [l, r] },
  'p4merge': { command: 'p4merge', getArgs: (l, r) => [l, r] },
  'tortoisediff': { command: 'TortoiseMerge', getArgs: (l, r) => ['/base:' + l, '/mine:' + r] },
  'vscode': { command: 'code', getArgs: (l, r) => ['--diff', l, r] },
  'code': { command: 'code', getArgs: (l, r) => ['--diff', l, r] },
}

/**
 * SECURITY: Whitelist of allowed merge tools
 */
const ALLOWED_MERGE_TOOLS: Record<string, { command: string; getArgs: (base: string, mine: string, theirs: string, merged: string) => string[] }> = {
  'bcompare': { command: 'bcompare', getArgs: (b, m, t, mg) => [m, t, b, mg] },
  'bcomp': { command: 'bcomp', getArgs: (b, m, t, mg) => [m, t, b, mg] },
  'meld': { command: 'meld', getArgs: (b, m, t, mg) => ['--diff', b, m, t, '--output', mg] },
  'kdiff3': { command: 'kdiff3', getArgs: (b, m, t, mg) => [b, m, t, '-o', mg] },
  'diffmerge': { command: 'diffmerge', getArgs: (b, m, t, mg) => ['-merge', '-result', mg, m, t, b] },
  'p4merge': { command: 'p4merge', getArgs: (b, m, t, mg) => [b, t, m, mg] },
  'tortoisemerge': { command: 'TortoiseMerge', getArgs: (b, m, t, mg) => ['/base:' + b, '/mine:' + m, '/theirs:' + t, '/merged:' + mg] },
}

/**
 * Validate that a path exists and is accessible
 * SECURITY: Prevents path traversal and access to sensitive files
 */
function validateFilePath(path: string): { valid: boolean; error?: string; normalized?: string } {
  try {
    const normalized = normalize(path)
    
    // Check for path traversal attempts
    if (normalized.includes('..')) {
      return { valid: false, error: 'Path traversal not allowed' }
    }
    
    // Check that file exists
    if (!existsSync(normalized)) {
      return { valid: false, error: 'File does not exist' }
    }
    
    // Verify it's a file, not a directory
    const stats = statSync(normalized)
    if (!stats.isFile()) {
      return { valid: false, error: 'Path must be a file' }
    }
    
    return { valid: true, normalized }
  } catch (error) {
    return { valid: false, error: (error as Error).message }
  }
}

export function registerExternalHandlers(): void {
  // Open external diff tool
  ipcMain.handle('external:openDiffTool', async (_, tool: string, left: string, right: string) => {
    try {
      // SECURITY: Validate tool name against whitelist
      const toolConfig = ALLOWED_DIFF_TOOLS[tool.toLowerCase()]
      if (!toolConfig) {
        return { 
          success: false, 
          error: `Unknown diff tool: ${tool}. Allowed tools: ${Object.keys(ALLOWED_DIFF_TOOLS).join(', ')}` 
        }
      }
      
      // SECURITY: Validate file paths
      const leftValidation = validateFilePath(left)
      if (!leftValidation.valid) {
        return { success: false, error: `Left file: ${leftValidation.error}` }
      }
      
      const rightValidation = validateFilePath(right)
      if (!rightValidation.valid) {
        return { success: false, error: `Right file: ${rightValidation.error}` }
      }
      
      const args = toolConfig.getArgs(leftValidation.normalized!, rightValidation.normalized!)
      
      console.log(`[EXTERNAL] Launching diff tool: ${toolConfig.command}`)
      
      const proc = spawn(toolConfig.command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      
      proc.unref()
      
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Open external merge tool
  ipcMain.handle('external:openMergeTool', async (_, tool: string, base: string, mine: string, theirs: string, merged: string) => {
    try {
      // SECURITY: Validate tool name against whitelist
      const toolConfig = ALLOWED_MERGE_TOOLS[tool.toLowerCase()]
      if (!toolConfig) {
        return { 
          success: false, 
          error: `Unknown merge tool: ${tool}. Allowed tools: ${Object.keys(ALLOWED_MERGE_TOOLS).join(', ')}` 
        }
      }
      
      // SECURITY: Validate file paths (merged file doesn't need to exist)
      const baseValidation = validateFilePath(base)
      if (!baseValidation.valid) {
        return { success: false, error: `Base file: ${baseValidation.error}` }
      }
      
      const mineValidation = validateFilePath(mine)
      if (!mineValidation.valid) {
        return { success: false, error: `Mine file: ${mineValidation.error}` }
      }
      
      const theirsValidation = validateFilePath(theirs)
      if (!theirsValidation.valid) {
        return { success: false, error: `Theirs file: ${theirsValidation.error}` }
      }
      
      // Normalize merged path (file may not exist yet)
      const mergedNormalized = normalize(merged)
      if (mergedNormalized.includes('..')) {
        return { success: false, error: 'Path traversal not allowed in merged file path' }
      }
      
      const args = toolConfig.getArgs(
        baseValidation.normalized!, 
        mineValidation.normalized!, 
        theirsValidation.normalized!, 
        mergedNormalized
      )
      
      console.log(`[EXTERNAL] Launching merge tool: ${toolConfig.command}`)
      
      const proc = spawn(toolConfig.command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      
      proc.unref()
      
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Open folder in file explorer
  ipcMain.handle('external:openFolder', async (_, path: string) => {
    try {
      // SECURITY: Validate path exists
      const normalized = normalize(path)
      if (normalized.includes('..')) {
        return { success: false, error: 'Path traversal not allowed' }
      }
      
      if (!existsSync(normalized)) {
        return { success: false, error: 'Folder does not exist' }
      }
      
      await shell.openPath(normalized)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Open file with default application
  ipcMain.handle('external:openFile', async (_, path: string) => {
    try {
      // SECURITY: Validate path
      const validation = validateFilePath(path)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }
      
      await shell.openPath(validation.normalized!)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
