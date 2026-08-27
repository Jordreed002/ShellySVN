import type { IpcRenderer } from 'electron';
import type { AuthRevealResult, ElectronAPI } from '@shared/types';
import type { InvokeIpc } from './ipc';

export function createStoreApi(invokeIpc: InvokeIpc): ElectronAPI['store'] {
  return {
    get: <T>(key: string) => invokeIpc('store:get', key) as Promise<T | undefined>,
    set: <T>(key: string, value: T) => invokeIpc('store:set', key, value),
    delete: (key: string) => invokeIpc('store:delete', key),
  };
}

export function createSvnCacheApi(invokeIpc: InvokeIpc): ElectronAPI['svnCache'] {
  return {
    get: <T>(namespace, key) =>
      invokeIpc('svnCache:get', namespace, key) as Promise<
        import('@shared/types').SvnCacheEntry<T> | null
      >,
    list: <T>(namespace) =>
      invokeIpc('svnCache:list', namespace) as Promise<
        Array<import('@shared/types').SvnCacheEntry<T>>
      >,
    set: (namespace, key, path, data, ttlMs, operationStartedAt) =>
      invokeIpc('svnCache:set', namespace, key, path, data, ttlMs, operationStartedAt),
    delete: (namespace, key) => invokeIpc('svnCache:delete', namespace, key),
    clearNamespace: (namespace, clearedAt) =>
      invokeIpc('svnCache:clearNamespace', namespace, clearedAt),
    clearPath: (path, clearedAt) => invokeIpc('svnCache:clearPath', path, clearedAt),
    clearAll: (clearedAt) => invokeIpc('svnCache:clearAll', clearedAt),
    stats: () => invokeIpc('svnCache:stats'),
  };
}

export function createAuthApi(invokeIpc: InvokeIpc): ElectronAPI['auth'] {
  return {
    getStatus: (realm) => invokeIpc('auth:getStatus', realm),
    beginSession: (request) => invokeIpc('auth:beginSession', request),
    resumeSession: (realm) => invokeIpc('auth:resumeSession', realm),
    delete: (realm) => invokeIpc('auth:delete', realm),
    list: () => invokeIpc('auth:list'),
    clear: () => invokeIpc('auth:clear'),
    isEncryptionAvailable: () => invokeIpc('auth:isEncryptionAvailable'),
    reveal: (realm) => invokeIpc('auth:reveal', realm) as Promise<AuthRevealResult>,
  };
}

export function createWebhookApi(invokeIpc: InvokeIpc): ElectronAPI['webhook'] {
  return {
    deliver: (request) => invokeIpc('webhook:deliver', request),
    setSecret: (webhookId, secret) => invokeIpc('webhook:setSecret', webhookId, secret),
    hasSecret: (webhookId) => invokeIpc('webhook:hasSecret', webhookId),
    deleteSecret: (webhookId) => invokeIpc('webhook:deleteSecret', webhookId),
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
