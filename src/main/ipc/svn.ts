import { existsSync as fsExistsSync } from 'fs';
import { join } from 'path';
import { ipcMain } from 'electron';
import { XMLParser } from 'fast-xml-parser';

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
  SvnLockInfo,
  SvnLogResult,
  SvnPatchResult,
  SvnShelveListResult,
  SvnStatusResult,
  UpdateOptions,
} from '@shared/types';

import { getAuthCache } from '../auth-cache';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getSettingsManager } from '../settings-manager';
import {
  cancelCheckout,
  checkout,
  checkoutWithProgress,
} from '../services/svn-checkout';
import { getBlame, getDiff, getDiffStreaming, getLog } from '../services/svn-history';
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
import {
  add as addWorkingCopyItems,
  cleanup as cleanupWorkingCopy,
  getInfo,
  getInfoUrl,
  getStatus,
  move as moveWorkingCopyItem,
  remove as removeWorkingCopyItems,
  rename as renameWorkingCopyItem,
  revert as revertWorkingCopyItems,
} from '../services/svn-working-copy';
import { runSvn, runSvnText } from '../services/svn-executor';
import debug from '../utils/debug';
import { parseSvnInfoXml } from '../svn/parsers';
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
  allowBooleanAttributes: true,
});

/**
 * SSL failure types that can be bypassed
 * SECURITY: 'other' is excluded as it's too broad and may bypass security checks
 * Valid values per SVN: unknown-ca, cn-mismatch, expired, not-yet-valid, other
 */
const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;
const DEFAULT_SSL_FAILURES = ALLOWED_SSL_FAILURES.join(',');

