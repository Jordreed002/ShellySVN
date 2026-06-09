import { existsSync } from 'fs';
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
import { getSslTrustCache } from '../ssl-trust-cache';
import { parseSvnInfoXml } from '../svn/parsers';
import { debug } from '../utils/debug';
import { DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES, runSvn, runSvnText } from './svn-executor';
import { runSerializedWorkingCopyMutation } from './svn-mutation-queue';
import { getWorkerSvnStatus } from './svn-status-worker';

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

function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path);
}

function getWorkingCopyRelativePath(workingCopyRoot: string, localPath: string): string {
  if (isWindowsAbsolutePath(workingCopyRoot) && isWindowsAbsolutePath(localPath)) {
    const normalizedRoot = workingCopyRoot.replaceAll('/', '\\').replace(/\\+$/, '');
    const normalizedPath = localPath.replaceAll('/', '\\');
    const rootPrefix = `${normalizedRoot}\\`;

    if (normalizedPath.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
      return normalizedPath.slice(rootPrefix.length);
    }
  }

  return relative(workingCopyRoot, localPath);
}

async function getCachedTrustedSslFailuresForWorkingCopy(
  path: string
): Promise<string | undefined> {
  try {
    const context = await getWorkingCopyContext(path);
    return context?.url ? getCachedTrustedSslFailuresForUrl(context.url) : undefined;
  } catch (error) {
    debug.warn('[SSL] Failed to resolve cached trust for working copy:', error);
    return undefined;
  }
}

async function getCachedTrustedSslFailuresForUrl(url: string): Promise<string | undefined> {
  const cache = getSslTrustCache();
  await cache.ready();
  return cache.findForUrl(url)?.failures;
}

