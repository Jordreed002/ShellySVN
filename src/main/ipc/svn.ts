import { BrowserWindow, ipcMain } from 'electron';

import type {
  LockForceConfirmation,
  PristineAnalysisOptions,
  RelinkProposal,
  RevpropConfirmation,
  SecretScanOptions,
  CheckoutOptions,
  BranchComparisonResult,
  MergeReadinessReport,
  RepoDiagnostics,
  RevisionImpactReport,
  OperationResult,
  SvnBlameResult,
  SvnCatResult,
  SvnChangelistResult,
  SvnDiffResult,
  SvnExternal,
  SvnExternalsResult,
  SvnInfoResult,
  SvnListResult,
  SvnLogResult,
  SvnMergeInfoKind,
  SvnMergeInfoResult,
  SvnRepoLayout,
  SvnShelveListResult,
  SvnStatusResult,
  SvnMutationNotification,
  SvnMutationResult,
  SwitchRelocateInput,
} from '@shared/types';

import { cancelCheckout, checkout, checkoutWithProgress } from '../services/svn-checkout';
import { commit, commitWithProgress } from '../services/svn-commit';
import { listNativeAuth, removeNativeAuth } from '../services/svn-native-auth';
import { catRepositoryFile } from '../services/svn-content';
import {
  getBlame,
  getDiff,
  getDiffStreaming,
  getLog,
  getMergeInfo,
  getUrlDiff,
} from '../services/svn-history';
import {
  breakLock,
  forceLock,
  forceUnlock,
  getLockInfo,
  getLockRecord,
  listLocks,
  lock as lockWorkingCopyItem,
  setLockComment,
  stealLock,
  unlock as unlockWorkingCopyItem,
} from '../services/svn-locks';
import {
  changelistAdd,
  changelistDelete,
  changelistList,
  changelistRemove,
  externalsAdd,
  externalsEdit,
  externalsList,
  externalsRemove,
  externalsUpdate,
  getRepositoryLayout,
  listRepository,
  propdel,
  propdelRemote,
  propget,
  proplist,
  propset,
  propsetRemote,
  revpropdel,
  revpropget,
  revpropset,
  shelveApply,
  shelveDelete,
  shelveList,
  shelveSave,
} from '../services/svn-metadata';
import { resolveAuthSession } from '../services/auth-session-manager';
import {
  getDiagnostics,
  getSvnCapabilities,
  rejectServerCertificate,
  trustServerCertificate,
} from '../services/svn-diagnostics';
import { scanWorkingCopyHealth } from '../services/svn-working-copy-health';
import { getMergeReadiness } from '../services/svn-merge-readiness';
import { getRevisionImpact } from '../services/svn-revision-impact';
import { compareBranches } from '../services/svn-branch-comparison';
import { clearSvnCommandTimeline, getSvnCommandTimeline } from '../services/svn-command-timeline';
import { applyPatch, createPatch } from '../services/svn-patch';
import {
  copyRepositoryItem,
  createRemoteFolder,
  deleteRemoteItem,
  exportRepository,
  exportRepositoryWithProgress,
  importRepository,
  importRepositoryWithProgress,
  mergeRepositoryRange,
  mergeRepositoryRangeWithProgress,
  moveRemoteItem,
  relocateWorkingCopy,
  resolveConflict,
  switchWorkingCopy,
} from '../services/svn-repository-ops';
import { cancelSvnOperation } from '../services/svn-progress';
import { validateSwitchOrRelocate } from '../services/svn-switch-relocate';
import { editRevprop, getRevprop } from '../services/svn-revprop';
import { analyzePristineStore } from '../services/pristine-analyzer';
import { scanFilesForSecrets } from '../services/secret-scanner';
import {
  applyRelinkProposal,
  detectWorkingCopyRelinks,
  type KnownWorkingCopyEntry,
} from '../services/wc-relink-detector';
import { getSettingsManager } from '../settings-manager';
import { approvePathForIpc, assertPathApprovedForIpc } from '../utils/approved-paths';
import { getMonitoredWorkingCopies, renameMonitoredWorkingCopy } from './monitor';
import { getStatusService } from '../services/status-service';
import { getSvnCacheService } from '../services/svn-cache-service';
import {
  add as addWorkingCopyItems,
  cancelUpdate,
  cleanup as cleanupWorkingCopy,
  previewCleanup,
  excludeFromWorkingCopy,
  getWorkingCopyContext,
  getInfo,
  getInfoUrl,
  getRemoteStatus,
  getStatus,
  getWorkingCopyUpgradeStatus,
  move as moveWorkingCopyItem,
  copy as copyWorkingCopyItem,
  remove as removeWorkingCopyItems,
  revert as revertWorkingCopyItems,
  previewRevert,
  unversion as unversionWorkingCopyItems,
  getChildCommits,
  update as updateWorkingCopy,
  updateWithProgress,
  upgradeWorkingCopy,
  updateItem as updateWorkingCopyItem,
  updateToRevision,
} from '../services/svn-working-copy';
import { getSharedWorkerPool } from '../workers/WorkerPool';
import { getSvnReadError } from '../utils/svn-errors';
import {
  normalizeSvnChangeItem,
  normalizeSvnChangeList,
  normalizeSvnRevision,
  normalizeSvnRevisionNumber,
  requireSvnRevision,
  requireSvnRevisionNumber,
} from '../utils/svn-revision';
import {
  getActiveWorkingCopyMutations,
  subscribeToWorkingCopyMutations,
} from '../services/svn-mutation-queue';
import { sendToRenderer } from '../utils/safe-renderer-send';
import { closeFileWatchersForPath } from './fs';

