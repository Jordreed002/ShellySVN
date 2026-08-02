import type { IpcRenderer } from 'electron';
import type {
  CheckoutOptions,
  CheckoutProgress,
  ElectronAPI,
  SvnBlameResult,
  SvnChangelistResult,
  SvnExternalsResult,
  SvnListResult,
  SvnLockInfoResult,
  SvnLockListResult,
  SvnLockResult,
  SvnMutationNotification,
  SvnMutationResult,
  SvnOperationProgress,
  SvnPatchResult,
  SvnShelveListResult,
  SvnUnlockResult,
} from '@shared/types';
import { createOperationId, type InvokeIpc } from './ipc';

const activeCheckoutIds = new Set<string>();
const activeUpdateIds = new Set<string>();
const activeOperationIds = new Set<string>();

function latestId(ids: Set<string>): string | undefined {
  return Array.from(ids).at(-1);
}

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
  activeOperationIds.add(operationId);

  const handler = (_: unknown, progress: unknown) => {
    const operationProgress = progress as SvnOperationProgress;
    if (operationProgress.operationId === operationId) {
      onProgress({ ...operationProgress, operationId });
    }
  };

  ipcRenderer.on('svn:operation:progress', handler);

  return invoke(operationId).then(
    (result) => {
      ipcRenderer.removeListener('svn:operation:progress', handler);
      activeOperationIds.delete(operationId);
      return result;
    },
    (error) => {
      ipcRenderer.removeListener('svn:operation:progress', handler);
      activeOperationIds.delete(operationId);
      throw error;
    }
  );
}

