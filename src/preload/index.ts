import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { ElectronAPI } from '@shared/types';
import {
  createAuthApi,
  createDeepLinkApi,
  createNotificationApi,
  createShellApi,
  createStoreApi,
  createSvnCacheApi,
  createWebhookApi,
} from './api/data';
import { createInvokeIpc } from './api/ipc';
import {
  createAppApi,
  createDialogApi,
  createExternalApi,
  createFsApi,
  createMonitorApi,
} from './api/native';
import { createSvnApi } from './api/svn';

const invokeIpc = createInvokeIpc(ipcRenderer);

const api: ElectronAPI = {
  svn: createSvnApi(ipcRenderer, invokeIpc),
  external: createExternalApi(invokeIpc),
  monitor: createMonitorApi(invokeIpc),
  fs: createFsApi(ipcRenderer, invokeIpc),
  dialog: createDialogApi(invokeIpc),
  app: createAppApi(invokeIpc),
  store: createStoreApi(invokeIpc),
  svnCache: createSvnCacheApi(invokeIpc),
  auth: createAuthApi(invokeIpc),
  webhook: createWebhookApi(invokeIpc),
  shell: createShellApi(invokeIpc),
  deepLink: createDeepLinkApi(ipcRenderer),
  notification: createNotificationApi(invokeIpc),
};

// Use `contextBridge` APIs to expose Electron APIs to renderer
// only if context isolation is enabled
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error('Failed to expose API:', error);
  }
} else {
  throw new Error('[SECURITY] Context isolation is required for the ShellySVN preload.');
}