/**
 * Retire file watchers rooted at paths whose working-copy content or layout
 * just changed (relocate/delete), so no watcher keeps running against stale
 * paths. Failures are swallowed: teardown must never fail the operation.
 */
async function closeWatchersAfterRemoval(paths: string[]): Promise<void> {
  try {
    await Promise.all(paths.filter(Boolean).map((path) => closeFileWatchersForPath(path)));
  } catch (error) {
    console.warn('[SVN] Failed to close file watchers after working-copy change:', error);
  }
}

/**
 * Locale-independent revision validation for user-supplied revisions: every
 * `-r`/`-c` value reaching an svn argument goes through utils/svn-revision
 * (here or in the service layer) so coercible-but-invalid input (`1e3`,
 * `1.5`, non-ASCII digits, …) is rejected before spawning svn.
 */
function sanitizeUpdateOptions(
  options?: Parameters<typeof updateWorkingCopy>[2]
): Parameters<typeof updateWorkingCopy>[2] {
  return options
    ? { ...options, revision: normalizeSvnRevision(options.revision, 'update revision') }
    : undefined;
}

function normalizeMergeRanges(
  ranges?: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> | undefined {
  // Missing bounds throw instead of leaking `undefined` into the typed
  // service contract.
  return ranges?.map((range) => ({
    start: requireSvnRevisionNumber(range?.start, 'merge range start'),
    end: requireSvnRevisionNumber(range?.end, 'merge range end'),
  }));
}

let mutationStateSubscriptionInstalled = false;

interface MutationEvent {
  sender?: { send?: (channel: string, notification: SvnMutationNotification) => void };
}

function operationSucceeded(result: unknown): boolean {
  return !(
    result &&
    typeof result === 'object' &&
    'success' in result &&
    (result as { success?: boolean }).success === false
  );
}

async function invalidateStatusAfter<T>(
  paths: string[],
  operation: Promise<T>,
  event?: MutationEvent,
  repositoryUrls: string[] = []
): Promise<T> {
  try {
    const result = await operation;
    if (operationSucceeded(result)) {
      getStatusService().invalidatePaths(paths);
      const affectedPaths = Array.from(new Set([...paths, ...repositoryUrls].filter(Boolean)));
      const clearedAt = Date.now();
      try {
        for (const affectedPath of affectedPaths) {
          await getSvnCacheService().clearPath(affectedPath, clearedAt);
        }
      } catch (error) {
        console.warn(
          '[SVN Cache] Failed to invalidate cached reads after mutation:',
          (error as Error).message
        );
      }
      event?.sender?.send?.('svn:mutation', {
        localPaths: Array.from(new Set(paths.filter(Boolean))),
        repositoryUrls: Array.from(new Set(repositoryUrls.filter(Boolean))),
      });
    }
    return result;
  } catch (error) {
    return {
      success: false,
      ...getSvnReadError(error),
    } as T;
  }
}

async function invalidateRepositoryAfter<T>(
  event: MutationEvent,
  repositoryUrls: string[],
  operation: Promise<T>
): Promise<T> {
  return invalidateStatusAfter([], operation, event, repositoryUrls);
}

/**
 * Registry entries for working-copy relink detection (item 60): the monitor's
 * in-memory working copies (which carry their repository URL) plus
 * settings.recentRepositories entries that are local paths, deduplicated by
 * path with the monitor's URL identity winning.
 */
async function collectKnownWorkingCopyEntries(): Promise<KnownWorkingCopyEntry[]> {
  const entriesByPath = new Map<string, KnownWorkingCopyEntry>();
  for (const info of getMonitoredWorkingCopies()) {
    if (!info?.path) continue;
    entriesByPath.set(info.path, {
      path: info.path,
      ...(info.url ? { url: info.url } : {}),
    });
  }

  const settingsManager = getSettingsManager();
  await settingsManager.ready();
  const recentRepositories = settingsManager.getSettings().recentRepositories ?? [];
  for (const candidate of recentRepositories) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    // recentRepositories mixes local paths and repository URLs; relink detection is path-only.
    if (/^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(candidate)) continue;
    if (!entriesByPath.has(candidate)) entriesByPath.set(candidate, { path: candidate });
  }

  return Array.from(entriesByPath.values());
}