/** Cached credentials for a working copy's repository URL, if any. */
async function getCachedCredentialsForWorkingCopy(
  path: string
): Promise<{ username: string; password: string } | undefined> {
  try {
    const context = await getWorkingCopyContext(path);
    if (!context?.url) return undefined;
    const match = getAuthCache().findForUrl(context.url);
    return match ? { username: match.username, password: match.password } : undefined;
  } catch (error) {
    debug.warn('[SVN] Failed to resolve cached credentials for working copy:', error);
    return undefined;
  }
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

export async function getStatus(path: string, workerJobId?: string): Promise<SvnStatusResult> {
  try {
    return workerJobId
      ? getWorkerSvnStatus(path, { jobId: workerJobId })
      : getWorkerSvnStatus(path);
  } catch (error) {
    debug.error('[SVN] Status error:', error);
    return { path, entries: [], revision: 0 };
  }
}

export async function getRemoteStatus(
  path: string,
  workerJobId?: string
): Promise<SvnStatusResult> {
  try {
    const context = await getWorkingCopyContext(path);
    const repoUrl = context?.url;
    const authCache = getAuthCache();
    await authCache.ready();
    const credentialMatch = repoUrl ? authCache.findForUrl(repoUrl) : null;
    const trustedSslFailures = repoUrl
      ? await getCachedTrustedSslFailuresForUrl(repoUrl)
      : undefined;
    const options = {
      showUpdates: true,
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
      credentials: credentialMatch
        ? { username: credentialMatch.username, password: credentialMatch.password }
        : undefined,
      ...(workerJobId ? { jobId: workerJobId } : {}),
    };
    return getWorkerSvnStatus(path, options);
  } catch (error) {
    debug.error('[SVN] Remote status error:', error);
    return { path, entries: [], revision: 0, remoteChecked: true };
  }
}

export async function getWorkingCopyUpgradeStatus(path: string): Promise<WorkingCopyUpgradeStatus> {
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
    const xml = await runSvnText(['info', '--xml', '--non-interactive', url]);
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
  return runSerializedWorkingCopyMutation(path, async () =>
    updateUnserialized(path, depth, options)
  );
}

async function updateUnserialized(
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): Promise<{ success: boolean; revision?: number; error?: string }> {
  const trustedSslFailures = await getCachedTrustedSslFailuresForWorkingCopy(path);

  try {
    await runSvnText(['info', '--xml', path], {
      cwd: path,
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
    });
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

  const credentials = await getCachedCredentialsForWorkingCopy(path);

  try {
    const output = await runSvnText(buildUpdateArgs(path, depth, options), {
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
      credentials,
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
        error:
          'Working copy is locked. Try running "Cleanup" from the toolbar to resolve this issue.',
      };
    }
    if (errorMsg.includes('E155036')) {
      return {
        success: false,
        error:
          'Working copy format is too old. Use the working copy upgrade prompt in ShellySVN before updating.',
      };
    }
    if (
      errorMsg.includes('E215004') ||
      errorMsg.includes('E170013') ||
      /authentication failed|no more credentials/i.test(errorMsg)
    ) {
      return {
        success: false,
        error:
          'Authentication failed connecting to the repository. Check your credentials in Settings → Authentication and try again.',
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
  const trustedSslFailures = await getCachedTrustedSslFailuresForWorkingCopy(path);
  const credentials = await getCachedCredentialsForWorkingCopy(path);
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
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
      credentials,
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

    const trustedSslFailures = context.url
      ? await getCachedTrustedSslFailuresForUrl(context.url)
      : undefined;
    const output = await runSvnText(['update', '--parents', '--depth', 'infinity', localPath], {
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
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

export async function updateToRevision(
  workingCopyRoot: string,
  repoUrl: string,
  localPath: string,
  depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'infinity',
  setDepthSticky: boolean = false
): Promise<{ success: boolean; revision: number; error?: string }> {
  return runSerializedWorkingCopyMutation(workingCopyRoot, async () =>
    updateToRevisionUnserialized(workingCopyRoot, repoUrl, localPath, depth, setDepthSticky)
  );
}

async function updateToRevisionUnserialized(
  workingCopyRoot: string,
  repoUrl: string,
  localPath: string,
  depth: 'empty' | 'files' | 'immediates' | 'infinity',
  setDepthSticky: boolean
): Promise<{ success: boolean; revision: number; error?: string }> {
  try {
    const relativePath = getWorkingCopyRelativePath(workingCopyRoot, localPath);

    debug.log('[updateToRevision] workingCopyRoot:', workingCopyRoot);
    debug.log('[updateToRevision] repoUrl:', repoUrl);
    debug.log('[updateToRevision] localPath:', localPath);
    debug.log('[updateToRevision] relativePath:', relativePath);
    debug.log('[updateToRevision] depth:', depth);
    debug.log('[updateToRevision] setDepthSticky:', setDepthSticky);

    const authCache = getAuthCache();
    const credentialMatch = repoUrl ? authCache.findForUrl(repoUrl) : null;
    const trustedSslFailures = repoUrl
      ? await getCachedTrustedSslFailuresForUrl(repoUrl)
      : undefined;
    const credentials = credentialMatch
      ? { username: credentialMatch.username, password: credentialMatch.password }
      : undefined;
    if (credentials) {
      debug.log('[updateToRevision] Using cached credentials for realm:', credentialMatch?.realm);
    }

    const args = ['update'];
    args.push('--parents');
    if (setDepthSticky) {
      args.push('--set-depth', depth);
    } else {
      args.push('--depth', depth);
    }
    args.push(relativePath);

    debug.log('[updateToRevision] Running svn with args:', args);
    const output = await runSvnText(args, {
      cwd: workingCopyRoot,
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
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
  return runSerializedWorkingCopyMutation(paths[0], async () => {
    await runSvnText(['revert', ...paths]);
    return { success: true };
  });
}

/**
 * Unschedule an accidental `svn add` for the given paths, recursively. The files
 * stay on disk (becoming unversioned again); only the pending addition is undone.
 */
export async function unversion(paths: string[]): Promise<{ success: boolean }> {
  return runSerializedWorkingCopyMutation(paths[0], async () => {
    await runSvnText(['revert', '--depth', 'infinity', ...paths]);
    return { success: true };
  });
}

export async function add(paths: string[]): Promise<{ success: boolean }> {
  return runSerializedWorkingCopyMutation(paths[0], async () => {
    await runSvnText(['add', ...paths]);
    return { success: true };
  });
}

export async function remove(paths: string[]): Promise<{ success: boolean }> {
  return runSerializedWorkingCopyMutation(paths[0], async () => {
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
  });
}

export async function cleanup(path: string): Promise<{ success: boolean }> {
  return runSerializedWorkingCopyMutation(path, async () => {
    await runSvnText(['cleanup', path]);
    return { success: true };
  });
}

export async function move(
  src: string,
  dst: string
): Promise<{ success: boolean; output?: string }> {
  return runSerializedWorkingCopyMutation(src, async () => {
    const output = await runSvnText(['move', src, dst]);
    return { success: true, output };
  });
}

export async function rename(
  src: string,
  dst: string
): Promise<{ success: boolean; output?: string }> {
  return move(src, dst);
}
