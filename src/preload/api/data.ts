import type { IpcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/types';
import type { InvokeIpc } from './ipc';

export function createStoreApi(invokeIpc: InvokeIpc): ElectronAPI['store'] {
  return {
    get: <T>(key: string) => invokeIpc('store:get', key) as Promise<T | undefined>,
    set: <T>(key: string, value: T) => invokeIpc('store:set', key, value),
    delete: (key: string) => invokeIpc('store:delete', key),
  };
}

export function createAuthApi(invokeIpc: InvokeIpc): ElectronAPI['auth'] {
  return {
    get: (realm) => invokeIpc('auth:get', realm),
    set: (realm, username, password) => invokeIpc('auth:set', realm, username, password),
    delete: (realm) => invokeIpc('auth:delete', realm),
    list: () => invokeIpc('auth:list'),
    has: (realm) => invokeIpc('auth:has', realm),
    clear: () => invokeIpc('auth:clear'),
    isEncryptionAvailable: () => invokeIpc('auth:isEncryptionAvailable'),
  };
}

export function createWebhookApi(invokeIpc: InvokeIpc): ElectronAPI['webhook'] {
  return {
    deliver: (request) => invokeIpc('webhook:deliver', request),
  };
}

export function createNotificationApi(invokeIpc: InvokeIpc): ElectronAPI['notification'] {
  return {
    show: (options) => invokeIpc('notification:show', options),
  };
}

export function createShellApi(invokeIpc: InvokeIpc): ElectronAPI['shell'] {
  return {
    register: () => invokeIpc('shell:register'),
    unregister: () => invokeIpc('shell:unregister'),
    isRegistered: () => invokeIpc('shell:isRegistered'),
    getStatus: () => invokeIpc('shell:getStatus'),
    updateOverlay: (path, status) => invokeIpc('shell:updateOverlay', path, status),
    clearOverlay: (path) => invokeIpc('shell:clearOverlay', path),
    clearAllOverlays: () => invokeIpc('shell:clearAllOverlays'),
  };
}

export function createDeepLinkApi(ipcRenderer: IpcRenderer): ElectronAPI['deepLink'] {
  return {
    onAction: (callback) => {
      const handler = (_: unknown, link: unknown) =>
        callback(
          link as {
            action: string;
            params: Record<string, string>;
            path?: string;
            url?: string;
            requiresConfirmation?: boolean;
          }
        );
      ipcRenderer.on('deep-link', handler);
      return () => ipcRenderer.removeListener('deep-link', handler);
    },
  };
}
