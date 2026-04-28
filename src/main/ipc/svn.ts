import { ipcMain } from 'electron';

import type {
  CheckoutOptions,
  RepoDiagnostics,
  SvnBlameResult,
  SvnChangelistResult,
  SvnDiffResult,
  SvnExecutionContext,
  SvnExternal,
  SvnInfoResult,
  SvnListResult,
  SvnLogResult,
  SvnShelveListResult,
  SvnStatusResult,
} from '@shared/types';

import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import {
  cancelCheckout,
  checkout,
  checkoutWithProgress,
} from '../services/svn-checkout';
import { getBlame, getDiff, getDiffStreaming, getLog } from '../services/svn-history';
import {
  forceLock,
  forceUnlock,
  getLockInfo,
  listLocks,
  lock as lockWorkingCopyItem,
  unlock as unlockWorkingCopyItem,
} from '../services/svn-locks';
import {
  changelistAdd,
  changelistCreate,
  changelistDelete,
  changelistList,
  changelistRemove,
  externalsAdd,
  externalsList,
  externalsRemove,
  listRepository,
  propdel,
  proplist,
  propset,
  shelveApply,
  shelveDelete,
  shelveList,
  shelveSave,
} from '../services/svn-metadata';
import { getDiagnostics } from '../services/svn-diagnostics';
import { applyPatch, createPatch } from '../services/svn-patch';
import {
  add as addWorkingCopyItems,
  cleanup as cleanupWorkingCopy,
  getWorkingCopyContext,
  getInfo,
  getInfoUrl,
  getStatus,
  move as moveWorkingCopyItem,
  remove as removeWorkingCopyItems,
  rename as renameWorkingCopyItem,
  revert as revertWorkingCopyItems,
  update as updateWorkingCopy,
  updateItem as updateWorkingCopyItem,
  updateToRevision,
} from '../services/svn-working-copy';
import { runSvnText } from '../services/svn-executor';
import debug from '../utils/debug';
import { getStore } from './store';

/**
 * Helper to get hooks for a working copy from store
 */
async function getHooksForWorkingCopy(workingCopyPath: string): Promise<HookScript[]> {
  try {
    const store = await getStore();
    const stored = await store.get<Record<string, HookScript[]>>('shellysvn:hook-scripts');
    if (stored && stored[workingCopyPath]) {
      return stored[workingCopyPath];
    }
  } catch (error) {
    // Intentionally graceful: Hook retrieval failure should not break SVN operations.
    // Store may be unavailable during app shutdown or if settings file is corrupted.
    debug.error('[SVN] Failed to get hooks (continuing without hooks):', error);
  }
  return [];
}

/**
 * SSL failure types that can be bypassed
 * SECURITY: 'other' is excluded as it's too broad and may bypass security checks
 * Valid values per SVN: unknown-ca, cn-mismatch, expired, not-yet-valid, other
 */
const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;
const DEFAULT_SSL_FAILURES = ALLOWED_SSL_FAILURES.join(',');

/**
 * Execute SVN command with settings-aware context
 *
 * This function now automatically applies global settings (proxy, SSL, timeout)
 * from the settings manager, while still allowing per-operation overrides.
 *
 * @param args - SVN command arguments
 * @param cwd - Working directory for the command
 * @param operationContext - Optional context overrides (proxy, SSL, timeout)
 * @param trustSslFailures - If true, bypass SSL verification for this operation (for working copy ops)
 * @param credentials - Optional username/password for authentication
 */
async function executeSvn(
  args: string[],
  cwd?: string,
  operationContext?: Partial<SvnExecutionContext>,
  trustSslFailures: boolean = false,
  credentials?: { username: string; password: string }
): Promise<string> {
  return runSvnText(args, {
    cwd,
    operationContext,
    trustSslFailures,
    credentials,
  });
}

