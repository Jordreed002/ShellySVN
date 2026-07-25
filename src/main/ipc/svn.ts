import { ipcMain } from 'electron';

import type {
  CheckoutOptions,
  RepoDiagnostics,
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
  SvnShelveListResult,
  SvnStatusResult,
  SvnMutationNotification,
  SvnMutationResult,
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
  forceLock,
  forceUnlock,
  getLockInfo,
  listLocks,
  lock as lockWorkingCopyItem,
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
import {
  getDiagnostics,
  getSvnCapabilities,
  trustServerCertificate,
} from '../services/svn-diagnostics';
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

export function registerSvnHandlers(): void {
  ipcMain.handle('svn:capabilities', async () => getSvnCapabilities());
  ipcMain.handle('svn:nativeAuth:list', async (_, patterns?: string[]) => listNativeAuth(patterns));
  ipcMain.handle('svn:nativeAuth:remove', async (_, patterns: string[]) =>
    removeNativeAuth(patterns)
  );
  ipcMain.handle(
    'svn:cat',
    async (_, target: string, revision?: string, workerJobId?: string): Promise<SvnCatResult> =>
      catRepositoryFile(target, revision, workerJobId)
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
      return getLog(path, limit, startRev, endRev, useMergeHistory, workerJobId, options);
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
      return getDiff(path, revision, workerJobId);
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
      return getDiffStreaming(path, revision, workerJobId);
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
    ) => invalidateStatusAfter([path], updateWorkingCopy(path, depth, options), event)
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
        updateWithProgress(event, updateId, path, depth, options),
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

  ipcMain.handle('svn:exclude', async (event, path: string) => {
    return invalidateStatusAfter([path], excludeFromWorkingCopy(path), event);
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
    return invalidateStatusAfter(paths, removeWorkingCopyItems(paths), event);
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
    ) => invalidateStatusAfter([path], checkout(url, path, revision, depth, options), event)
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
    ) =>
      invalidateStatusAfter(
        [path],
        checkoutWithProgress(event, checkoutId, url, path, revision, depth, options),
        event
      )
  );

  // SVN Cancel Checkout
  ipcMain.handle('svn:cancelCheckout', async (_, checkoutId: string) => {
    return cancelCheckout(checkoutId);
  });

  // SVN Export
  ipcMain.handle('svn:export', async (event, url: string, path: string, revision?: string) => {
    return invalidateStatusAfter([path], exportRepository(url, path, revision), event);
  });

  ipcMain.handle(
    'svn:exportWithProgress',
    async (event, operationId: string, url: string, path: string, revision?: string) => {
      return invalidateStatusAfter(
        [path],
        exportRepositoryWithProgress(event, operationId, url, path, revision),
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
    return invalidateStatusAfter([path], switchWorkingCopy(path, url, revision), event);
  });

  // SVN Copy (Branch/Tag)
  ipcMain.handle(
    'svn:copy',
    async (
      event,
      src: string,
      dst: string,
      message: string,
      credentials?: { username: string; password: string }
    ) => {
      return invalidateRepositoryAfter(
        event,
        [src, dst],
        copyRepositoryItem(src, dst, message, credentials)
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
      credentials?: { username: string; password: string }
    ) => {
      return invalidateRepositoryAfter(
        event,
        [parentUrl],
        createRemoteFolder(parentUrl, folderName, message, credentials)
      );
    }
  );

  // SVN Remote Delete
  ipcMain.handle(
    'svn:remoteDelete',
    async (
      event,
      url: string,
      message: string,
      credentials?: { username: string; password: string }
    ) => {
      return invalidateRepositoryAfter(event, [url], deleteRemoteItem(url, message, credentials));
    }
  );

  // SVN Remote Move/Rename
  ipcMain.handle(
    'svn:remoteMove',
    async (
      event,
      srcUrl: string,
      dstUrl: string,
      message: string,
      credentials?: { username: string; password: string }
    ) => {
      return invalidateRepositoryAfter(
        event,
        [srcUrl, dstUrl],
        moveRemoteItem(srcUrl, dstUrl, message, credentials)
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
        mergeRepositoryRange(source, target, revisions, ranges, options),
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
          revisions,
          ranges,
          options
        ),
        event
      );
    }
  );

  // SVN Relocate
  ipcMain.handle('svn:relocate', async (event, from: string, to: string, path: string) => {
    return invalidateStatusAfter([path], relocateWorkingCopy(from, to, path), event);
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
    revpropget(target, name, revision)
  );
  ipcMain.handle(
    'svn:revpropset',
    async (event, target: string, name: string, value: string, revision: string) =>
      invalidateRepositoryAfter(event, [target], revpropset(target, name, value, revision))
  );
  ipcMain.handle('svn:revpropdel', async (event, target: string, name: string, revision: string) =>
    invalidateRepositoryAfter(event, [target], revpropdel(target, name, revision))
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
      return getBlame(path, startRevision, endRevision, workerJobId);
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

  ipcMain.handle(
    'svn:trustServerCertificate',
    async (_, url: string, errorText: string): Promise<{ success: boolean; error?: string }> => {
      return trustServerCertificate(url, errorText);
    }
  );
}
