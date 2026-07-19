import type { IpcRenderer } from 'electron';
import type {
  CheckoutOptions,
  CheckoutProgress,
  ElectronAPI,
  SvnBlameResult,
  SvnChangelistResult,
  SvnExternal,
  SvnListResult,
  SvnLockInfo,
  SvnLockResult,
  SvnOperationProgress,
  SvnPatchResult,
  SvnShelveListResult,
  SvnUnlockResult,
} from '@shared/types';
import { createOperationId, type InvokeIpc } from './ipc';

let activeCheckoutId: string | null = null;
let activeUpdateId: string | null = null;
let activeOperationId: string | null = null;

function invokeCancellableWorkerJob<T>(
  invokeIpc: InvokeIpc,
  operationPrefix: string,
  signal: AbortSignal | undefined,
  invoke: (workerJobId?: string) => Promise<T>
): Promise<T> {
  // An AbortSignal loses its prototype methods when passed across Electron's
  // contextBridge boundary, so guard against a signal that can't register
  // listeners and simply run without cancellation support in that case.
  if (!signal || typeof signal.addEventListener !== 'function') {
    return invoke();
  }

  const workerJobId = createOperationId(operationPrefix);

  if (signal.aborted) {
    return Promise.reject(new Error('Operation cancelled'));
  }

  const abortHandler = () => {
    void invokeIpc('svn:cancelWorkerJob', workerJobId);
  };

  signal.addEventListener('abort', abortHandler, { once: true });

  return invoke(workerJobId).finally(() => {
    signal.removeEventListener('abort', abortHandler);
  });
}

function invokeWithOperationProgress<T>(
  ipcRenderer: IpcRenderer,
  operationPrefix: string,
  onProgress: (progress: SvnOperationProgress) => void,
  invoke: (operationId: string) => Promise<T>
): Promise<T> {
  const operationId = createOperationId(operationPrefix);
  activeOperationId = operationId;

  const handler = (_: unknown, progress: unknown) => {
    const operationProgress = progress as SvnOperationProgress;
    if (operationProgress.operationId === operationId) {
      onProgress(operationProgress);
    }
  };

  ipcRenderer.on('svn:operation:progress', handler);

  return invoke(operationId).then(
    (result) => {
      ipcRenderer.removeListener('svn:operation:progress', handler);
      if (activeOperationId === operationId) {
        activeOperationId = null;
      }
      return result;
    },
    (error) => {
      ipcRenderer.removeListener('svn:operation:progress', handler);
      if (activeOperationId === operationId) {
        activeOperationId = null;
      }
      throw error;
    }
  );
}

