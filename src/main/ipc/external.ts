import { ipcMain, shell } from 'electron'
import { spawn } from 'child_process'

export function registerExternalHandlers(): void {
  // Open external diff tool
  ipcMain.handle('external:openDiffTool', async (_, tool: string, left: string, right: string) => {
    try {
      // Common diff tools and their argument patterns
      const toolPatterns: Record<string, string[]> = {
        'bcompare': [left, right],
        'bcomp': [left, right],
        'meld': [left, right],
        'kdiff3': [left, right],
        'diffmerge': [left, right],
        'p4merge': [left, right],
        'tortoisediff': ['/base:' + left, '/mine:' + right],
        'vscode': ['--diff', left, right],
        'code': ['--diff', left, right],
      }
      
      const args = toolPatterns[tool.toLowerCase()] || [left, right]
      
      const proc = spawn(tool, args, {
        detached: true,
        stdio: 'ignore'
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
      const toolPatterns: Record<string, string[]> = {
        'bcompare': [mine, theirs, base, merged],
        'bcomp': [mine, theirs, base, merged],
        'meld': ['--diff', base, mine, theirs, '--output', merged],
        'kdiff3': [base, mine, theirs, '-o', merged],
        'diffmerge': ['-merge', '-result', merged, mine, theirs, base],
        'p4merge': [base, theirs, mine, merged],
        'tortoisemerge': ['/base:' + base, '/mine:' + mine, '/theirs:' + theirs, '/merged:' + merged],
      }
      
      const args = toolPatterns[tool.toLowerCase()] || [mine, theirs, base, merged]
      
      const proc = spawn(tool, args, {
        detached: true,
        stdio: 'ignore'
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
      await shell.openPath(path)
      return { success: true }
    } catch (err) {
      return { success: false }
    }
  })

  // Open file with default application
  ipcMain.handle('external:openFile', async (_, path: string) => {
    try {
      await shell.openPath(path)
      return { success: true }
    } catch (err) {
      return { success: false }
    }
  })
}