function normalizeSslFailures(failures?: string[]): string {
  const mapped = new Set<(typeof ALLOWED_SSL_FAILURES)[number]>();

  for (const failure of failures && failures.length > 0 ? failures : ['unknown-ca']) {
    switch (failure) {
      case 'untrusted-issuer':
      case 'unknown-ca':
        mapped.add('unknown-ca');
        break;
      case 'hostname-mismatch':
      case 'cn-mismatch':
        mapped.add('cn-mismatch');
        break;
      case 'expired':
        mapped.add('expired');
        break;
      case 'not-yet-valid':
        mapped.add('not-yet-valid');
        break;
      default:
        debug.warn('[SECURITY] Ignoring unsupported SSL trust failure type:', failure);
    }
  }

  return mapped.size > 0 ? Array.from(mapped).join(',') : 'unknown-ca';
}

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

  ipcMain.handle(
    'svn:getWorkingCopyContext',
    async (
      _,
      localPath: string
    ): Promise<{ workingCopyRoot: string; repositoryRoot: string; url: string } | null> => {
      const { existsSync } = require('fs');
      const { dirname, join } = require('path');

      let currentPath = localPath;
      let attempts = 0;
      const maxAttempts = 50;

      while (attempts < maxAttempts) {
        attempts++;

        const svnDir = join(currentPath, '.svn');
        if (existsSync(svnDir)) {
          try {
            const xml = await executeSvn(['info', '--xml', currentPath]);
            const info = parseSvnInfoXml(xml);

            if (info.workingCopyRoot && info.repositoryRoot && info.url) {
              const relativePath = localPath.slice(currentPath.length);
              const constructedUrl = info.url + relativePath.split(/[/\\]/).join('/');

              return {
                workingCopyRoot: info.workingCopyRoot,
                repositoryRoot: info.repositoryRoot,
                url: constructedUrl,
              };
            }
          } catch {}
        }

        const parent = dirname(currentPath);
        if (parent === currentPath) break;
        currentPath = parent;
      }

      return null;
    }
  );

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
      options?: UpdateOptions
    ) => {
      // Validate that the path is a working copy before attempting update
      try {
        await executeSvn(['info', '--xml', path], path, undefined, true);
      } catch (error) {
        const errorMsg = (error as Error).message || '';
        debug.error('[SVN] Working copy validation failed for update:', path, errorMsg);
        return {
          success: false,
          error:
            'Not a valid working copy. The selected path is not under SVN version control. ' +
            'Make sure you have checked out the repository and the .svn directory exists.',
        };
      }

      const hooks = await getHooksForWorkingCopy(path);

      // Pre-update hooks
      const preResult = await executeHooksForType(hooks, 'pre-update', {
        workingCopyPath: path,
      });
      if (!preResult.allSucceeded) {
        return { success: false, error: preResult.error || 'Pre-update hook blocked' };
      }

      // Execute SVN update
      try {
        const args = ['update'];
        const revision = options?.revision?.trim();
        if (revision && revision.toUpperCase() !== 'HEAD') {
          args.push('-r', revision);
        }
        if (depth) args.push('--depth', depth);
        if (options?.ignoreExternals) args.push('--ignore-externals');
        if (options?.force) args.push('--force');
        args.push(path);

        const output = await executeSvn(args, undefined, undefined, true);
        const match = output.match(/Updated to revision (\d+)\./);
        const result = {
          success: true,
          revision: match ? parseInt(match[1], 10) : 0,
        };

        // Post-update hooks (async)
        executeHooksForType(hooks, 'post-update', {
          workingCopyPath: path,
          revision: result.revision,
        }).catch((err) => debug.error('[SVN] Post-update hook error:', err));

        return result;
      } catch (error) {
        const errorMsg = (error as Error).message || '';
        debug.error('[SVN] Update failed:', path, errorMsg);

        // Provide helpful error messages for common SVN errors
        if (errorMsg.includes('E155007')) {
          return {
            success: false,
            error: 'Not a working copy. The selected path is not under SVN version control.',
          };
        }
        if (errorMsg.includes('E155004')) {
          return {
            success: false,
            error:
              'Working copy is locked. Try running "Cleanup" from the toolbar to resolve this issue.',
          };
        }
        if (errorMsg.includes('E155036')) {
          return {
            success: false,
            error:
              'Working copy format is too old. Please upgrade the working copy using "svn upgrade" in the terminal.',
          };
        }

        return { success: false, error: `SVN update failed: ${errorMsg}` };
      }
    }
  );

  ipcMain.handle(
    'svn:updateItem',
    async (
      _,
      localPath: string
    ): Promise<{ success: boolean; revision: number; error?: string }> => {
      const { existsSync, mkdirSync } = require('fs');
      const { dirname } = require('path');

      try {
        const context = await (async () => {
          let currentPath = localPath;
          for (let i = 0; i < 50; i++) {
            const svnDir = join(currentPath, '.svn');
            if (existsSync(svnDir)) {
              try {
                const xml = await executeSvn(['info', '--xml', currentPath]);
                const info = parseSvnInfoXml(xml);
                if (info.workingCopyRoot && info.url) {
                  const relativePath = localPath.slice(currentPath.length);
                  return {
                    workingCopyRoot: info.workingCopyRoot,
                    url: info.url + relativePath.split(/[/\\]/).join('/'),
                  };
                }
              } catch {}
            }
            const parent = dirname(currentPath);
            if (parent === currentPath) break;
            currentPath = parent;
          }
          return null;
        })();

        if (!context) {
          return { success: false, revision: 0, error: 'Not inside a working copy' };
        }

        if (!existsSync(localPath)) {
          mkdirSync(localPath, { recursive: true });
        }

        const output = await executeSvn(['update', '--depth', 'infinity', localPath]);
        const match = output.match(/Updated to revision (\d+)\./);

        return {
          success: true,
          revision: match ? parseInt(match[1], 10) : 0,
        };
      } catch (error) {
        return {
          success: false,
          revision: 0,
          error: (error as Error)?.message || 'Update failed',
        };
      }
    }
  );

  ipcMain.handle(
    'svn:updateToRevision',
    async (
      _,
      workingCopyRoot: string,
      repoUrl: string,
      localPath: string,
      depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'infinity',
      setDepthSticky: boolean = false
    ): Promise<{ success: boolean; revision: number; error?: string }> => {
      const { relative, join } = require('path');
      const { existsSync } = require('fs');

      try {
        const relativePath = relative(workingCopyRoot, localPath);

        debug.log('[updateToRevision] workingCopyRoot:', workingCopyRoot);
        debug.log('[updateToRevision] repoUrl:', repoUrl);
        debug.log('[updateToRevision] localPath:', localPath);
        debug.log('[updateToRevision] relativePath:', relativePath);
        debug.log('[updateToRevision] depth:', depth);
        debug.log('[updateToRevision] setDepthSticky:', setDepthSticky);

        // Get credentials from auth cache for this repository
        // Use findForUrl to match credentials stored for the repository root
        // even when we're accessing a subdirectory URL
        const authCache = getAuthCache();
        const credentialMatch = repoUrl ? authCache.findForUrl(repoUrl) : null;
        const credentials = credentialMatch
          ? { username: credentialMatch.username, password: credentialMatch.password }
          : null;
        if (credentials) {
          debug.log(
            '[updateToRevision] Using cached credentials for realm:',
            credentialMatch?.realm
          );
        }

        const pathParts = relativePath.split(/[/\\]/).filter((p) => p.length > 0);

        // Step 1: Ensure all parent directories exist and are "opened" to see children
        // In sparse checkouts, a directory can exist on disk but be at depth-empty,
        // meaning it doesn't know about its children. We need to update parent dirs
        // to at least 'immediates' depth so SVN can see and add their children.
        for (let i = 0; i < pathParts.length - 1; i++) {
          const partialPath = pathParts.slice(0, i + 1).join('/');
          const fullPath = join(workingCopyRoot, partialPath);

          if (!existsSync(fullPath)) {
            // Parent doesn't exist - create it with --depth immediates so it can have children
            debug.log(
              '[updateToRevision] Creating parent with --set-depth immediates:',
              partialPath
            );
            await executeSvn(
              ['update', '--set-depth', 'immediates', partialPath],
              workingCopyRoot,
              undefined,
              true,
              credentials || undefined
            );
          } else {
            // Parent exists - but might be at depth-empty. Update to immediates to "open" it.
            // This is safe to run even if already at higher depth (it's a no-op in that case)
            debug.log(
              '[updateToRevision] Opening parent to see children with --set-depth immediates:',
              partialPath
            );
            try {
              await executeSvn(
                ['update', '--set-depth', 'immediates', partialPath],
                workingCopyRoot,
                undefined,
                true,
                credentials || undefined
              );
            } catch (e) {
              // If this fails, the parent might already be at a sufficient depth - continue anyway
              debug.log(
                '[updateToRevision] Parent depth update failed (may already be sufficient):',
                (e as Error)?.message
              );
            }
          }
        }

        // Step 2: Ensure the target directory exists (for adding NEW folders)
        // This is needed when the target doesn't exist locally at all
        const targetFullPath = join(workingCopyRoot, relativePath);
        if (!existsSync(targetFullPath)) {
          debug.log(
            '[updateToRevision] Target does not exist, fetching with --depth empty first:',
            relativePath
          );
          try {
            await executeSvn(
              ['update', '--depth', 'empty', relativePath],
              workingCopyRoot,
              undefined,
              true,
              credentials || undefined
            );
          } catch (e) {
            // If this fails, we'll try the main update anyway
            debug.log('[updateToRevision] Initial target fetch failed:', (e as Error)?.message);
          }
        }

        // Step 3: Run the final update with the requested depth
        // --depth and --set-depth are mutually exclusive in SVN
        // Use --set-depth when sticky (it also applies depth for this update)
        // Use --depth when not sticky (one-time depth)
        const args = ['update'];
        if (setDepthSticky) {
          args.push('--set-depth', depth);
        } else {
          args.push('--depth', depth);
        }
        args.push(relativePath);

        debug.log('[updateToRevision] Running svn with args:', args);
        const output = await executeSvn(
          args,
          workingCopyRoot,
          undefined,
          true,
          credentials || undefined
        );
        const match = output.match(/Updated to revision (\d+)\./);

        return {
          success: true,
          revision: match ? parseInt(match[1], 10) : 0,
        };
      } catch (error) {
        return {
          success: false,
          revision: 0,
          error: (error as Error)?.message || 'Update failed',
        };
      }
    }
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
    // Get parent directory as working copy path
    const workingCopyPath = path.substring(0, path.lastIndexOf('/')) || path;
    const hooks = await getHooksForWorkingCopy(workingCopyPath);

    // Pre-lock hooks
    const preResult = await executeHooksForType(hooks, 'pre-lock', {
      workingCopyPath,
      files: [path],
      message,
    });
    if (!preResult.allSucceeded) {
      return { success: false, error: preResult.error || 'Pre-lock hook blocked' };
    }

    const args = ['lock'];
    if (message) args.push('-m', message);
    args.push(path);
    const output = await executeSvn(args);
    return { success: true, output };
  });

  // SVN Unlock
  ipcMain.handle('svn:unlock', async (_, path: string, force?: boolean) => {
    // Get parent directory as working copy path
    const workingCopyPath = path.substring(0, path.lastIndexOf('/')) || path;
    const hooks = await getHooksForWorkingCopy(workingCopyPath);

    // Pre-unlock hooks
    const preResult = await executeHooksForType(hooks, 'pre-unlock', {
      workingCopyPath,
      files: [path],
    });
    if (!preResult.allSucceeded) {
      return { success: false, error: preResult.error || 'Pre-unlock hook blocked' };
    }

    const args = ['unlock'];
    if (force) args.push('--force');
    args.push(path);
    const output = await executeSvn(args);
    return { success: true, output };
  });

  // SVN Lock Info - Get detailed lock information for a file
  ipcMain.handle('svn:lockInfo', async (_, path: string): Promise<SvnLockInfo | null> => {
    try {
      const xml = await executeSvn(['info', '--xml', path]);
      const info = parseSvnInfoXml(xml);
      return info.lock || null;
    } catch (error) {
      debug.error('[SVN] Lock info error:', error);
      return null;
    }
  });

  // SVN Force Lock (Steal Lock) - Lock a file even if locked by another user
  ipcMain.handle('svn:lockForce', async (_, path: string, message?: string) => {
    // Get parent directory as working copy path (handle both Unix and Windows path separators)
    const lastSepIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const workingCopyPath = lastSepIndex >= 0 ? path.substring(0, lastSepIndex) : path;
    const hooks = await getHooksForWorkingCopy(workingCopyPath);

    // Pre-lock hooks
    const preResult = await executeHooksForType(hooks, 'pre-lock', {
      workingCopyPath,
      files: [path],
      message,
      force: true,
    });
    if (!preResult.allSucceeded) {
      return { success: false, error: preResult.error || 'Pre-lock hook blocked' };
    }

    try {
      const args = ['lock', '--force'];
      if (message) args.push('-m', message);
      args.push(path);
      await executeSvn(args);

      // Get lock info after successful lock
      const xml = await executeSvn(['info', '--xml', path]);
      const info = parseSvnInfoXml(xml);

      return { success: true, lock: info.lock };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      debug.error('[SVN] Force lock error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // SVN Force Unlock (Break Lock) - Unlock a file locked by another user
  ipcMain.handle('svn:unlockForce', async (_, path: string) => {
    // Get parent directory as working copy path (handle both Unix and Windows path separators)
    const lastSepIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const workingCopyPath = lastSepIndex >= 0 ? path.substring(0, lastSepIndex) : path;
    const hooks = await getHooksForWorkingCopy(workingCopyPath);

    // Pre-unlock hooks
    const preResult = await executeHooksForType(hooks, 'pre-unlock', {
      workingCopyPath,
      files: [path],
      force: true,
    });
    if (!preResult.allSucceeded) {
      return { success: false, error: preResult.error || 'Pre-unlock hook blocked' };
    }

    try {
      const args = ['unlock', '--force', path];
      await executeSvn(args);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      debug.error('[SVN] Force unlock error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // SVN Lock List - List all locks in a working copy
  ipcMain.handle('svn:lockList', async (_, path: string): Promise<SvnLockInfo[]> => {
    try {
      // Use svn status --xml to find locked files
      const xml = await executeSvn(['status', '--xml', path]);
      const locks: SvnLockInfo[] = [];

      const parsed = xmlParser.parse(xml) as {
        status?: {
          target?: {
            entry?:
              | Array<{
                  '@_path': string;
                  'wc-status'?: {
                    '@_item': string;
                    lock?: {
                      owner?: string;
                      comment?: string;
                      creationdate?: string;
                      token?: string;
                    };
                  };
                }>
              | {
                  '@_path': string;
                  'wc-status'?: {
                    '@_item': string;
                    lock?: {
                      owner?: string;
                      comment?: string;
                      creationdate?: string;
                      token?: string;
                    };
                  };
                };
          };
        };
      };

      const target = parsed.status?.target;
      if (!target) return [];

      const entries = target.entry;
      if (!entries) return [];

      const entriesArray = Array.isArray(entries) ? entries : [entries];

      for (const entry of entriesArray) {
        if (!entry || typeof entry !== 'object') continue;

        const wcStatus = entry['wc-status'];
        if (wcStatus?.lock) {
          locks.push({
            path: entry['@_path'] || '',
            owner: wcStatus.lock.owner || '',
            comment: wcStatus.lock.comment || '',
            date: wcStatus.lock['creationdate'] || '',
            token: wcStatus.lock.token,
          });
        }
      }

      return locks;
    } catch (error) {
      debug.error('[SVN] Lock list error:', error);
      return [];
    }
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
      try {
        const args = ['diff', ...paths];
        const output = await executeSvn(args);

        // Write patch to file
        await writeFile(outputPath, output, 'utf-8');
        return { success: true, output };
      } catch (error) {
        debug.error('[SVN] Patch create error:', error);
        return { success: false, output: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'svn:patch:apply',
    async (_, patchPath: string, targetPath: string, dryRun?: boolean): Promise<SvnPatchResult> => {
      try {
        const args = ['patch', patchPath, targetPath];
        if (dryRun) args.push('--dry-run');

        const output = await executeSvn(args);

        // Parse output for stats
        const filesPatchedMatch = output.match(/Patched\s+(\d+)\s+files?/i);
        const rejectsMatch = output.match(/(\d+)\s+rejects?/i);

        return {
          success: !output.includes('FAILED') && !output.includes('rejected'),
          filesPatched: filesPatchedMatch ? parseInt(filesPatchedMatch[1], 10) : 0,
          rejects: rejectsMatch ? parseInt(rejectsMatch[1], 10) : 0,
          output,
        };
      } catch (error) {
        debug.error('[SVN] Patch apply error:', error);
        return {
          success: false,
          filesPatched: 0,
          rejects: 0,
          output: (error as Error).message,
        };
      }
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

