import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
  createExternalToolsApi,
  createFsApi,
  createLifecycleApi,
  createMonitorApi,
  createUpdaterApi,
} from './api/native';
import { createSvnApi } from './api/svn';
import { createAiApi } from './api/ai';

const invokeIpc = createInvokeIpc(ipcRenderer);

const api: ElectronAPI = {
  ai: createAiApi(invokeIpc, ipcRenderer),
  svn: createSvnApi(ipcRenderer, invokeIpc),
  external: createExternalApi(invokeIpc),
  externalTools: createExternalToolsApi(invokeIpc),
  monitor: createMonitorApi(invokeIpc),
  fs: createFsApi(ipcRenderer, invokeIpc),
  dialog: {
    ...createDialogApi(invokeIpc),
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
  app: createAppApi(invokeIpc),
  updater: createUpdaterApi(ipcRenderer, invokeIpc),
  store: createStoreApi(invokeIpc),
  svnCache: createSvnCacheApi(invokeIpc),
  auth: createAuthApi(invokeIpc),
  webhook: createWebhookApi(invokeIpc),
  shell: createShellApi(invokeIpc),
  deepLink: createDeepLinkApi(ipcRenderer),
  lifecycle: createLifecycleApi(ipcRenderer, invokeIpc),
  notification: createNotificationApi(invokeIpc),
};

// Use `contextBridge` APIs to expose Electron APIs to renderer
// only if context isolation is enabled
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error('Failed to expose API:', error);
  }
} else {
  throw new Error('[SECURITY] Context isolation is required for the ShellySVN preload.');
}
