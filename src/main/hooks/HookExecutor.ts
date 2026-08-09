import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { accessSync, constants, statSync } from 'fs';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { terminateProcessTree } from '../utils/process-tree';
import { sendToRenderer } from '../utils/safe-renderer-send';

const DEFAULT_HOOK_TIMEOUT_MS = 60_000;
const HOOK_KILL_GRACE_MS = 1_000;
const MAX_HOOK_OUTPUT_BYTES = 64 * 1024;

export interface HookScript {
  id: string;
  name: string;
  type:
    | 'pre-commit'
    | 'post-commit'
    | 'pre-update'
    | 'post-update'
    | 'start-commit'
    | 'pre-lock'
    | 'pre-unlock';
  path: string;
  enabled: boolean;
  waitForResult: boolean;
  showConsole: boolean;
  timeoutMs?: number;
}

export interface HookContext {
  workingCopyPath: string;
  files?: string[];
  message?: string;
  revision?: number | null;
  force?: boolean;
}

export interface HookResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

/**
 * Execute a single hook script
 */
export async function executeHook(hook: HookScript, context: HookContext): Promise<HookResult> {
  return new Promise((resolve) => {
    let hookPath: string;
    try {
      hookPath = assertPathApprovedForIpc(hook.path, `Hook "${hook.name}"`);
      if (!statSync(hookPath).isFile()) {
        throw new Error('Hook path must point to a file.');
      }
      if (process.platform !== 'win32') {
        accessSync(hookPath, constants.X_OK);
      }
    } catch (error) {
      resolve({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const args = [context.workingCopyPath];

    if (context.files && context.files.length > 0) {
      args.push('--files', context.files.join(','));
    }

    if (context.message) {
      args.push('--message', context.message);
    }

    if (context.revision) {
      args.push('--revision', String(context.revision));
    }

    if (context.force) {
      args.push('--force');
    }

    const proc = spawn(hookPath, args, {
      detached: true,
      stdio: hook.showConsole ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        SHELLY_HOOK_TYPE: hook.type,
        SHELLY_WORKING_COPY: context.workingCopyPath,
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let terminationStarted = false;
    let timeout: NodeJS.Timeout | null = null;

    const appendBounded = (current: string, data: unknown): string => {
      const next = current + String(data);
      return Buffer.byteLength(next) <= MAX_HOOK_OUTPUT_BYTES
        ? next
        : Buffer.from(next).subarray(0, MAX_HOOK_OUTPUT_BYTES).toString();
    };

    const finish = (result: HookResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };

    proc.stdout?.on('data', (data) => {
      stdout = appendBounded(stdout, data);
    });

    proc.stderr?.on('data', (data) => {
      stderr = appendBounded(stderr, data);
    });

    proc.on('close', (code) => {
      if (terminationStarted) return;
      finish({
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
        exitCode: code ?? undefined,
      });
    });

    proc.on('error', (err) => {
      if (terminationStarted) return;
      finish({
        success: false,
        error: err.message,
      });
    });

    const timeoutMs = Math.min(Math.max(hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS, 1_000), 600_000);
    timeout = setTimeout(() => {
      if (settled) return;
      terminationStarted = true;
      void terminateProcessTree(proc, HOOK_KILL_GRACE_MS)
        .catch(() => {
          // Termination is best-effort. The timeout result still needs to settle if the helper
          // cannot inspect or signal a process that exited concurrently.
        })
        .then(() => {
          finish({
            success: false,
            output: stdout || undefined,
            error: `Hook timed out after ${timeoutMs / 1000} seconds.`,
          });
        });
    }, timeoutMs);

    // If not waiting for result, resolve immediately
    if (!hook.waitForResult) {
      clearTimeout(timeout);
      proc.unref();
      finish({ success: true });
    }
  });
}

/**
 * Execute all hooks of a given type for a working copy
 */
export async function executeHooksForType(
  hooks: HookScript[],
  type: HookScript['type'],
  context: HookContext
): Promise<{ allSucceeded: boolean; results: Map<string, HookResult>; error?: string }> {
  const results = new Map<string, HookResult>();

  const matchingHooks = hooks.filter((h) => h.type === type && h.enabled);

  for (const hook of matchingHooks) {
    const result = await executeHook(hook, context);
    results.set(hook.id, result);

    // If hook was supposed to block and failed, stop
    if (hook.waitForResult && !result.success) {
      return {
        allSucceeded: false,
        results,
        error: result.error || `Hook "${hook.name}" failed with exit code ${result.exitCode}`,
      };
    }
  }

  return { allSucceeded: true, results };
}

/**
 * Notify renderer of hook execution
 */
export function notifyHookExecution(
  window: BrowserWindow | null,
  hookId: string,
  result: HookResult
): void {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    sendToRenderer(window.webContents, 'hook:executed', { hookId, result });
  }
}