/**
 * Registry update performed when a relink proposal is applied (item 60): rekey
 * the monitor map, mirror the move into settings.recentRepositories (same
 * settings-manager update path the store uses), and approve the new folder so
 * subsequent IPC against it passes the approved-paths guard. Watchers rooted at
 * the old path are retired by the caller; fresh ones open on the next fs:watch.
 */
async function applyRelinkRegistryUpdate(oldPath: string, newPath: string): Promise<void> {
  renameMonitoredWorkingCopy(oldPath, newPath);

  const settingsManager = getSettingsManager();
  await settingsManager.ready();
  const recentRepositories = settingsManager.getSettings().recentRepositories ?? [];
  const updated = recentRepositories.map((entry) => (entry === oldPath ? newPath : entry));
  if (!updated.includes(newPath)) updated.push(newPath);
  await settingsManager.updateSettings({ recentRepositories: updated });

  // The moved folder was never picked through a native dialog; the user
  // confirmed the proposal, which is equivalent consent for the new root.
  approvePathForIpc(newPath, 'directory');
}

export function registerSvnHandlers(): void {
  ipcMain.handle('svn:capabilities', async () => getSvnCapabilities());
  ipcMain.handle('svn:getActiveWorkingCopyMutations', () => getActiveWorkingCopyMutations());
  if (!mutationStateSubscriptionInstalled) {
    mutationStateSubscriptionInstalled = true;
    subscribeToWorkingCopyMutations((paths) => {
      for (const window of BrowserWindow.getAllWindows()) {
        sendToRenderer(window.webContents, 'svn:workingCopyMutationStateChanged', paths);
      }
    });
  }
  ipcMain.handle('svn:nativeAuth:list', async (_, patterns?: string[]) => listNativeAuth(patterns));
  ipcMain.handle('svn:nativeAuth:remove', async (_, patterns: string[]) =>
    removeNativeAuth(patterns)
  );
  ipcMain.handle(
    'svn:cat',
    async (_, target: string, revision?: string, workerJobId?: string): Promise<SvnCatResult> =>
      catRepositoryFile(target, normalizeSvnRevision(revision, 'cat revision'), workerJobId)
  );

  ipcMain.handle(
    'svn:revertPreview',
    async (_, paths: string[], depth?: import('@shared/types').SvnRevertDepth) =>
      previewRevert(paths, depth)
  );
  // SVN Status
  ipcMain.handle(
    'svn:status',
    async (_, path: string, workerJobId?: string): Promise<SvnStatusResult> => {
      return getStatus(path, workerJobId);
    }
  );

  ipcMain.handle(
    'svn:statusRemote',
    async (_, path: string, workerJobId?: string): Promise<SvnStatusResult> => {
      return getRemoteStatus(path, workerJobId);
    }
  );

  ipcMain.handle(
    'svn:cancelWorkerJob',
    async (_, workerJobId: string): Promise<OperationResult> => {
      const cancelled = getSharedWorkerPool().cancel(workerJobId);
      return cancelled
        ? { success: true }
        : { success: false, error: 'Worker job not found or already completed' };
    }
  );

  ipcMain.handle('svn:workingCopyUpgradeStatus', async (_, path: string) => {
    return getWorkingCopyUpgradeStatus(path);
  });

  ipcMain.handle('svn:upgradeWorkingCopy', async (event, path: string) => {
    return invalidateStatusAfter([path], upgradeWorkingCopy(path), event);
  });

  // SVN Log
  ipcMain.handle(
    'svn:log',
    async (
      _event,
      path: string,
      limit = 100,
      startRev?: number,
      endRev?: number,
      useMergeHistory = false,
      workerJobId?: string,
      options = {}
    ): Promise<SvnLogResult> => {
      return getLog(
        path,
        limit,
        normalizeSvnRevisionNumber(startRev, 'log start revision'),
        normalizeSvnRevisionNumber(endRev, 'log end revision'),
        useMergeHistory,
        workerJobId,
        options
      );
    }
  );

  ipcMain.handle(
    'svn:mergeInfo',
    async (
      _,
      source: string,
      target: string,
      kind: SvnMergeInfoKind
    ): Promise<SvnMergeInfoResult> => getMergeInfo(source, target, kind)
  );

  ipcMain.handle(
    'svn:mergeReadiness',
    async (_, sourceUrl: string, targetPath: string): Promise<MergeReadinessReport> =>
      getMergeReadiness(sourceUrl, targetPath)
  );

  ipcMain.handle(
    'svn:revisionImpact',
    async (_, target: string, limit?: number, revision?: number): Promise<RevisionImpactReport> =>
      getRevisionImpact(target, limit, normalizeSvnRevisionNumber(revision, 'impact revision'))
  );

  ipcMain.handle(
    'svn:compareBranches',
    async (_, leftUrl: string, rightUrl: string): Promise<BranchComparisonResult> =>
      compareBranches(leftUrl, rightUrl)
  );

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
  ipcMain.handle(
    'svn:diff',
    async (_, path: string, revision?: string, workerJobId?: string): Promise<SvnDiffResult> => {
      // The diff revision is passed to `svn diff -c`, so change syntax
      // (single, reversed, `START:END`) is accepted.
      return getDiff(
        path,
        revision === undefined ? undefined : normalizeSvnChangeItem(revision, 'diff revision'),
        workerJobId
      );
    }
  );

  ipcMain.handle(
    'svn:diffUrls',
    async (_, leftUrl: string, rightUrl: string, workerJobId?: string): Promise<SvnDiffResult> => {
      return getUrlDiff(leftUrl, rightUrl, workerJobId);
    }
  );

  // SVN Streaming Diff - Memory-efficient diff parsing for large files
  ipcMain.handle(
    'svn:diffStreaming',
    async (_, path: string, revision?: string, workerJobId?: string): Promise<SvnDiffResult> => {
      return getDiffStreaming(
        path,
        revision === undefined ? undefined : normalizeSvnChangeItem(revision, 'diff revision'),
        workerJobId
      );
    }
  );

  // SVN Update
  ipcMain.handle(
    'svn:update',
    async (
      event,
      path: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: Parameters<typeof updateWorkingCopy>[2]
    ) =>
      invalidateStatusAfter(
        [path],
        updateWorkingCopy(path, depth, sanitizeUpdateOptions(options)),
        event
      )
  );

  ipcMain.handle(
    'svn:updateWithProgress',
    async (
      event,
      updateId: string,
      path: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: Parameters<typeof updateWorkingCopy>[2]
    ) =>
      invalidateStatusAfter(
        [path],
        updateWithProgress(event, updateId, path, depth, sanitizeUpdateOptions(options)),
        event
      )
  );

  ipcMain.handle('svn:cancelUpdate', async (_, updateId: string) => {
    return cancelUpdate(updateId);
  });

  ipcMain.handle('svn:updateItem', async (event, localPath: string) => {
    return invalidateStatusAfter([localPath], updateWorkingCopyItem(localPath), event);
  });

  ipcMain.handle(
    'svn:updateToRevision',
    async (
      event,
      workingCopyRoot: string,
      repoUrl: string,
      localPath: string,
      depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'infinity',
      setDepthSticky: boolean = false
    ) =>
      invalidateStatusAfter(
        [workingCopyRoot, localPath],
        updateToRevision(workingCopyRoot, repoUrl, localPath, depth, setDepthSticky),
        event
      )
  );

  // SVN Commit
  ipcMain.handle('svn:commit', async (event, paths: string[], message: string) => {
    return invalidateStatusAfter(paths, commit(paths, message), event);
  });

  ipcMain.handle(
    'svn:commitWithProgress',
    async (event, operationId: string, paths: string[], message: string) => {
      return invalidateStatusAfter(
        paths,
        commitWithProgress(event, operationId, paths, message),
        event
      );
    }
  );

  ipcMain.handle('svn:cancelOperation', async (_, operationId: string) => {
    return cancelSvnOperation(operationId);
  });

  // SVN Revert
  ipcMain.handle(
    'svn:revert',
    async (event, paths: string[], depth?: import('@shared/types').SvnRevertDepth) => {
      return invalidateStatusAfter(paths, revertWorkingCopyItems(paths, depth), event);
    }
  );

  // SVN Unversion (recursively undo an accidental add)
  ipcMain.handle('svn:unversion', async (event, paths: string[]) => {
    return invalidateStatusAfter(paths, unversionWorkingCopyItems(paths), event);
  });

  ipcMain.handle('svn:exclude', async (event, paths: string | string[]) => {
    const targets = Array.isArray(paths) ? paths : [paths];
    return invalidateStatusAfter(targets, excludeFromWorkingCopy(targets), event);
  });

  // Last-commit info for a directory's immediate children (Explorer last-activity)
  ipcMain.handle('svn:childCommits', async (_, path: string) => {
    return getChildCommits(path);
  });

  // SVN Add
  ipcMain.handle('svn:add', async (event, paths: string[]) => {
    return invalidateStatusAfter(paths, addWorkingCopyItems(paths), event);
  });

  // SVN Delete
  ipcMain.handle('svn:delete', async (event, paths: string[]) => {
    const result = await invalidateStatusAfter(paths, removeWorkingCopyItems(paths), event);
    // Deleted local working-copy files must not leave dangling watchers.
    if (operationSucceeded(result)) {
      await closeWatchersAfterRemoval(paths);
    }
    return result;
  });

  // SVN Cleanup
  ipcMain.handle('svn:cleanup', async (event, path: string, options) => {
    return invalidateStatusAfter([path], cleanupWorkingCopy(path, options), event);
  });
  ipcMain.handle('svn:cleanupPreview', async (_, path: string) => previewCleanup(path));

  // SVN Checkout
  ipcMain.handle(
    'svn:checkout',
    async (
      event,
      url: string,
      path: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => {
      const internalOptions = options
        ? {
            ...options,
            credentials: resolveAuthSession(event.sender.id, options.authSessionId, url),
          }
        : undefined;
      return invalidateStatusAfter(
        [path],
        checkout(
          url,
          path,
          normalizeSvnRevision(revision, 'checkout revision'),
          depth,
          internalOptions
        ),
        event
      );
    }
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
    ) => {
      const internalOptions = options
        ? {
            ...options,
            credentials: resolveAuthSession(event.sender.id, options.authSessionId, url),
          }
        : undefined;
      return invalidateStatusAfter(
        [path],
        checkoutWithProgress(
          event,
          checkoutId,
          url,
          path,
          normalizeSvnRevision(revision, 'checkout revision'),
          depth,
          internalOptions
        ),
        event
      );
    }
  );

  // SVN Cancel Checkout
  ipcMain.handle('svn:cancelCheckout', async (_, checkoutId: string) => {
    return cancelCheckout(checkoutId);
  });

  // SVN Export
  ipcMain.handle('svn:export', async (event, url: string, path: string, revision?: string) => {
    return invalidateStatusAfter(
      [path],
      exportRepository(url, path, normalizeSvnRevision(revision, 'export revision')),
      event
    );
  });

  ipcMain.handle(
    'svn:exportWithProgress',
    async (event, operationId: string, url: string, path: string, revision?: string) => {
      return invalidateStatusAfter(
        [path],
        exportRepositoryWithProgress(
          event,
          operationId,
          url,
          path,
          normalizeSvnRevision(revision, 'export revision')
        ),
        event
      );
    }
  );

  // SVN Import
  ipcMain.handle('svn:import', async (event, path: string, url: string, message: string) => {
    return invalidateRepositoryAfter(event, [url], importRepository(path, url, message));
  });

  ipcMain.handle(
    'svn:importWithProgress',
    async (event, operationId: string, path: string, url: string, message: string) => {
      return invalidateRepositoryAfter(
        event,
        [url],
        importRepositoryWithProgress(event, operationId, path, url, message)
      );
    }
  );

  // SVN Lock
  ipcMain.handle('svn:lock', async (event, path: string, message?: string) => {
    return invalidateStatusAfter([path], lockWorkingCopyItem(path, message), event);
  });

  // SVN Unlock
  ipcMain.handle('svn:unlock', async (event, path: string, force?: boolean) => {
    return invalidateStatusAfter([path], unlockWorkingCopyItem(path, force), event);
  });

  // SVN Lock Info - Get detailed lock information for a file
  ipcMain.handle('svn:lockInfo', async (_, path: string) => {
    return getLockInfo(path);
  });

  // SVN Force Lock (Steal Lock) - Lock a file even if locked by another user
  ipcMain.handle('svn:lockForce', async (event, path: string, message?: string) => {
    return invalidateStatusAfter([path], forceLock(path, message), event);
  });

  // SVN Force Unlock (Break Lock) - Unlock a file locked by another user
  ipcMain.handle('svn:unlockForce', async (event, path: string) => {
    return invalidateStatusAfter([path], forceUnlock(path), event);
  });

  // SVN Lock List - List all locks in a working copy
  ipcMain.handle('svn:lockList', async (_, path: string) => {
    return listLocks(path);
  });

  // SVN Lock Record - Full lock record (owner, comment, expiry) for steal/break dialogs
  ipcMain.handle('svn:lockRecord', async (_, path: string) => {
    return getLockRecord(path);
  });

  // SVN Steal Lock - Force-unlock a foreign lock and re-lock as the current user.
  // The owner-bound confirmation payload comes straight from the renderer dialog.
  ipcMain.handle(
    'svn:stealLock',
    async (event, path: string, comment?: string, confirmation?: LockForceConfirmation) => {
      return invalidateStatusAfter([path], stealLock(path, comment, confirmation), event);
    }
  );

  // SVN Break Lock - Force-unlock a foreign lock without re-locking (confirmed)
  ipcMain.handle(
    'svn:breakLock',
    async (event, path: string, confirmation?: LockForceConfirmation) => {
      return invalidateStatusAfter([path], breakLock(path, confirmation), event);
    }
  );

  // SVN Set Lock Comment - Replace a lock comment (re-lock under the hood)
  ipcMain.handle(
    'svn:setLockComment',
    async (event, path: string, comment: string, confirmation?: LockForceConfirmation) => {
      return invalidateStatusAfter([path], setLockComment(path, comment, confirmation), event);
    }
  );

  // SVN Resolve
  ipcMain.handle(
    'svn:resolve',
    async (
      event,
      path: string,
      resolution:
        | 'base'
        | 'mine-full'
        | 'theirs-full'
        | 'mine-conflict'
        | 'theirs-conflict'
        | 'working'
    ) => {
      return invalidateStatusAfter([path], resolveConflict(path, resolution), event);
    }
  );

  // SVN Switch
  ipcMain.handle('svn:switch', async (event, path: string, url: string, revision?: string) => {
    return invalidateStatusAfter(
      [path],
      switchWorkingCopy(path, url, normalizeSvnRevision(revision, 'switch revision')),
      event
    );
  });

  // Pre-flight validation (dry run) for switch/relocate — data only, never touches the working copy.
  ipcMain.handle('svn:validateSwitchOrRelocate', async (_, input: SwitchRelocateInput) => {
    if (!input || typeof input !== 'object') {
      throw new Error('A switch/relocate validation input is required.');
    }
    return validateSwitchOrRelocate(input);
  });

  // SVN Copy (Branch/Tag)
  ipcMain.handle(
    'svn:copy',
    async (event, src: string, dst: string, message: string, authSessionId?: string) => {
      return invalidateRepositoryAfter(
        event,
        [src, dst],
        copyRepositoryItem(
          src,
          dst,
          message,
          resolveAuthSession(event.sender.id, authSessionId, dst)
        )
      );
    }
  );

  // SVN Remote Folder Create
  ipcMain.handle(
    'svn:remoteCreateFolder',
    async (
      event,
      parentUrl: string,
      folderName: string,
      message: string,
      authSessionId?: string
    ) => {
      return invalidateRepositoryAfter(
        event,
        [parentUrl],
        createRemoteFolder(
          parentUrl,
          folderName,
          message,
          resolveAuthSession(event.sender.id, authSessionId, parentUrl)
        )
      );
    }
  );

  // SVN Remote Delete
  ipcMain.handle(
    'svn:remoteDelete',
    async (event, url: string, message: string, authSessionId?: string) => {
      return invalidateRepositoryAfter(
        event,
        [url],
        deleteRemoteItem(url, message, resolveAuthSession(event.sender.id, authSessionId, url))
      );
    }
  );

  // SVN Remote Move/Rename
  ipcMain.handle(
    'svn:remoteMove',
    async (event, srcUrl: string, dstUrl: string, message: string, authSessionId?: string) => {
      return invalidateRepositoryAfter(
        event,
        [srcUrl, dstUrl],
        moveRemoteItem(
          srcUrl,
          dstUrl,
          message,
          resolveAuthSession(event.sender.id, authSessionId, dstUrl)
        )
      );
    }
  );

  // SVN Merge
  ipcMain.handle(
    'svn:merge',
    async (
      event,
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
      options?: Parameters<typeof mergeRepositoryRange>[4]
    ) => {
      return invalidateStatusAfter(
        [target],
        mergeRepositoryRange(
          source,
          target,
          normalizeSvnChangeList(revisions, 'merge revisions'),
          normalizeMergeRanges(ranges),
          options
        ),
        event
      );
    }
  );

  ipcMain.handle(
    'svn:mergeWithProgress',
    async (
      event,
      operationId: string,
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
      options?: Parameters<typeof mergeRepositoryRangeWithProgress>[6]
    ) => {
      return invalidateStatusAfter(
        [target],
        mergeRepositoryRangeWithProgress(
          event,
          operationId,
          source,
          target,
          normalizeSvnChangeList(revisions, 'merge revisions'),
          normalizeMergeRanges(ranges),
          options
        ),
        event
      );
    }
  );

  // SVN Relocate
  ipcMain.handle('svn:relocate', async (event, from: string, to: string, path: string) => {
    const result = await invalidateStatusAfter([path], relocateWorkingCopy(from, to, path), event);
    // Retire watchers rooted at the relocated copy; fresh ones are opened on
    // next use against the post-relocate state.
    if (operationSucceeded(result)) {
      await closeWatchersAfterRemoval([path]);
    }
    return result;
  });

  // SVN Changelist - Add to changelist
  ipcMain.handle('svn:changelist:add', async (event, paths: string[], changelist: string) => {
    return invalidateStatusAfter(paths, changelistAdd(paths, changelist), event);
  });

  // SVN Changelist - Remove from changelist
  ipcMain.handle('svn:changelist:remove', async (event, paths: string[]) => {
    return invalidateStatusAfter(paths, changelistRemove(paths), event);
  });

  // SVN Changelist - List changelists
  ipcMain.handle('svn:changelist:list', async (_, path: string): Promise<SvnChangelistResult> => {
    return changelistList(path);
  });

  // SVN Changelist - Delete changelist (remove all files from it)
  ipcMain.handle('svn:changelist:delete', async (event, name: string, path: string) => {
    return invalidateStatusAfter([path], changelistDelete(name, path), event);
  });

  // SVN Move
  ipcMain.handle('svn:move', async (event, src: string, dst: string) => {
    return invalidateStatusAfter([src, dst], moveWorkingCopyItem(src, dst), event);
  });
  ipcMain.handle('svn:copyLocal', async (event, src: string, dst: string) => {
    return invalidateStatusAfter([src, dst], copyWorkingCopyItem(src, dst), event);
  });

  // SVN Shelve - List shelves
  ipcMain.handle('svn:shelve:list', async (_, path: string): Promise<SvnShelveListResult> => {
    return shelveList(path);
  });

  // SVN Shelve - Save
  ipcMain.handle('svn:shelve:save', async (event, name: string, path: string, message?: string) => {
    return invalidateStatusAfter([path], shelveSave(name, path, message), event);
  });

  // SVN Shelve - Apply
  ipcMain.handle('svn:shelve:apply', async (event, name: string, path: string) => {
    return invalidateStatusAfter([path], shelveApply(name, path), event);
  });

  // SVN Shelve - Delete
  ipcMain.handle('svn:shelve:delete', async (event, name: string, path: string) => {
    return invalidateStatusAfter([path], shelveDelete(name, path), event);
  });

  // SVN Proplist
  ipcMain.handle('svn:proplist', async (_, path: string, options) => {
    return proplist(path, options);
  });
  ipcMain.handle('svn:propget', async (_, target: string, name: string, options) =>
    propget(target, name, options)
  );

  // SVN Propset
  ipcMain.handle('svn:propset', async (event, path: string, name: string, value: string) => {
    return invalidateStatusAfter([path], propset(path, name, value), event);
  });

  // SVN Propdel
  ipcMain.handle('svn:propdel', async (event, path: string, name: string) => {
    return invalidateStatusAfter([path], propdel(path, name), event);
  });
  ipcMain.handle(
    'svn:propsetRemote',
    async (event, url: string, name: string, value: string, message: string) =>
      invalidateRepositoryAfter(event, [url], propsetRemote(url, name, value, message))
  );
  ipcMain.handle('svn:propdelRemote', async (event, url: string, name: string, message: string) =>
    invalidateRepositoryAfter(event, [url], propdelRemote(url, name, message))
  );
  ipcMain.handle('svn:revpropget', async (_, target: string, name: string, revision: string) =>
    revpropget(target, name, requireSvnRevision(revision, 'revprop revision'))
  );
  ipcMain.handle(
    'svn:revpropset',
    async (event, target: string, name: string, value: string, revision: string) =>
      invalidateRepositoryAfter(
        event,
        [target],
        revpropset(target, name, value, requireSvnRevision(revision, 'revprop revision'))
      )
  );
  ipcMain.handle('svn:revpropdel', async (event, target: string, name: string, revision: string) =>
    invalidateRepositoryAfter(
      event,
      [target],
      revpropdel(target, name, requireSvnRevision(revision, 'revprop revision'))
    )
  );

  // Revprop editing by absolute repository URL with an explicit confirmation
  // gate (plain confirm + audit-trail acknowledgement), passed straight through.
  ipcMain.handle(
    'svn:getRevprop',
    async (_, url: string, revision: string, propName: string) =>
      getRevprop(url, requireSvnRevision(revision, 'revprop revision'), propName)
  );

  ipcMain.handle(
    'svn:editRevprop',
    async (
      event,
      url: string,
      revision: string,
      propName: string,
      newValue: string,
      confirmation?: RevpropConfirmation
    ) =>
      invalidateRepositoryAfter(
        event,
        [url],
        editRevprop(
          url,
          requireSvnRevision(revision, 'revprop revision'),
          propName,
          newValue,
          confirmation
        )
      )
  );

  // ============================================
  // SVN Blame (Annotate)
  // ============================================

  ipcMain.handle(
    'svn:blame',
    async (
      _,
      path: string,
      startRevision?: number,
      endRevision?: number,
      workerJobId?: string
    ): Promise<SvnBlameResult> => {
      return getBlame(
        path,
        normalizeSvnRevisionNumber(startRevision, 'blame start revision'),
        normalizeSvnRevisionNumber(endRevision, 'blame end revision'),
        workerJobId
      );
    }
  );

  // ============================================
  // SVN List (Repository Browser)
  // ============================================

  ipcMain.handle(
    'svn:list',
    async (
      event,
      url: string,
      revision?: string,
      depth?: 'empty' | 'immediates' | 'infinity',
      authSessionId?: string
    ): Promise<SvnListResult> => {
      return listRepository(
        url,
        normalizeSvnRevision(revision, 'list revision'),
        depth,
        resolveAuthSession(event.sender.id, authSessionId, url)
      );
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
    async (event, patchPath: string, targetPath: string, dryRun?: boolean, options?) => {
      return dryRun
        ? applyPatch(patchPath, targetPath, dryRun, options)
        : invalidateStatusAfter(
            [targetPath],
            applyPatch(patchPath, targetPath, dryRun, options),
            event
          );
    }
  );

  // ============================================
  // SVN Externals Management
  // ============================================

  ipcMain.handle('svn:externals:list', async (_, path: string): Promise<SvnExternalsResult> => {
    return externalsList(path);
  });

  ipcMain.handle(
    'svn:externals:add',
    async (
      event,
      workingCopyPath: string,
      external: Omit<SvnExternal, 'name'> & { name?: string }
    ): Promise<SvnMutationResult> => {
      return invalidateStatusAfter(
        [workingCopyPath],
        externalsAdd(workingCopyPath, external),
        event
      );
    }
  );

  ipcMain.handle(
    'svn:externals:remove',
    async (event, workingCopyPath: string, externalPath: string): Promise<SvnMutationResult> => {
      return invalidateStatusAfter(
        [workingCopyPath],
        externalsRemove(workingCopyPath, externalPath),
        event
      );
    }
  );

  ipcMain.handle(
    'svn:externals:edit',
    async (
      event,
      workingCopyPath: string,
      externalPath: string,
      external: Omit<SvnExternal, 'name'> & { name?: string }
    ): Promise<SvnMutationResult> => {
      return invalidateStatusAfter(
        [workingCopyPath],
        externalsEdit(workingCopyPath, externalPath, external),
        event
      );
    }
  );

  ipcMain.handle(
    'svn:externals:update',
    async (event, workingCopyPath: string, externalPath?: string): Promise<SvnMutationResult> => {
      return invalidateStatusAfter(
        [workingCopyPath],
        externalsUpdate(workingCopyPath, externalPath),
        event
      );
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

  // Repository layout detection (trunk/branches/tags classification, data-only)
  ipcMain.handle(
    'svn:getRepositoryLayout',
    async (event, url: string, authSessionId?: string): Promise<SvnRepoLayout> => {
      return getRepositoryLayout(url, resolveAuthSession(event.sender.id, authSessionId, url));
    }
  );

  // Pristine-store analysis: sizes, orphans, vacuum recommendation. Data-only —
  // running `svn cleanup --vacuum` stays a separate, explicit operation.
  ipcMain.handle(
    'svn:analyzePristine',
    async (_, workingCopyPath: string, options?: Omit<PristineAnalysisOptions, 'signal'>) => {
      const approvedPath = assertPathApprovedForIpc(workingCopyPath, 'Pristine analysis');
      return analyzePristineStore(approvedPath, options);
    }
  );

  // Pre-commit secret scan of renderer-selected files. Every path must live
  // inside an approved root (same guard as the other file-taking channels).
  ipcMain.handle(
    'svn:scanSecrets',
    async (_, paths: string[], options?: Omit<SecretScanOptions, 'signal'>) => {
      const targets = Array.isArray(paths) ? paths : [paths];
      const approvedPaths = targets.map((path) => assertPathApprovedForIpc(path, 'Secret scan'));
      return scanFilesForSecrets(approvedPaths, options);
    }
  );

  // Working-copy relink detection over the monitor + recent-paths registry
  ipcMain.handle('svn:detectWcRelinks', async () => {
    return detectWorkingCopyRelinks(await collectKnownWorkingCopyEntries());
  });

  // Explicitly apply a relink proposal: registry + settings rewrite, then retire
  // watchers rooted at the old path (mirrors monitor:removeWorkingCopy teardown).
  ipcMain.handle('svn:applyWcRelink', async (_, proposal: RelinkProposal) => {
    const result = await applyRelinkProposal(proposal, applyRelinkRegistryUpdate);
    if (result.success && proposal?.oldPath) {
      await closeWatchersAfterRemoval([proposal.oldPath]);
    }
    return result;
  });

  ipcMain.handle('svn:workingCopyHealth', async (_, workingCopyPath: string) =>
    scanWorkingCopyHealth(workingCopyPath)
  );
  ipcMain.handle('svn:commandTimeline', () => getSvnCommandTimeline());
  ipcMain.handle('svn:commandTimeline:clear', () => {
    clearSvnCommandTimeline();
    return { success: true };
  });

  ipcMain.handle(
    'svn:trustServerCertificate',
    async (_, url: string, errorText: string): Promise<{ success: boolean; error?: string }> => {
      return trustServerCertificate(url, errorText);
    }
  );

  // Renderer "don't trust" action: records the rejection so the prompt is not
  // offered again for the same (host, fingerprint, failureKind).
  ipcMain.handle(
    'svn:rejectServerCertificate',
    async (_, url: string, errorText: string): Promise<{ success: boolean; error?: string }> => {
      return rejectServerCertificate(url, errorText);
    }
  );
}
