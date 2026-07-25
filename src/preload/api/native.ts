import type { IpcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/types';
import type { InvokeIpc } from './ipc';

export function createExternalApi(invokeIpc: InvokeIpc): ElectronAPI['external'] {
  return {
    openDiffTool: (tool, left, right) => invokeIpc('external:openDiffTool', tool, left, right),
    openMergeTool: (tool, base, mine, theirs, merged) =>
      invokeIpc('external:openMergeTool', tool, base, mine, theirs, merged),
    openFolder: (path) => invokeIpc('external:openFolder', path),
    openFile: (path) => invokeIpc('external:openFile', path),
    revealPath: (path) => invokeIpc('external:revealPath', path),
  };
}

export function createMonitorApi(invokeIpc: InvokeIpc): ElectronAPI['monitor'] {
  return {
    getWorkingCopies: () => invokeIpc('monitor:getWorkingCopies'),
    addWorkingCopy: (path) => invokeIpc('monitor:addWorkingCopy', path),
    removeWorkingCopy: (path) => invokeIpc('monitor:removeWorkingCopy', path),
    refreshStatus: (path) => invokeIpc('monitor:refreshStatus', path),
    startMonitoring: () => invokeIpc('monitor:startMonitoring'),
    stopMonitoring: () => invokeIpc('monitor:stopMonitoring'),
  };
}

export function createFsApi(ipcRenderer: IpcRenderer, invokeIpc: InvokeIpc): ElectronAPI['fs'] {
  return {
    listDirectory: (path) => invokeIpc('fs:listDirectory', path),
    listDrives: () => invokeIpc('fs:listDrives'),
    getDirectoryMetadata: (path, hasFiles) => invokeIpc('fs:getDirectoryMetadata', path, hasFiles),
    getParent: (path) => invokeIpc('fs:getParent', path),
    getStatus: (path) => invokeIpc('fs:getStatus', path),
    getDeepStatus: (path) => invokeIpc('fs:getDeepStatus', path),
    onDeepStatusProgress: (callback) => {
      const handler = (_: unknown, progress: unknown) =>
        callback(progress as Parameters<typeof callback>[0]);
      ipcRenderer.on('fs:deepStatus:progress', handler);
      return () => ipcRenderer.removeListener('fs:deepStatus:progress', handler);
    },
    applyStatus: (files, directStatus, allEntries) =>
      invokeIpc('fs:applyStatus', files, directStatus, allEntries),
    cancelScan: (path) => invokeIpc('fs:cancelScan', path).then(() => undefined),
    isVersioned: (path) => invokeIpc('fs:isVersioned', path),
    readFile: (path) => invokeIpc('fs:readFile', path),
    readImageAsBase64: (filePath) => invokeIpc('fs:readImageAsBase64', filePath),
    getFolderSizes: (folderPaths) => invokeIpc('fs:getFolderSizes', folderPaths),
    copyFile: (source, target) => invokeIpc('fs:copyFile', source, target),
    writeFile: (path, content) => invokeIpc('fs:writeFile', path, content),
    writeFileBase64: (path, contentBase64) => invokeIpc('fs:writeFileBase64', path, contentBase64),
    watch: (path, callback, options) => {
      const handler = (
        _: unknown,
        event: { path: string; eventType: string; changedPath: string }
      ) => callback(event);
      ipcRenderer.on('fs:watch:change', handler);
      void invokeIpc('fs:watch', path, options);

      return () => {
        ipcRenderer.removeListener('fs:watch:change', handler);
        void invokeIpc('fs:unwatch', path);
      };
    },
    unwatch: (path) => invokeIpc('fs:unwatch', path),
    exists: (path) => invokeIpc('fs:exists', path),
  };
}

export function createDialogApi(
  invokeIpc: InvokeIpc
): Omit<ElectronAPI['dialog'], 'getPathForFile'> {
  return {
    openDirectory: () => invokeIpc('dialog:openDirectory'),
    openFile: (filters) => invokeIpc('dialog:openFile', filters),
    saveFile: (defaultName) => invokeIpc('dialog:saveFile', defaultName),
    showMessage: (options) => invokeIpc('dialog:showMessage', options),
    confirm: (options) => invokeIpc('dialog:confirm', options),
  };
}

export function createAppApi(invokeIpc: InvokeIpc): ElectronAPI['app'] {
  return {
    getVersion: () => invokeIpc('app:getVersion'),
    getPath: (name) => invokeIpc('app:getPath', name),
    openExternal: (url) => invokeIpc('app:openExternal', url).then(() => undefined),
    clearCache: () => invokeIpc('app:clearCache'),
    getCacheSize: () => invokeIpc('app:getCacheSize'),
    getCacheBreakdown: () => invokeIpc('app:getCacheBreakdown'),
    clearCacheTypes: (types) => invokeIpc('app:clearCacheTypes', types),
    window: {
      minimize: () => invokeIpc('app:window:minimize'),
      maximize: () => invokeIpc('app:window:maximize'),
      close: () => invokeIpc('app:window:close'),
      isMaximized: () => invokeIpc('app:window:isMaximized'),
    },
  };
}
