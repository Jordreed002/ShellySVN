import { existsSync, mkdirSync } from 'fs';
import { rm } from 'fs/promises';
import { dirname, join, normalize, relative } from 'path';
import type { IpcMainInvokeEvent } from 'electron';

import type {
  CheckoutProgress,
  SvnInfoResult,
  SvnStatusResult,
  UpdateOptions,
  WorkingCopyUpgradeStatus,
} from '@shared/types';
import { getAuthCache } from '../auth-cache';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getStore } from '../ipc/store';
import { parseSvnInfoXml, parseSvnStatusXml } from '../svn/parsers';
import { debug } from '../utils/debug';
import { DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES, runSvn, runSvnText } from './svn-executor';

const DEFAULT_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'].join(',');
const activeUpdates = new Map<string, AbortController>();

async function getHooksForWorkingCopy(workingCopyPath: string): Promise<HookScript[]> {
  try {
    const store = await getStore();
    const stored = await store.get<Record<string, HookScript[]>>('shellysvn:hook-scripts');
    if (stored && stored[workingCopyPath]) {
      return stored[workingCopyPath];
    }
  } catch (error) {
    debug.error('[SVN] Failed to get hooks (continuing without hooks):', error);
  }
  return [];
}

function parseUpdatedRevision(output: string): number {
  const match = output.match(/(?:Updated to|At) revision (\d+)\./);
  return match ? parseInt(match[1], 10) : 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function isWorkingCopyUpgradeRequired(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('e155036') ||
    message.includes('working copy format is too old') ||
    message.includes('working copy is too old') ||
    message.includes('needs to be upgraded')
  );
}

function buildUpdateArgs(
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): string[] {
  const args = ['update'];
  const revision = options?.revision?.trim();
  if (revision && revision.toUpperCase() !== 'HEAD') {
    args.push('-r', revision);
  }
  if (depth) args.push('--depth', depth);
  if (options?.ignoreExternals) args.push('--ignore-externals');
  if (options?.force) args.push('--force');
  args.push(path);
  return args;
}

function parseSvnProgressLine(line: string): { action: string | null; path: string | null } {
  const match = line.match(/^([AUCDGER ])\s+(.+)$/);
  if (!match) return { action: null, path: null };
  return { action: match[1].trim() || ' ', path: match[2].trim() };
}