export function createSvnApi(ipcRenderer: IpcRenderer, invokeIpc: InvokeIpc): ElectronAPI['svn'] {
  return {
    capabilities: () => invokeIpc('svn:capabilities'),
    onMutation: (callback) => {
      const handler = (_: unknown, notification: unknown) =>
        callback(notification as SvnMutationNotification);
      ipcRenderer.on('svn:mutation', handler);
      return () => ipcRenderer.removeListener('svn:mutation', handler);
    },
    getActiveWorkingCopyMutations: () => invokeIpc('svn:getActiveWorkingCopyMutations'),
    onWorkingCopyMutationStateChanged: (callback) => {
      const handler = (_: unknown, paths: unknown) => callback(paths as string[]);
      ipcRenderer.on('svn:workingCopyMutationStateChanged', handler);
      return () => ipcRenderer.removeListener('svn:workingCopyMutationStateChanged', handler);
    },
    nativeAuth: {
      list: (patterns?) => invokeIpc('svn:nativeAuth:list', patterns),
      remove: (patterns) => invokeIpc('svn:nativeAuth:remove', patterns),
    },
    cat: (target, revision?, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-cat', options?.signal, (workerJobId) =>
        invokeIpc('svn:cat', target, revision, workerJobId)
      ),
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
      invokeCancellableWorkerJob(invokeIpc, 'svn-log', options?.signal, (workerJobId) => {
        const { signal: _signal, ...serializableOptions } = options ?? {};
        return invokeIpc(
          'svn:log',
          path,
          limit,
          startRev,
          endRev,
          useMergeHistory,
          workerJobId,
          serializableOptions
        );
      }),
    mergeInfo: (source, target, kind) => invokeIpc('svn:mergeInfo', source, target, kind),
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
      activeUpdateIds.add(updateId);

      const handler = (_: unknown, progress: unknown) => {
        const updateProgress = progress as CheckoutProgress & { updateId?: string };
        if (!updateProgress.updateId || updateProgress.updateId === updateId) {
          onProgress({ ...updateProgress, operationId: updateId });
        }
      };

      ipcRenderer.on('svn:update:progress', handler);

      const promise = invokeIpc('svn:updateWithProgress', updateId, path, depth, options);

      const operation = promise.then(
        (result) => {
          ipcRenderer.removeListener('svn:update:progress', handler);
          activeUpdateIds.delete(updateId);
          return result;
        },
        (error) => {
          ipcRenderer.removeListener('svn:update:progress', handler);
          activeUpdateIds.delete(updateId);
          throw error;
        }
      );
      return Object.assign(operation, { operationId: updateId });
    },
    cancelUpdate: (operationId?) => {
      const updateId = operationId ?? latestId(activeUpdateIds);
      if (!updateId) {
        return Promise.resolve({ success: false, error: 'No active update' });
      }
      return invokeIpc('svn:cancelUpdate', updateId);
    },
    updateItem: (path) => invokeIpc('svn:updateItem', path),
    updateToRevision: (workingCopyRoot, url, localPath, depth?, setDepthSticky?) =>
      invokeIpc('svn:updateToRevision', workingCopyRoot, url, localPath, depth, setDepthSticky),
    commit: (paths, message) => invokeIpc('svn:commit', paths, message),
    commitWithProgress: (paths, message, onProgress) =>
      invokeWithOperationProgress(ipcRenderer, 'commit', onProgress, (operationId) =>
        invokeIpc('svn:commitWithProgress', operationId, paths, message)
      ),
    cancelOperation: (operationId?) => {
      const activeOperationId = operationId ?? latestId(activeOperationIds);
      if (!activeOperationId) {
        return Promise.resolve({ success: false, error: 'No active SVN operation' });
      }
      return invokeIpc('svn:cancelOperation', activeOperationId);
    },
    revert: (paths, depth?) => invokeIpc('svn:revert', paths, depth),
    revertPreview: (paths, depth?) => invokeIpc('svn:revertPreview', paths, depth),
    unversion: (paths) => invokeIpc('svn:unversion', paths),
    exclude: (paths) => invokeIpc('svn:exclude', paths),
    childCommits: (path) => invokeIpc('svn:childCommits', path),
    add: (paths) => invokeIpc('svn:add', paths),
    delete: (paths) => invokeIpc('svn:delete', paths),
    cleanup: (path, options?) => invokeIpc('svn:cleanup', path, options),
    cleanupPreview: (path) => invokeIpc('svn:cleanupPreview', path),
    lock: (path, message?) => invokeIpc('svn:lock', path, message),
    unlock: (path, force?) => invokeIpc('svn:unlock', path, force),
    lockInfo: (path) => invokeIpc('svn:lockInfo', path) as Promise<SvnLockInfoResult>,
    lockForce: (path, message?) =>
      invokeIpc('svn:lockForce', path, message) as Promise<SvnLockResult>,
    unlockForce: (path) => invokeIpc('svn:unlockForce', path) as Promise<SvnUnlockResult>,
    lockList: (path) => invokeIpc('svn:lockList', path) as Promise<SvnLockListResult>,
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
      activeCheckoutIds.add(checkoutId);

      const handler = (_: unknown, progress: unknown) => {
        const checkoutProgress = progress as CheckoutProgress & { checkoutId?: string };
        if (!checkoutProgress.checkoutId || checkoutProgress.checkoutId === checkoutId) {
          onProgress({ ...checkoutProgress, operationId: checkoutId });
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
          activeCheckoutIds.delete(checkoutId);
          return result;
        },
        (error) => {
          ipcRenderer.removeListener('svn:checkout:progress', handler);
          activeCheckoutIds.delete(checkoutId);
          throw error;
        }
      );
    },
    cancelCheckout: (operationId?) => {
      const checkoutId = operationId ?? latestId(activeCheckoutIds);
      if (!checkoutId) {
        return Promise.resolve({ success: false, error: 'No active checkout' });
      }
      return invokeIpc('svn:cancelCheckout', checkoutId);
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
    resolve: (path, resolution) => invokeIpc('svn:resolve', path, resolution),
    switch: (path, url, revision?) => invokeIpc('svn:switch', path, url, revision),
    copy: (src, dst, message, authSessionId?) =>
      authSessionId
        ? invokeIpc('svn:copy', src, dst, message, authSessionId)
        : invokeIpc('svn:copy', src, dst, message),
    remoteCreateFolder: (parentUrl, folderName, message, authSessionId?) =>
      invokeIpc('svn:remoteCreateFolder', parentUrl, folderName, message, authSessionId),
    remoteDelete: (url, message, authSessionId?) =>
      invokeIpc('svn:remoteDelete', url, message, authSessionId),
    remoteMove: (srcUrl, dstUrl, message, authSessionId?) =>
      invokeIpc('svn:remoteMove', srcUrl, dstUrl, message, authSessionId),
    merge: (source, target, revisions?, ranges?, options?) =>
      invokeIpc('svn:merge', source, target, revisions, ranges, options),
    mergeWithProgress: (source, target, onProgress, revisions?, ranges?, options?) =>
      invokeWithOperationProgress(ipcRenderer, 'merge', onProgress, (operationId) =>
        invokeIpc('svn:mergeWithProgress', operationId, source, target, revisions, ranges, options)
      ),
    relocate: (from, to, path) => invokeIpc('svn:relocate', from, to, path),
    changelist: {
      add: (paths, changelist) => invokeIpc('svn:changelist:add', paths, changelist),
      remove: (paths) => invokeIpc('svn:changelist:remove', paths),
      list: (path) => invokeIpc('svn:changelist:list', path) as Promise<SvnChangelistResult>,
      delete: (name, path) => invokeIpc('svn:changelist:delete', name, path),
    },
    move: (src, dst) => invokeIpc('svn:move', src, dst),
    copyLocal: (src, dst) => invokeIpc('svn:copyLocal', src, dst),
    shelve: {
      list: (path) => invokeIpc('svn:shelve:list', path) as Promise<SvnShelveListResult>,
      save: (name, path, message?) => invokeIpc('svn:shelve:save', name, path, message),
      apply: (name, path) => invokeIpc('svn:shelve:apply', name, path),
      delete: (name, path) => invokeIpc('svn:shelve:delete', name, path),
    },
    proplist: (path, options?) => invokeIpc('svn:proplist', path, options),
    propget: (target, name, options?) => invokeIpc('svn:propget', target, name, options),
    propset: (path, name, value) => invokeIpc('svn:propset', path, name, value),
    propdel: (path, name) => invokeIpc('svn:propdel', path, name),
    propsetRemote: (url, name, value, message) =>
      invokeIpc('svn:propsetRemote', url, name, value, message),
    propdelRemote: (url, name, message) => invokeIpc('svn:propdelRemote', url, name, message),
    revpropget: (target, name, revision) => invokeIpc('svn:revpropget', target, name, revision),
    revpropset: (target, name, value, revision) =>
      invokeIpc('svn:revpropset', target, name, value, revision),
    revpropdel: (target, name, revision) => invokeIpc('svn:revpropdel', target, name, revision),
    blame: (path, startRevision?, endRevision?, options?) =>
      invokeCancellableWorkerJob(invokeIpc, 'svn-blame', options?.signal, (workerJobId) =>
        invokeIpc('svn:blame', path, startRevision, endRevision, workerJobId)
      ) as Promise<SvnBlameResult>,
    list: (url, revision?, depth?, authSessionId?) =>
      invokeIpc('svn:list', url, revision, depth, authSessionId) as Promise<SvnListResult>,
    patch: {
      create: (paths, outputPath) =>
        invokeIpc('svn:patch:create', paths, outputPath) as Promise<{
          success: boolean;
          output: string;
        }>,
      apply: (patchPath, targetPath, dryRun?, options?) =>
        invokeIpc(
          'svn:patch:apply',
          patchPath,
          targetPath,
          dryRun,
          options
        ) as Promise<SvnPatchResult>,
    },
    externals: {
      list: (path) => invokeIpc('svn:externals:list', path) as Promise<SvnExternalsResult>,
      add: (workingCopyPath, external) =>
        invokeIpc('svn:externals:add', workingCopyPath, external) as Promise<SvnMutationResult>,
      edit: (workingCopyPath, externalPath, external) =>
        invokeIpc(
          'svn:externals:edit',
          workingCopyPath,
          externalPath,
          external
        ) as Promise<SvnMutationResult>,
      remove: (workingCopyPath, externalPath) =>
        invokeIpc(
          'svn:externals:remove',
          workingCopyPath,
          externalPath
        ) as Promise<SvnMutationResult>,
      update: (workingCopyPath, externalPath?) =>
        invokeIpc(
          'svn:externals:update',
          workingCopyPath,
          externalPath
        ) as Promise<SvnMutationResult>,
    },
    diagnostics: (workingCopyPath) => invokeIpc('svn:diagnostics', workingCopyPath),
    trustServerCertificate: (url, errorText) =>
      invokeIpc('svn:trustServerCertificate', url, errorText),
  };
}