export function registerSvnHandlers(): void {
  // SVN Status
  ipcMain.handle('svn:status', async (_, path: string): Promise<SvnStatusResult> => {
    return getStatus(path);
  });

  // SVN Log
  ipcMain.handle('svn:log', async (_, path: string, limit = 100): Promise<SvnLogResult> => {
    return getLog(path, limit);
  });

  // SVN Info
  ipcMain.handle('svn:info', async (_, path: string): Promise<SvnInfoResult> => {
    return getInfo(path);
  });

  ipcMain.handle('svn:infoUrl', async (_, url: string): Promise<SvnInfoResult> => {
    return getInfoUrl(url);
  });

  ipcMain.handle('svn:getWorkingCopyContext', async (_, localPath: string) => {
    return getWorkingCopyContext(localPath);
  });

  // SVN Diff
  ipcMain.handle('svn:diff', async (_, path: string, revision?: string): Promise<SvnDiffResult> => {
    return getDiff(path, revision);
  });

  // SVN Streaming Diff - Memory-efficient diff parsing for large files
  ipcMain.handle(
    'svn:diffStreaming',
    async (_, path: string, revision?: string): Promise<SvnDiffResult> => {
      return getDiffStreaming(path, revision);
    }
  );

  // SVN Update
  ipcMain.handle(
    'svn:update',
    async (
      _,
      path: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: Parameters<typeof updateWorkingCopy>[2]
    ) => updateWorkingCopy(path, depth, options)
  );

  ipcMain.handle('svn:updateItem', async (_, localPath: string) => {
    return updateWorkingCopyItem(localPath);
  });

  ipcMain.handle(
    'svn:updateToRevision',
    async (
      _,
      workingCopyRoot: string,
      repoUrl: string,
      localPath: string,
      depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'infinity',
      setDepthSticky: boolean = false
    ) => updateToRevision(workingCopyRoot, repoUrl, localPath, depth, setDepthSticky)
  );

  // SVN Commit
  ipcMain.handle('svn:commit', async (_, paths: string[], message: string) => {
    const workingCopyPath = paths[0];

    // Fetch hooks for this working copy
    const hooks = await getHooksForWorkingCopy(workingCopyPath);

    // Execute start-commit hooks
    const startResult = await executeHooksForType(hooks, 'start-commit', {
      workingCopyPath,
      files: paths,
      message,
    });
    if (!startResult.allSucceeded) {
      return {
        success: false,
        error: startResult.error || 'Start-commit hook blocked the operation',
      };
    }

    // Execute pre-commit hooks
    const preResult = await executeHooksForType(hooks, 'pre-commit', {
      workingCopyPath,
      files: paths,
      message,
    });
    if (!preResult.allSucceeded) {
      return {
        success: false,
        error: preResult.error || 'Pre-commit hook blocked the operation',
      };
    }

    // Execute SVN commit
    const output = await executeSvn(['commit', '-m', message, ...paths]);
    const match = output.match(/Committed revision (\d+)\./);
    const result = {
      success: true,
      revision: match ? parseInt(match[1], 10) : 0,
    };

    // After successful commit, execute post-commit hooks (async, don't wait)
    if (result.success) {
      executeHooksForType(hooks, 'post-commit', {
        workingCopyPath,
        files: paths,
        message,
        revision: result.revision,
      }).catch((err) => debug.error('[SVN] Post-commit hook error:', err));
    }

    return result;
  });

  // SVN Revert
  ipcMain.handle('svn:revert', async (_, paths: string[]) => {
    return revertWorkingCopyItems(paths);
  });

  // SVN Add
  ipcMain.handle('svn:add', async (_, paths: string[]) => {
    return addWorkingCopyItems(paths);
  });

  // SVN Delete
  ipcMain.handle('svn:delete', async (_, paths: string[]) => {
    return removeWorkingCopyItems(paths);
  });

  // SVN Cleanup
  ipcMain.handle('svn:cleanup', async (_, path: string) => {
    return cleanupWorkingCopy(path);
  });

  // SVN Checkout
  ipcMain.handle(
    'svn:checkout',
    async (
      _,
      url: string,
      path: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => checkout(url, path, revision, depth, options)
  );

  // SVN Checkout with Progress Streaming
  ipcMain.handle(
    'svn:checkoutWithProgress',
    async (
      event,
      checkoutId: string,
      url: string,
      path: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => checkoutWithProgress(event, checkoutId, url, path, revision, depth, options)
  );

  // SVN Cancel Checkout
  ipcMain.handle('svn:cancelCheckout', async (_, checkoutId: string) => {
    return cancelCheckout(checkoutId);
  });

  // SVN Export
  ipcMain.handle('svn:export', async (_, url: string, path: string, revision?: string) => {
    const args = [
      'export',
      '--non-interactive',
      '--trust-server-cert-failures',
      DEFAULT_SSL_FAILURES,
      url,
      path,
    ];
    if (revision) args.push('-r', revision);
    const output = await executeSvn(args);
    const match = output.match(/Exported revision (\d+)\./);
    return {
      success: true,
      revision: match ? parseInt(match[1], 10) : 0,
      output,
    };
  });

  // SVN Import
  ipcMain.handle('svn:import', async (_, path: string, url: string, message: string) => {
    const output = await executeSvn([
      'import',
      '-m',
      message,
      '--non-interactive',
      '--trust-server-cert-failures',
      DEFAULT_SSL_FAILURES,
      path,
      url,
    ]);
    const match = output.match(/Committed revision (\d+)\./);
    return {
      success: true,
      revision: match ? parseInt(match[1], 10) : 0,
      output,
    };
  });

  // SVN Lock
  ipcMain.handle('svn:lock', async (_, path: string, message?: string) => {
    return lockWorkingCopyItem(path, message);
  });

  // SVN Unlock
  ipcMain.handle('svn:unlock', async (_, path: string, force?: boolean) => {
    return unlockWorkingCopyItem(path, force);
  });

  // SVN Lock Info - Get detailed lock information for a file
  ipcMain.handle('svn:lockInfo', async (_, path: string) => {
    return getLockInfo(path);
  });

  // SVN Force Lock (Steal Lock) - Lock a file even if locked by another user
  ipcMain.handle('svn:lockForce', async (_, path: string, message?: string) => {
    return forceLock(path, message);
  });

  // SVN Force Unlock (Break Lock) - Unlock a file locked by another user
  ipcMain.handle('svn:unlockForce', async (_, path: string) => {
    return forceUnlock(path);
  });

  // SVN Lock List - List all locks in a working copy
  ipcMain.handle('svn:lockList', async (_, path: string) => {
    return listLocks(path);
  });

  // SVN Resolve
  ipcMain.handle(
    'svn:resolve',
    async (
      _,
      path: string,
      resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict'
    ) => {
      await executeSvn(['resolve', '--accept', resolution, path]);
      return { success: true };
    }
  );

  // SVN Switch
  ipcMain.handle('svn:switch', async (_, path: string, url: string, revision?: string) => {
    const args = ['switch', url, path];
    if (revision) args.push('-r', revision);
    const output = await executeSvn(args);
    const match = output.match(/Updated to revision (\d+)\./);
    return {
      success: true,
      revision: match ? parseInt(match[1], 10) : 0,
      output,
    };
  });

  // SVN Copy (Branch/Tag)
  ipcMain.handle('svn:copy', async (_, src: string, dst: string, message: string) => {
    const output = await executeSvn(['copy', '-m', message, src, dst]);
    const match = output.match(/Committed revision (\d+)\./);
    return {
      success: true,
      revision: match ? parseInt(match[1], 10) : 0,
      output,
    };
  });

  // SVN Merge
  ipcMain.handle(
    'svn:merge',
    async (
      _,
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>
    ) => {
      const args = ['merge', source, target];
      if (revisions && revisions.length > 0) {
        args.push('-c', revisions.join(','));
      }
      if (ranges && ranges.length > 0) {
        for (const range of ranges) {
          args.push('-r', `${range.start}:${range.end}`);
        }
      }
      const output = await executeSvn(args);
      return { success: true, output };
    }
  );

  // SVN Relocate
  ipcMain.handle('svn:relocate', async (_, from: string, to: string, path: string) => {
    const output = await executeSvn(['relocate', from, to, path]);
    return { success: true, output };
  });

  // SVN Changelist - Add to changelist
  ipcMain.handle('svn:changelist:add', async (_, paths: string[], changelist: string) => {
    return changelistAdd(paths, changelist);
  });

  // SVN Changelist - Remove from changelist
  ipcMain.handle('svn:changelist:remove', async (_, paths: string[]) => {
    return changelistRemove(paths);
  });

  // SVN Changelist - List changelists
  ipcMain.handle('svn:changelist:list', async (_, path: string): Promise<SvnChangelistResult> => {
    return changelistList(path);
  });

  // SVN Changelist - Create new changelist
  ipcMain.handle('svn:changelist:create', async (_, _name: string, _comment?: string) => {
    return changelistCreate();
  });

  // SVN Changelist - Delete changelist (remove all files from it)
  ipcMain.handle('svn:changelist:delete', async (_, name: string, path: string) => {
    return changelistDelete(name, path);
  });

  // SVN Move
  ipcMain.handle('svn:move', async (_, src: string, dst: string) => {
    return moveWorkingCopyItem(src, dst);
  });

  // SVN Rename
  ipcMain.handle('svn:rename', async (_, src: string, dst: string) => {
    return renameWorkingCopyItem(src, dst);
  });

  // SVN Shelve - List shelves
  ipcMain.handle('svn:shelve:list', async (_, path: string): Promise<SvnShelveListResult> => {
    return shelveList(path);
  });

  // SVN Shelve - Save
  ipcMain.handle('svn:shelve:save', async (_, name: string, path: string, message?: string) => {
    return shelveSave(name, path, message);
  });

  // SVN Shelve - Apply
  ipcMain.handle('svn:shelve:apply', async (_, name: string, path: string) => {
    return shelveApply(name, path);
  });

  // SVN Shelve - Delete
  ipcMain.handle('svn:shelve:delete', async (_, name: string, path: string) => {
    return shelveDelete(name, path);
  });

  // SVN Proplist
  ipcMain.handle('svn:proplist', async (_, path: string) => {
    return proplist(path);
  });

  // SVN Propset
  ipcMain.handle('svn:propset', async (_, path: string, name: string, value: string) => {
    return propset(path, name, value);
  });

  // SVN Propdel
  ipcMain.handle('svn:propdel', async (_, path: string, name: string) => {
    return propdel(path, name);
  });

  // ============================================
  // SVN Blame (Annotate)
  // ============================================

  ipcMain.handle(
    'svn:blame',
    async (
      _,
      path: string,
      startRevision?: number,
      endRevision?: number
    ): Promise<SvnBlameResult> => {
      return getBlame(path, startRevision, endRevision);
    }
  );

  // ============================================
  // SVN List (Repository Browser)
  // ============================================

  ipcMain.handle(
    'svn:list',
    async (
      _,
      url: string,
      revision?: string,
      depth?: 'empty' | 'immediates' | 'infinity',
      credentials?: { username: string; password: string }
    ): Promise<SvnListResult> => {
      return listRepository(url, revision, depth, credentials);
    }
  );

  // ============================================
  // SVN Patch Operations
  // ============================================

  ipcMain.handle(
    'svn:patch:create',
    async (
      _,
      paths: string[],
      outputPath: string
    ): Promise<{ success: boolean; output: string }> => {
      return createPatch(paths, outputPath);
    }
  );

  ipcMain.handle(
    'svn:patch:apply',
    async (_, patchPath: string, targetPath: string, dryRun?: boolean) => {
      return applyPatch(patchPath, targetPath, dryRun);
    }
  );

  // ============================================
  // SVN Externals Management
  // ============================================

  ipcMain.handle('svn:externals:list', async (_, path: string): Promise<SvnExternal[]> => {
    return externalsList(path);
  });

  ipcMain.handle(
    'svn:externals:add',
    async (
      _,
      workingCopyPath: string,
      external: Omit<SvnExternal, 'name'> & { name?: string }
    ): Promise<{ success: boolean }> => {
      return externalsAdd(workingCopyPath, external);
    }
  );

  ipcMain.handle(
    'svn:externals:remove',
    async (_, workingCopyPath: string, externalPath: string): Promise<{ success: boolean }> => {
      return externalsRemove(workingCopyPath, externalPath);
    }
  );

  // ============================================
  // Repository Diagnostics
  // ============================================

  ipcMain.handle(
    'svn:diagnostics',
    async (_, workingCopyPath: string): Promise<RepoDiagnostics> => {
      return getDiagnostics(workingCopyPath);
    }
  );
}