export function createSvnApi(ipcRenderer: IpcRenderer, invokeIpc: InvokeIpc): ElectronAPI['svn'] {
  return {
    status: (path, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-status', options?.signal, (workerJobId) =>
        invokeIpc('svn:status', path, workerJobId)
      ),
    statusRemote: (path, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-status-remote', options?.signal, (workerJobId) =>
        invokeIpc('svn:statusRemote', path, workerJobId)
      ),
    workingCopyUpgradeStatus: (path) => invokeIpc('svn:workingCopyUpgradeStatus', path),
    upgradeWorkingCopy: (path) => invokeIpc('svn:upgradeWorkingCopy', path),
    log: (path, limit?, startRev?, endRev?, useMergeHistory?, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-log', options?.signal, (workerJobId) =>
        invokeIpc('svn:log', path, limit, startRev, endRev, useMergeHistory, workerJobId)
      ),
    info: (path) => invokeIpc('svn:info', path),
    infoUrl: (url) => invokeIpc('svn:infoUrl', url),
    getWorkingCopyContext: (path) => invokeIpc('svn:getWorkingCopyContext', path),
    diff: (path, revision?, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-diff', options?.signal, (workerJobId) =>
        invokeIpc('svn:diff', path, revision, workerJobId)
      ),
    diffUrls: (leftUrl, rightUrl, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-diff-urls', options?.signal, (workerJobId) =>
        invokeIpc('svn:diffUrls', leftUrl, rightUrl, workerJobId)
      ),
    diffStreaming: (path, revision?, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-diff-streaming', options?.signal, (workerJobId) =>
        invokeIpc('svn:diffStreaming', path, revision, workerJobId)
      ),
    update: (path, depth?, options?) => invokeIpc('svn:update', path, depth, options),
    updateWithProgress: (path, onProgress, depth?, options?) => {
      const updateId = createOperationId('update');
      activeUpdateId = updateId;

      const handler = (_: unknown, progress: unknown) => {
        const updateProgress = progress as CheckoutProgress & { updateId?: string };
        if (!updateProgress.updateId || updateProgress.updateId === updateId) {
          onProgress(updateProgress);
        }
      };

      ipcRenderer.on('svn:update:progress', handler);

      const promise = invokeIpc('svn:updateWithProgress', updateId, path, depth, options);

      return promise.then(
        (result) => {
          ipcRenderer.removeListener('svn:update:progress', handler);
          if (activeUpdateId === updateId) {
            activeUpdateId = null;
          }
          return result;
        },
        (error) => {
          ipcRenderer.removeListener('svn:update:progress', handler);
          if (activeUpdateId === updateId) {
            activeUpdateId = null;
          }
          throw error;
        }
      );
    },
    cancelUpdate: () => {
      if (!activeUpdateId) {
        return Promise.resolve({ success: false, error: 'No active update' });
      }
      return invokeIpc('svn:cancelUpdate', activeUpdateId);
    },
    updateItem: (path) => invokeIpc('svn:updateItem', path),
    updateToRevision: (workingCopyRoot, url, localPath, depth?, setDepthSticky?) =>
      invokeIpc('svn:updateToRevision', workingCopyRoot, url, localPath, depth, setDepthSticky),
    commit: (paths, message) => invokeIpc('svn:commit', paths, message),
    commitWithProgress: (paths, message, onProgress) =>
      invokeWithOperationProgress(ipcRenderer, 'commit', onProgress, (operationId) =>
        invokeIpc('svn:commitWithProgress', operationId, paths, message)
      ),
    cancelOperation: () => {
      if (!activeOperationId) {
        return Promise.resolve({ success: false, error: 'No active SVN operation' });
      }
      return invokeIpc('svn:cancelOperation', activeOperationId);
    },
    revert: (paths) => invokeIpc('svn:revert', paths),
    unversion: (paths) => invokeIpc('svn:unversion', paths),
    childCommits: (path) => invokeIpc('svn:childCommits', path),
    add: (paths) => invokeIpc('svn:add', paths),
    delete: (paths) => invokeIpc('svn:delete', paths),
    cleanup: (path) => invokeIpc('svn:cleanup', path),
    lock: (path, message?) => ipcRenderer.invoke('svn:lock', path, message),
    unlock: (path, force?) => ipcRenderer.invoke('svn:unlock', path, force),
    lockInfo: (path) => invokeIpc('svn:lockInfo', path) as Promise<SvnLockInfo | null>,
    lockForce: (path, message?) =>
      invokeIpc('svn:lockForce', path, message) as Promise<SvnLockResult>,
    unlockForce: (path) => invokeIpc('svn:unlockForce', path) as Promise<SvnUnlockResult>,
    lockList: (path) => invokeIpc('svn:lockList', path) as Promise<SvnLockInfo[]>,
    checkout: (url, path, revision?, depth?, options?) =>
      invokeIpc('svn:checkout', url, path, revision, depth, options),
    checkoutWithProgress: (
      url: string,
      path: string,
      onProgress: (progress: CheckoutProgress) => void,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => {
      const checkoutId = createOperationId('checkout');
      activeCheckoutId = checkoutId;

      const handler = (_: unknown, progress: unknown) => {
        const checkoutProgress = progress as CheckoutProgress & { checkoutId?: string };
        if (!checkoutProgress.checkoutId || checkoutProgress.checkoutId === checkoutId) {
          onProgress(checkoutProgress);
        }
      };

      ipcRenderer.on('svn:checkout:progress', handler);

      const promise = invokeIpc(
        'svn:checkoutWithProgress',
        checkoutId,
        url,
        path,
        revision,
        depth,
        options
      );

      return promise.then(
        (result) => {
          ipcRenderer.removeListener('svn:checkout:progress', handler);
          if (activeCheckoutId === checkoutId) {
            activeCheckoutId = null;
          }
          return result;
        },
        (error) => {
          ipcRenderer.removeListener('svn:checkout:progress', handler);
          if (activeCheckoutId === checkoutId) {
            activeCheckoutId = null;
          }
          throw error;
        }
      );
    },
    cancelCheckout: () => {
      if (!activeCheckoutId) {
        return Promise.resolve({ success: false, error: 'No active checkout' });
      }
      return invokeIpc('svn:cancelCheckout', activeCheckoutId);
    },
    export: (url, path, revision?) => invokeIpc('svn:export', url, path, revision),
    exportWithProgress: (url, path, onProgress, revision?) =>
      invokeWithOperationProgress(ipcRenderer, 'export', onProgress, (operationId) =>
        invokeIpc('svn:exportWithProgress', operationId, url, path, revision)
      ),
    import: (path, url, message) => invokeIpc('svn:import', path, url, message),
    importWithProgress: (path, url, message, onProgress) =>
      invokeWithOperationProgress(ipcRenderer, 'import', onProgress, (operationId) =>
        invokeIpc('svn:importWithProgress', operationId, path, url, message)
      ),
    resolve: (path, resolution) => ipcRenderer.invoke('svn:resolve', path, resolution),
    switch: (path, url, revision?) => ipcRenderer.invoke('svn:switch', path, url, revision),
    copy: (src, dst, message) => ipcRenderer.invoke('svn:copy', src, dst, message),
    remoteCreateFolder: (parentUrl, folderName, message, credentials?) =>
      ipcRenderer.invoke('svn:remoteCreateFolder', parentUrl, folderName, message, credentials),
    remoteDelete: (url, message, credentials?) =>
      ipcRenderer.invoke('svn:remoteDelete', url, message, credentials),
    remoteMove: (srcUrl, dstUrl, message, credentials?) =>
      ipcRenderer.invoke('svn:remoteMove', srcUrl, dstUrl, message, credentials),
    merge: (source, target, revisions?, ranges?, options?) =>
      ipcRenderer.invoke('svn:merge', source, target, revisions, ranges, options),
    mergeWithProgress: (source, target, onProgress, revisions?, ranges?, options?) =>
      invokeWithOperationProgress(ipcRenderer, 'merge', onProgress, (operationId) =>
        invokeIpc('svn:mergeWithProgress', operationId, source, target, revisions, ranges, options)
      ),
    relocate: (from, to, path) => ipcRenderer.invoke('svn:relocate', from, to, path),
    changelist: {
      add: (paths, changelist) => ipcRenderer.invoke('svn:changelist:add', paths, changelist),
      remove: (paths) => ipcRenderer.invoke('svn:changelist:remove', paths),
      list: (path) =>
        ipcRenderer.invoke('svn:changelist:list', path) as Promise<SvnChangelistResult>,
      create: (name, comment?) => ipcRenderer.invoke('svn:changelist:create', name, comment),
      delete: (name, path) => ipcRenderer.invoke('svn:changelist:delete', name, path),
    },
    move: (src, dst) => ipcRenderer.invoke('svn:move', src, dst),
    rename: (src, dst) => ipcRenderer.invoke('svn:rename', src, dst),
    shelve: {
      list: (path) => ipcRenderer.invoke('svn:shelve:list', path) as Promise<SvnShelveListResult>,
      save: (name, path, message?) => ipcRenderer.invoke('svn:shelve:save', name, path, message),
      apply: (name, path) => ipcRenderer.invoke('svn:shelve:apply', name, path),
      delete: (name, path) => ipcRenderer.invoke('svn:shelve:delete', name, path),
    },
    proplist: (path) => ipcRenderer.invoke('svn:proplist', path),
    propset: (path, name, value) => ipcRenderer.invoke('svn:propset', path, name, value),
    propdel: (path, name) => ipcRenderer.invoke('svn:propdel', path, name),
    blame: (path, startRevision?, endRevision?, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-blame', options?.signal, (workerJobId) =>
        invokeIpc('svn:blame', path, startRevision, endRevision, workerJobId)
      ) as Promise<SvnBlameResult>,
    list: (url, revision?, depth?, credentials?) =>
      ipcRenderer.invoke('svn:list', url, revision, depth, credentials) as Promise<SvnListResult>,
    patch: {
      create: (paths, outputPath) =>
        ipcRenderer.invoke('svn:patch:create', paths, outputPath) as Promise<{
          success: boolean;
          output: string;
        }>,
      apply: (patchPath, targetPath, dryRun?) =>
        ipcRenderer.invoke(
          'svn:patch:apply',
          patchPath,
          targetPath,
          dryRun
        ) as Promise<SvnPatchResult>,
    },
    externals: {
      list: (path) => ipcRenderer.invoke('svn:externals:list', path) as Promise<SvnExternal[]>,
      add: (workingCopyPath, external) =>
        ipcRenderer.invoke('svn:externals:add', workingCopyPath, external) as Promise<{
          success: boolean;
        }>,
      edit: (workingCopyPath, externalPath, external) =>
        ipcRenderer.invoke(
          'svn:externals:edit',
          workingCopyPath,
          externalPath,
          external
        ) as Promise<{
          success: boolean;
        }>,
      remove: (workingCopyPath, externalPath) =>
        ipcRenderer.invoke('svn:externals:remove', workingCopyPath, externalPath) as Promise<{
          success: boolean;
        }>,
      update: (workingCopyPath, externalPath?) =>
        ipcRenderer.invoke('svn:externals:update', workingCopyPath, externalPath) as Promise<{
          success: boolean;
        }>,
    },
    diagnostics: (workingCopyPath) => invokeIpc('svn:diagnostics', workingCopyPath),
    trustServerCertificate: (url, errorText) =>
      invokeIpc('svn:trustServerCertificate', url, errorText),
  };
}
