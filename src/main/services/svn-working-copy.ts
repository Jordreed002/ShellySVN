import { existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, normalize, relative, win32 } from 'path';
import { shell, type IpcMainInvokeEvent } from 'electron';

import type {
  CheckoutProgress,
  SvnInfoResult,
  SvnCleanupPreview,
  SvnOperationRevision,
  SvnStatusResult,
  UpdateOptions,
  WorkingCopyUpgradeStatus,
  SvnWorkingCopyContext,
} from '@shared/types';
import { getAuthCache } from '../auth-cache';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getStore } from '../ipc/store';
import { getSslTrustCache } from '../ssl-trust-cache';
import { parseSvnInfoXml, parseSvnChildCommitsXml, type ChildCommitInfo } from '../svn/parsers';
import { debug } from '../utils/debug';
import { parseSvnStatusEntriesXml } from '../utils/svn-xml';
import { getSvnReadError } from '../utils/svn-errors';
import { escapeLocalPegTargets, validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
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

function parseUpdatedRevision(output: string): number | null {
  const match = output.match(/(?:Updated to|At) revision (\d+)\./);
  return match ? parseInt(match[1], 10) : null;
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
  return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

function getWorkingCopyRelativePath(workingCopyRoot: string, localPath: string): string {
  if (isWindowsAbsolutePath(workingCopyRoot) && isWindowsAbsolutePath(localPath)) {
    const relativePath = win32.relative(
      win32.normalize(workingCopyRoot),
      win32.normalize(localPath)
    );
    if (!relativePath) return '.';
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..\\`) ||
      win32.isAbsolute(relativePath)
    ) {
      throw new Error('Update target is outside the working copy');
    }
    return relativePath;
  }

  const relativePath = relative(workingCopyRoot, localPath);
  if (!relativePath) return '.';
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Update target is outside the working copy');
  }
  return relativePath;
}

function canonicalizeLocalPath(path: string): string {
  const normalizedPath = isWindowsAbsolutePath(path) ? win32.normalize(path) : normalize(path);
  if (!existsSync(normalizedPath)) return normalizedPath;
  try {
    return normalize(realpathSync.native(normalizedPath));
  } catch {
    return normalizedPath;
  }
}

function appendLocalSegmentsToSvnUrl(baseUrl: string, relativePath: string): string {
  if (relativePath === '.') return baseUrl.replace(/\/+$/, '');
  const encodedPath = relativePath
    .split(/[/\\]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${baseUrl.replace(/\/+$/, '')}/${encodedPath}`;
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
  if (!/^https:\/\//i.test(url)) return undefined;

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
): Promise<SvnWorkingCopyContext | null> {
  const requestedPath = canonicalizeLocalPath(localPath);
  let currentPath = requestedPath;

  for (let attempts = 0; attempts < 50; attempts++) {
    try {
      const info = parseSvnInfoXml(await runSvnText(['info', '--xml', currentPath]));

      if (info.workingCopyRoot && info.repositoryRoot && info.url) {
        const nearestVersionedPath = canonicalizeLocalPath(currentPath);
        const workingCopyRoot = canonicalizeLocalPath(info.workingCopyRoot);
        // Both checks are intentionally segment-aware. The first prevents an
        // ancestor probe from accepting a sibling prefix; the second catches a
        // symlink that escapes the administrative working-copy root.
        getWorkingCopyRelativePath(nearestVersionedPath, requestedPath);
        getWorkingCopyRelativePath(workingCopyRoot, nearestVersionedPath);
        const relativePath = getWorkingCopyRelativePath(nearestVersionedPath, requestedPath);
        return {
          workingCopyRoot,
          repositoryRoot: info.repositoryRoot.replace(/\/+$/, ''),
          repositoryUuid: info.repositoryUuid,
          url: appendLocalSegmentsToSvnUrl(info.url, relativePath),
          localPath: requestedPath,
          nearestVersionedPath,
          nearestVersionedUrl: info.url.replace(/\/+$/, ''),
          derived: relativePath !== '.',
        };
      }
    } catch {
      // Unversioned and sparse paths are expected here. Continue to the nearest
      // parent for which SVN can provide its actual (possibly switched) URL.
    }

    const parent = isWindowsAbsolutePath(currentPath)
      ? win32.dirname(currentPath)
      : dirname(currentPath);
    if (parent === currentPath) break;
    currentPath = parent;
  }

  return null;
}

export async function getStatus(path: string, workerJobId?: string): Promise<SvnStatusResult> {
  try {
    return await (workerJobId
      ? getWorkerSvnStatus(path, { jobId: workerJobId })
      : getWorkerSvnStatus(path));
  } catch (error) {
    debug.error('[SVN] Status error:', error);
    return {
      path,
      entries: [],
      revision: 0,
      ...getSvnReadError(error, { command: 'status', target: path }),
    };
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
    return await getWorkerSvnStatus(path, options);
  } catch (error) {
    debug.error('[SVN] Remote status error:', error);
    return {
      path,
      entries: [],
      revision: 0,
      remoteChecked: true,
      ...getSvnReadError(error, { command: 'status --show-updates', target: path }),
    };
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
): Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }> {
  return runSerializedWorkingCopyMutation(path, async () =>
    updateUnserialized(path, depth, options)
  );
}

async function updateUnserialized(
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }> {
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
      revision: null,
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
    return { success: false, revision: null, error: preResult.error || 'Pre-update hook blocked' };
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
        revision: null,
        error: 'Not a working copy. The selected path is not under SVN version control.',
      };
    }
    if (errorMsg.includes('E155004')) {
      return {
        success: false,
        revision: null,
        error:
          'Working copy is locked. Try running "Cleanup" from the toolbar to resolve this issue.',
      };
    }
    if (errorMsg.includes('E155036')) {
      return {
        success: false,
        revision: null,
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
        revision: null,
        error:
          'Authentication failed connecting to the repository. Check your credentials in Settings → Authentication and try again.',
      };
    }

    return { success: false, revision: null, error: `SVN update failed: ${errorMsg}` };
  }
}

export async function updateWithProgress(
  event: IpcMainInvokeEvent,
  updateId: string,
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): Promise<{
  success: boolean;
  revision: SvnOperationRevision;
  error?: string;
  output?: string;
}> {
  return runSerializedWorkingCopyMutation(path, async () =>
    updateWithProgressUnserialized(event, updateId, path, depth, options)
  );
}

async function updateWithProgressUnserialized(
  event: IpcMainInvokeEvent,
  updateId: string,
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): Promise<{
  success: boolean;
  revision: SvnOperationRevision;
  error?: string;
  output?: string;
}> {
  const trustedSslFailures = await getCachedTrustedSslFailuresForWorkingCopy(path);
  const credentials = await getCachedCredentialsForWorkingCopy(path);
  const controller = new AbortController();
  activeUpdates.set(updateId, controller);

  let filesProcessed = 0;
  let currentFile = '';
  let lastProgressTime = 0;
  let streamedRevision: number | null = null;
  let revisionBuffer = '';
  let lineBuffer = '';
  const processedPaths = new Set<string>();
  const progressThrottleMs = 250;

  const sendProgress = (progress: CheckoutProgress) => {
    event.sender.send('svn:update:progress', { updateId, ...progress });
  };

  try {
    await runSvnText(['info', '--xml', path], {
      cwd: path,
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
      credentials,
    });

    const hooks = await getHooksForWorkingCopy(path);
    const preResult = await executeHooksForType(hooks, 'pre-update', {
      workingCopyPath: path,
    });
    if (!preResult.allSucceeded) {
      const error = preResult.error || 'Pre-update hook blocked';
      sendProgress({ status: 'error', filesProcessed, error });
      return { success: false, revision: null, error };
    }

    const result = await runSvn(buildUpdateArgs(path, depth, options), {
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
      credentials,
      signal: controller.signal,
      maxStdoutBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      maxStderrBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      onStdout: (chunk) => {
        revisionBuffer = (revisionBuffer + chunk).slice(-2000);
        streamedRevision = parseUpdatedRevision(revisionBuffer) ?? streamedRevision;

        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = parseSvnProgressLine(line);
          if (!parsed.path || processedPaths.has(parsed.path)) continue;

          processedPaths.add(parsed.path);
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

    const revision = streamedRevision ?? parseUpdatedRevision(result.stdout);
    sendProgress({
      status: 'completed',
      currentFile,
      filesProcessed,
      revision,
    });

    executeHooksForType(hooks, 'post-update', {
      workingCopyPath: path,
      revision,
    }).catch((error) => debug.error('[SVN] Post-update hook error:', error));

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
    return { success: false, revision: null, error: message };
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

/**
 * Last-commit info (revision/author/date) for each immediate child of a
 * directory, read from the working copy (offline). Used for the Explorer's
 * last-activity column. Returns {} on failure.
 */
export async function getChildCommits(path: string): Promise<Record<string, ChildCommitInfo>> {
  try {
    const xml = await runSvnText(['info', '--xml', '--depth', 'immediates', path]);
    return parseSvnChildCommitsXml(xml, path);
  } catch (error) {
    debug.warn('[SVN] getChildCommits failed:', error);
    return {};
  }
}

export async function updateItem(
  localPath: string
): Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }> {
  return runSerializedWorkingCopyMutation(localPath, async () => updateItemUnserialized(localPath));
}

async function updateItemUnserialized(
  localPath: string
): Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }> {
  try {
    const context = await getWorkingCopyContext(localPath);
    if (!context) {
      return { success: false, revision: null, error: 'Not inside a working copy' };
    }

    const trustedSslFailures = context.url
      ? await getCachedTrustedSslFailuresForUrl(context.url)
      : undefined;
    const credentials = await getCachedCredentialsForWorkingCopy(localPath);
    const hooks = await getHooksForWorkingCopy(context.workingCopyRoot);
    const preResult = await executeHooksForType(hooks, 'pre-update', {
      workingCopyPath: context.workingCopyRoot,
    });
    if (!preResult.allSucceeded) {
      return {
        success: false,
        revision: null,
        error: preResult.error || 'Pre-update hook blocked',
      };
    }
    const output = await runSvnText(['update', '--parents', '--depth', 'infinity', localPath], {
      trustSslFailures: trustedSslFailures !== undefined,
      trustedSslFailures,
      credentials,
    });

    const revision = parseUpdatedRevision(output);
    executeHooksForType(hooks, 'post-update', {
      workingCopyPath: context.workingCopyRoot,
      revision,
    }).catch((error) => debug.error('[SVN] Post-update hook error:', error));

    return {
      success: true,
      revision,
    };
  } catch (error) {
    return {
      success: false,
      revision: null,
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
): Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }> {
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
): Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }> {
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

    const hooks = await getHooksForWorkingCopy(workingCopyRoot);
    const preResult = await executeHooksForType(hooks, 'pre-update', {
      workingCopyPath: workingCopyRoot,
    });
    if (!preResult.allSucceeded) {
      return {
        success: false,
        revision: null,
        error: preResult.error || 'Pre-update hook blocked',
      };
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

    const revision = parseUpdatedRevision(output);
    executeHooksForType(hooks, 'post-update', {
      workingCopyPath: workingCopyRoot,
      revision,
    }).catch((error) => debug.error('[SVN] Post-update hook error:', error));

    return {
      success: true,
      revision,
    };
  } catch (error) {
    return {
      success: false,
      revision: null,
      error: (error as Error)?.message || 'Update failed',
    };
  }
}

export async function revert(
  paths: string[],
  depth: import('@shared/types').SvnRevertDepth = 'infinity'
): Promise<{ success: boolean }> {
  validateSvnTargets(paths, 'Revert target');
  return runSerializedWorkingCopyMutation(paths[0], async () => {
    await runSvnText(withSvnTargets(['revert', '--depth', depth], paths));
    return { success: true };
  });
}

export async function previewRevert(
  paths: string[],
  depth: import('@shared/types').SvnRevertDepth = 'infinity'
): Promise<import('@shared/types').SvnRevertPreview> {
  validateSvnTargets(paths, 'Revert target');
  const xml = await runSvnText(withSvnTargets(['status', '--xml', '--depth', depth], paths));
  const unaffectedItems = new Set(['normal', 'none', 'unversioned', 'ignored', 'external']);
  const affectedPaths = parseSvnStatusEntriesXml(xml)
    .filter((entry) => !unaffectedItems.has(entry.item))
    .map((entry) => entry.path);
  return { depth, paths: Array.from(new Set(affectedPaths)).sort() };
}

/**
 * Unschedule an accidental `svn add` for the given paths, recursively. The files
 * stay on disk (becoming unversioned again); only the pending addition is undone.
 */
export async function unversion(paths: string[]): Promise<{ success: boolean }> {
  validateSvnTargets(paths, 'Unversion target');
  return runSerializedWorkingCopyMutation(paths[0], async () => {
    await runSvnText(withSvnTargets(['revert', '--depth', 'infinity'], paths));
    return { success: true };
  });
}

/**
 * Remove a versioned folder from the local working copy while leaving the
 * repository unchanged. SVN records a sticky `exclude` depth so later updates
 * do not bring the folder back automatically.
 */
export async function excludeFromWorkingCopy(
  path: string
): Promise<{ success: boolean; error?: string }> {
  validateSvnTargets([path], 'Sparse exclude target');
  return runSerializedWorkingCopyMutation(path, async () => {
    try {
      await runSvnText(withSvnTargets(['update', '--set-depth', 'exclude'], [path]));
    } catch (error) {
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to exclude folder from working copy',
      };
    }

    // A clean sparse exclusion normally removes the directory itself. If
    // unversioned or ignored content caused SVN to leave it behind, move the
    // remainder to the OS trash only after SVN confirmed the exclusion.
    try {
      if (existsSync(path)) {
        await shell.trashItem(path);
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `SVN excluded the folder, but its remaining local files could not be moved to the trash: ${
          (error as Error)?.message || 'Unknown filesystem error'
        }`,
      };
    }
  });
}

export async function add(paths: string[]): Promise<{ success: boolean }> {
  validateSvnTargets(paths, 'Add target');
  return runSerializedWorkingCopyMutation(paths[0], async () => {
    await runSvnText(withSvnTargets(['add'], paths));
    return { success: true };
  });
}

export async function remove(paths: string[]): Promise<{ success: boolean }> {
  validateSvnTargets(paths, 'Delete target');
  return runSerializedWorkingCopyMutation(paths[0], async () => {
    const svnPaths: string[] = [];

    for (const path of paths) {
      const status = await getStatus(path);
      if (status.error) {
        throw new Error(`Cannot safely delete "${path}": ${status.error}`);
      }
      const entry = status.entries.find((item) => item.path === path) ?? status.entries[0];

      if (entry?.status === '?' || entry?.status === 'I') {
        await shell.trashItem(path);
      } else {
        svnPaths.push(path);
      }
    }

    if (svnPaths.length > 0) {
      await runSvnText(withSvnTargets(['delete', '--force'], svnPaths));
    }

    return { success: true };
  });
}

export async function cleanup(
  path: string,
  options: import('@shared/types').SvnCleanupOptions = {}
): Promise<{ success: boolean }> {
  validateSvnTargets([path], 'Cleanup target');
  return runSerializedWorkingCopyMutation(path, async () => {
    const args = ['cleanup'];
    if (options.removeUnversioned) args.push('--remove-unversioned');
    if (options.removeIgnored) args.push('--remove-ignored');
    if (options.vacuumPristines) args.push('--vacuum-pristines');
    if (options.includeExternals) args.push('--include-externals');
    args.push(escapeLocalPegTargets([path])[0]);
    await runSvnText(args);
    return { success: true };
  });
}

export async function previewCleanup(path: string): Promise<SvnCleanupPreview> {
  validateSvnTargets([path], 'Cleanup target');
  const xml = await runSvnText(['status', '--xml', '--no-ignore', '--depth', 'infinity', path]);
  const preview: SvnCleanupPreview = { unversioned: [], ignored: [] };
  for (const entry of parseSvnStatusEntriesXml(xml)) {
    if (entry.item === 'unversioned') preview.unversioned.push(entry.path);
    if (entry.item === 'ignored') preview.ignored.push(entry.path);
  }
  preview.unversioned.sort();
  preview.ignored.sort();
  return preview;
}

export async function move(
  src: string,
  dst: string
): Promise<{ success: boolean; output?: string }> {
  validateSvnTargets([src, dst], 'Move target');
  return runSerializedWorkingCopyMutation(src, async () => {
    const output = await runSvnText(withSvnTargets(['move'], [src, dst]));
    return { success: true, output };
  });
}

export async function copy(
  src: string,
  dst: string
): Promise<{ success: boolean; output?: string }> {
  validateSvnTargets([src, dst], 'Copy target');
  return runSerializedWorkingCopyMutation(src, async () => {
    const output = await runSvnText(withSvnTargets(['copy'], [src, dst]));
    return { success: true, output };
  });
}
