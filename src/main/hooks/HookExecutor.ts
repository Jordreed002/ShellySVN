import { spawn } from 'child_process'
import { BrowserWindow } from 'electron'

export interface HookScript {
  id: string
  name: string
  type: 'pre-commit' | 'post-commit' | 'pre-update' | 'post-update' | 'start-commit' | 'pre-lock' | 'pre-unlock'
  path: string
  enabled: boolean
  waitForResult: boolean
  showConsole: boolean
}

export interface HookContext {
  workingCopyPath: string
  files?: string[]
  message?: string
  revision?: number
}

export interface HookResult {
  success: boolean
  output?: string
  error?: string
  exitCode?: number
}

/**
 * Execute a single hook script
 */
export async function executeHook(
  hook: HookScript,
  context: HookContext
): Promise<HookResult> {
  return new Promise((resolve) => {
    const args = [context.workingCopyPath]
    
    if (context.files && context.files.length > 0) {
      args.push('--files', context.files.join(','))
    }
    
    if (context.message) {
      args.push('--message', context.message)
    }
    
    if (context.revision) {
      args.push('--revision', String(context.revision))
    }
    
    const proc = spawn(hook.path, args, {
      detached: !hook.waitForResult,
      stdio: hook.showConsole ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        SHELLY_HOOK_TYPE: hook.type,
        SHELLY_WORKING_COPY: context.workingCopyPath
      }
    })
    
    let stdout = ''
    let stderr = ''
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })
    
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
        exitCode: code ?? undefined
      })
    })
    
    proc.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      })
    })
    
    // If not waiting for result, resolve immediately
    if (!hook.waitForResult) {
      proc.unref()
      resolve({ success: true })
    }
  })
}

/**
 * Execute all hooks of a given type for a working copy
 */
export async function executeHooksForType(
  hooks: HookScript[],
  type: HookScript['type'],
  context: HookContext
): Promise<{ allSucceeded: boolean; results: Map<string, HookResult>; error?: string }> {
  const results = new Map<string, HookResult>()
  
  const matchingHooks = hooks.filter(h => h.type === type && h.enabled)
  
  for (const hook of matchingHooks) {
    const result = await executeHook(hook, context)
    results.set(hook.id, result)
    
    // If hook was supposed to block and failed, stop
    if (hook.waitForResult && !result.success) {
      return { 
        allSucceeded: false, 
        results, 
        error: result.error || `Hook "${hook.name}" failed with exit code ${result.exitCode}` 
      }
    }
  }
  
  return { allSucceeded: true, results }
}

/**
 * Notify renderer of hook execution
 */
export function notifyHookExecution(
  window: BrowserWindow | null,
  hookId: string,
  result: HookResult
): void {
  window?.webContents.send('hook:executed', { hookId, result })
}
