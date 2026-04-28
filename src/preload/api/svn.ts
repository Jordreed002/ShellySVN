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
  SvnPatchResult,
  SvnShelveListResult,
  SvnUnlockResult,
} from '@shared/types';
import { createOperationId, type InvokeIpc } from './ipc';

let activeCheckoutId: string | null = null;

export function createSvnApi(
  ipcRenderer: IpcRenderer,
  invokeIpc: InvokeIpc
): ElectronAPI['svn'] {
  return {
    status: (path) => invokeIpc('svn:status', path),
    statusRemote: (path) => invokeIpc('svn:statusRemote', path),
    log: (path, limit?, startRev?, endRev?) =>
      invokeIpc('svn:log', path, limit, startRev, endRev),
    info: (path) => invokeIpc('svn:info', path),
    infoUrl: (url) => invokeIpc('svn:infoUrl', url),
    getWorkingCopyContext: (path) => invokeIpc('svn:getWorkingCopyContext', path),
    diff: (path, revision?) => invokeIpc('svn:diff', path, revision),
    diffStreaming: (path, revision?) => invokeIpc('svn:diffStreaming', path, revision),
    update: (path, depth?, options?) => invokeIpc('svn:update', path, depth, options),
    updateItem: (path) => invokeIpc('svn:updateItem', path),
    updateToRevision: (workingCopyRoot, url, localPath, depth?, setDepthSticky?) =>
      invokeIpc('svn:updateToRevision', workingCopyRoot, url, localPath, depth, setDepthSticky),
    commit: (paths, message) => invokeIpc('svn:commit', paths, message),
    revert: (paths) => invokeIpc('svn:revert', paths),
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
    import: (path, url, message) => invokeIpc('svn:import', path, url, message),
    resolve: (path, resolution) => ipcRenderer.invoke('svn:resolve', path, resolution),
    switch: (path, url, revision?) => ipcRenderer.invoke('svn:switch', path, url, revision),
    copy: (src, dst, message) => ipcRenderer.invoke('svn:copy', src, dst, message),
    merge: (source, target, revisions?, ranges?) =>
      ipcRenderer.invoke('svn:merge', source, target, revisions, ranges),
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
    blame: (path, startRevision?, endRevision?) =>
      ipcRenderer.invoke('svn:blame', path, startRevision, endRevision) as Promise<SvnBlameResult>,
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
      remove: (workingCopyPath, externalPath) =>
        ipcRenderer.invoke('svn:externals:remove', workingCopyPath, externalPath) as Promise<{
          success: boolean;
        }>,
    },
    diagnostics: (workingCopyPath) => invokeIpc('svn:diagnostics', workingCopyPath),
  };
}
