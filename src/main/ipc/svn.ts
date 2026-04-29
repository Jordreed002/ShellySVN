import { ipcMain } from 'electron';

import type {
  CheckoutOptions,
  RepoDiagnostics,
  SvnBlameResult,
  SvnChangelistResult,
  SvnDiffResult,
  SvnExternal,
  SvnInfoResult,
  SvnListResult,
  SvnLogResult,
  SvnShelveListResult,
  SvnStatusResult,
} from '@shared/types';

import { cancelCheckout, checkout, checkoutWithProgress } from '../services/svn-checkout';
import { commit, commitWithProgress } from '../services/svn-commit';
import { getBlame, getDiff, getDiffStreaming, getLog, getUrlDiff } from '../services/svn-history';
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
  copyRepositoryItem,
  exportRepository,
  exportRepositoryWithProgress,
  importRepository,
  importRepositoryWithProgress,
  mergeRepositoryRange,
  mergeRepositoryRangeWithProgress,
  relocateWorkingCopy,
  resolveConflict,
  switchWorkingCopy,
} from '../services/svn-repository-ops';
import { cancelSvnOperation } from '../services/svn-progress';
import {
  add as addWorkingCopyItems,
  cancelUpdate,
  cleanup as cleanupWorkingCopy,
  getWorkingCopyContext,
  getInfo,
  getInfoUrl,
  getRemoteStatus,
  getStatus,
  getWorkingCopyUpgradeStatus,
  move as moveWorkingCopyItem,
  remove as removeWorkingCopyItems,
  rename as renameWorkingCopyItem,
  revert as revertWorkingCopyItems,
  update as updateWorkingCopy,
  updateWithProgress,
  upgradeWorkingCopy,
  updateItem as updateWorkingCopyItem,
  updateToRevision,
} from '../services/svn-working-copy';

export function registerSvnHandlers(): void {
  // SVN Status
  ipcMain.handle('svn:status', async (_, path: string): Promise<SvnStatusResult> => {
    return getStatus(path);
  });

  ipcMain.handle('svn:statusRemote', async (_, path: string): Promise<SvnStatusResult> => {
    return getRemoteStatus(path);
  });

  ipcMain.handle('svn:workingCopyUpgradeStatus', async (_, path: string) => {
    return getWorkingCopyUpgradeStatus(path);
  });

  ipcMain.handle('svn:upgradeWorkingCopy', async (_, path: string) => {
    return upgradeWorkingCopy(path);
  });

  // SVN Log
  ipcMain.handle(
    'svn:log',
    async (
      _,
      path: string,
      limit = 100,
      startRev?: number,
      endRev?: number,
      useMergeHistory = false
    ): Promise<SvnLogResult> => {
      return getLog(path, limit, startRev, endRev, useMergeHistory);
    }
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
  ipcMain.handle('svn:diff', async (_, path: string, revision?: string): Promise<SvnDiffResult> => {
    return getDiff(path, revision);
  });

  ipcMain.handle(
    'svn:diffUrls',
    async (_, leftUrl: string, rightUrl: string): Promise<SvnDiffResult> => {
      return getUrlDiff(leftUrl, rightUrl);
    }
  );

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

  ipcMain.handle(
    'svn:updateWithProgress',
    async (
      event,
      updateId: string,
      path: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: Parameters<typeof updateWorkingCopy>[2]
    ) => updateWithProgress(event, updateId, path, depth, options)
  );

  ipcMain.handle('svn:cancelUpdate', async (_, updateId: string) => {
    return cancelUpdate(updateId);
  });

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
    return commit(paths, message);
  });

  ipcMain.handle(
    'svn:commitWithProgress',
    async (event, operationId: string, paths: string[], message: string) => {
      return commitWithProgress(event, operationId, paths, message);
    }
  );

  ipcMain.handle('svn:cancelOperation', async (_, operationId: string) => {
    return cancelSvnOperation(operationId);
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
    return exportRepository(url, path, revision);
  });

  ipcMain.handle(
    'svn:exportWithProgress',
    async (event, operationId: string, url: string, path: string, revision?: string) => {
      return exportRepositoryWithProgress(event, operationId, url, path, revision);
    }
  );

  // SVN Import
  ipcMain.handle('svn:import', async (_, path: string, url: string, message: string) => {
    return importRepository(path, url, message);
  });

  ipcMain.handle(
    'svn:importWithProgress',
    async (event, operationId: string, path: string, url: string, message: string) => {
      return importRepositoryWithProgress(event, operationId, path, url, message);
    }
  );

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
      return resolveConflict(path, resolution);
    }
  );

  // SVN Switch
  ipcMain.handle('svn:switch', async (_, path: string, url: string, revision?: string) => {
    return switchWorkingCopy(path, url, revision);
  });

  // SVN Copy (Branch/Tag)
  ipcMain.handle('svn:copy', async (_, src: string, dst: string, message: string) => {
    return copyRepositoryItem(src, dst, message);
  });

  // SVN Merge
  ipcMain.handle(
    'svn:merge',
    async (
      _,
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
      options?: Parameters<typeof mergeRepositoryRange>[4]
    ) => {
      return mergeRepositoryRange(source, target, revisions, ranges, options);
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
      return mergeRepositoryRangeWithProgress(
        event,
        operationId,
        source,
        target,
        revisions,
        ranges,
        options
      );
    }
  );

  // SVN Relocate
  ipcMain.handle('svn:relocate', async (_, from: string, to: string, path: string) => {
    return relocateWorkingCopy(from, to, path);
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