export async function getWorkingCopyContext(
  localPath: string
): Promise<{ workingCopyRoot: string; repositoryRoot: string; url: string } | null> {
  let currentPath = localPath;

  for (let attempts = 0; attempts < 50; attempts++) {
    const svnDir = join(currentPath, '.svn');
    if (existsSync(svnDir)) {
      try {
        const xml = await runSvnText(['info', '--xml', currentPath]);
        const info = parseSvnInfoXml(xml);

        if (info.workingCopyRoot && info.repositoryRoot && info.url) {
          const relativePath = localPath.slice(currentPath.length);
          return {
            workingCopyRoot: normalize(info.workingCopyRoot),
            repositoryRoot: info.repositoryRoot,
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
}

export async function getStatus(path: string): Promise<SvnStatusResult> {
  try {
    const xml = await runSvnText(['status', '--xml', path]);
    return parseSvnStatusXml(xml, path);
  } catch (error) {
    debug.error('[SVN] Status error:', error);
    return { path, entries: [], revision: 0 };
  }
}

export async function getRemoteStatus(path: string): Promise<SvnStatusResult> {
  try {
    const xml = await runSvnText(['status', '--xml', '--show-updates', path], {
      trustSslFailures: true,
    });
    return { ...parseSvnStatusXml(xml, path), remoteChecked: true };
  } catch (error) {
    debug.error('[SVN] Remote status error:', error);
    return { path, entries: [], revision: 0, remoteChecked: true };
  }
}

export async function getWorkingCopyUpgradeStatus(
  path: string
): Promise<WorkingCopyUpgradeStatus> {
  try {
    await runSvnText(['info', '--xml', path]);
    return { path, required: false };
  } catch (error) {
    const message = getErrorMessage(error);
    if (isWorkingCopyUpgradeRequired(error)) {
      return {
        path,
        required: true,
        reason:
          'This working copy was created by an older SVN client and must be upgraded before normal operations can continue.',
      };
    }

    debug.error('[SVN] Working copy upgrade status check failed:', error);
    return { path, required: false, error: message };
  }
}

export async function upgradeWorkingCopy(
  path: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    const output = await runSvnText(['upgrade', path]);
    return { success: true, output };
  } catch (error) {
    const message = getErrorMessage(error);
    debug.error('[SVN] Working copy upgrade failed:', error);
    return { success: false, error: message };
  }
}

export async function getInfo(path: string): Promise<SvnInfoResult> {
  try {
    const xml = await runSvnText(['info', '--xml', path]);
    return parseSvnInfoXml(xml);
  } catch (error) {
    debug.error('[SVN] Info error:', error);
    throw error;
  }
}

export async function getInfoUrl(url: string): Promise<SvnInfoResult> {
  try {
    const xml = await runSvnText([
      'info',
      '--xml',
      '--non-interactive',
      '--trust-server-cert-failures',
      DEFAULT_SSL_FAILURES,
      url,
    ]);
    return parseSvnInfoXml(xml);
  } catch (error) {
    debug.error('[SVN] Info URL error:', error);
    throw error;
  }
}

export async function update(
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): Promise<{ success: boolean; revision?: number; error?: string }> {
  try {
    await runSvnText(['info', '--xml', path], { cwd: path, trustSslFailures: true });
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
  const preResult = await executeHooksForType(hooks, 'pre-update', {
    workingCopyPath: path,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-update hook blocked' };
  }

  try {
    const output = await runSvnText(buildUpdateArgs(path, depth, options), {
      trustSslFailures: true,
    });
    const result = {
      success: true,
      revision: parseUpdatedRevision(output),
    };

    executeHooksForType(hooks, 'post-update', {
      workingCopyPath: path,
      revision: result.revision,
    }).catch((err) => debug.error('[SVN] Post-update hook error:', err));

    return result;
  } catch (error) {
    const errorMsg = (error as Error).message || '';
    debug.error('[SVN] Update failed:', path, errorMsg);

    if (errorMsg.includes('E155007')) {
      return {
        success: false,
        error: 'Not a working copy. The selected path is not under SVN version control.',
      };
    }
    if (errorMsg.includes('E155004')) {
      return {
        success: false,
        error: 'Working copy is locked. Try running "Cleanup" from the toolbar to resolve this issue.',
      };
    }
    if (errorMsg.includes('E155036')) {
      return {
        success: false,
        error:
          'Working copy format is too old. Use the working copy upgrade prompt in ShellySVN before updating.',
      };
    }

    return { success: false, error: `SVN update failed: ${errorMsg}` };
  }
}

export async function updateWithProgress(
  event: IpcMainInvokeEvent,
  updateId: string,
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): Promise<{ success: boolean; revision: number; error?: string; output?: string }> {
  const controller = new AbortController();
  activeUpdates.set(updateId, controller);

  let filesProcessed = 0;
  let currentFile = '';
  let lastProgressTime = 0;
  let streamedRevision = 0;
  let revisionBuffer = '';
  const progressThrottleMs = 250;

  const sendProgress = (progress: CheckoutProgress) => {
    event.sender.send('svn:update:progress', { updateId, ...progress });
  };

  try {
    const result = await runSvn(buildUpdateArgs(path, depth, options), {
      trustSslFailures: true,
      signal: controller.signal,
      maxStdoutBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      maxStderrBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      onStdout: (chunk) => {
        revisionBuffer = (revisionBuffer + chunk).slice(-2000);
        streamedRevision = parseUpdatedRevision(revisionBuffer) || streamedRevision;

        for (const line of chunk.split(/\r?\n/)) {
          const parsed = parseSvnProgressLine(line);
          if (!parsed.path) continue;

          filesProcessed++;
          currentFile = parsed.path;
          const now = Date.now();
          if (now - lastProgressTime >= progressThrottleMs) {
            lastProgressTime = now;
            sendProgress({
              status: 'running',
              currentFile,
              filesProcessed,
            });
          }
        }
      },
    });

    const revision = streamedRevision || parseUpdatedRevision(result.stdout);
    sendProgress({
      status: 'completed',
      currentFile,
      filesProcessed,
      revision,
    });

    return { success: true, revision, output: result.stdout };
  } catch (error) {
    const message = getErrorMessage(error);
    const cancelled = message.toLowerCase().includes('cancelled');
    sendProgress({
      status: cancelled ? 'cancelled' : 'error',
      currentFile,
      filesProcessed,
      error: message,
    });
    return { success: false, revision: 0, error: message };
  } finally {
    if (activeUpdates.get(updateId) === controller) {
      activeUpdates.delete(updateId);
    }
  }
}

export function cancelUpdate(updateId: string): { success: boolean; error?: string } {
  const controller = activeUpdates.get(updateId);
  if (!controller) {
    return { success: false, error: 'No active update found with that ID' };
  }

  controller.abort();
  activeUpdates.delete(updateId);
  debug.log(`[SVN] Cancelled update: ${updateId}`);
  return { success: true };
}

export async function updateItem(
  localPath: string
): Promise<{ success: boolean; revision: number; error?: string }> {
  try {
    const context = await getWorkingCopyContext(localPath);
    if (!context) {
      return { success: false, revision: 0, error: 'Not inside a working copy' };
    }

    if (!existsSync(localPath)) {
      mkdirSync(localPath, { recursive: true });
    }

    const output = await runSvnText(['update', '--depth', 'infinity', localPath]);

    return {
      success: true,
      revision: parseUpdatedRevision(output),
    };
  } catch (error) {
    return {
      success: false,
      revision: 0,
      error: (error as Error)?.message || 'Update failed',
    };
  }
}

export async function updateToRevision(
  workingCopyRoot: string,
  repoUrl: string,
  localPath: string,
  depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'infinity',
  setDepthSticky: boolean = false
): Promise<{ success: boolean; revision: number; error?: string }> {
  try {
    const relativePath = relative(workingCopyRoot, localPath);

    debug.log('[updateToRevision] workingCopyRoot:', workingCopyRoot);
    debug.log('[updateToRevision] repoUrl:', repoUrl);
    debug.log('[updateToRevision] localPath:', localPath);
    debug.log('[updateToRevision] relativePath:', relativePath);
    debug.log('[updateToRevision] depth:', depth);
    debug.log('[updateToRevision] setDepthSticky:', setDepthSticky);

    const authCache = getAuthCache();
    const credentialMatch = repoUrl ? authCache.findForUrl(repoUrl) : null;
    const credentials = credentialMatch
      ? { username: credentialMatch.username, password: credentialMatch.password }
      : undefined;
    if (credentials) {
      debug.log('[updateToRevision] Using cached credentials for realm:', credentialMatch?.realm);
    }

    const pathParts = relativePath.split(/[/\\]/).filter((part) => part.length > 0);

    for (let i = 0; i < pathParts.length - 1; i++) {
      const partialPath = pathParts.slice(0, i + 1).join('/');
      const fullPath = join(workingCopyRoot, partialPath);

      const parentArgs = ['update', '--set-depth', 'immediates', partialPath];
      if (!existsSync(fullPath)) {
        debug.log('[updateToRevision] Creating parent with --set-depth immediates:', partialPath);
        await runSvnText(parentArgs, { cwd: workingCopyRoot, trustSslFailures: true, credentials });
      } else {
        debug.log(
          '[updateToRevision] Opening parent to see children with --set-depth immediates:',
          partialPath
        );
        try {
          await runSvnText(parentArgs, {
            cwd: workingCopyRoot,
            trustSslFailures: true,
            credentials,
          });
        } catch (error) {
          debug.log(
            '[updateToRevision] Parent depth update failed (may already be sufficient):',
            (error as Error)?.message
          );
        }
      }
    }

    const targetFullPath = join(workingCopyRoot, relativePath);
    if (!existsSync(targetFullPath)) {
      debug.log('[updateToRevision] Target does not exist, fetching with --depth empty first:', relativePath);
      try {
        await runSvnText(['update', '--depth', 'empty', relativePath], {
          cwd: workingCopyRoot,
          trustSslFailures: true,
          credentials,
        });
      } catch (error) {
        debug.log('[updateToRevision] Initial target fetch failed:', (error as Error)?.message);
      }
    }

    const args = ['update'];
    if (setDepthSticky) {
      args.push('--set-depth', depth);
    } else {
      args.push('--depth', depth);
    }
    args.push(relativePath);

    debug.log('[updateToRevision] Running svn with args:', args);
    const output = await runSvnText(args, {
      cwd: workingCopyRoot,
      trustSslFailures: true,
      credentials,
    });

    return {
      success: true,
      revision: parseUpdatedRevision(output),
    };
  } catch (error) {
    return {
      success: false,
      revision: 0,
      error: (error as Error)?.message || 'Update failed',
    };
  }
}

export async function revert(paths: string[]): Promise<{ success: boolean }> {
  await runSvnText(['revert', ...paths]);
  return { success: true };
}

export async function add(paths: string[]): Promise<{ success: boolean }> {
  await runSvnText(['add', ...paths]);
  return { success: true };
}

export async function remove(paths: string[]): Promise<{ success: boolean }> {
  const svnPaths: string[] = [];

  for (const path of paths) {
    const status = await getStatus(path);
    const entry = status.entries.find((item) => item.path === path) ?? status.entries[0];

    if (entry?.status === '?' || entry?.status === 'I') {
      await rm(path, { recursive: true, force: true });
    } else {
      svnPaths.push(path);
    }
  }

  if (svnPaths.length > 0) {
    await runSvnText(['delete', '--force', ...svnPaths]);
  }

  return { success: true };
}

export async function cleanup(path: string): Promise<{ success: boolean }> {
  await runSvnText(['cleanup', path]);
  return { success: true };
}

export async function move(src: string, dst: string): Promise<{ success: boolean; output?: string }> {
  const output = await runSvnText(['move', src, dst]);
  return { success: true, output };
}

export async function rename(src: string, dst: string): Promise<{ success: boolean; output?: string }> {
  return move(src, dst);
}
