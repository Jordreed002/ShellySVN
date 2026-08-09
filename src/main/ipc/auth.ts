/**
 * Auth IPC handlers
 * Provides secure credential storage for SVN authentication
 */
import { ipcMain } from 'electron';
import { getAuthCache } from '../auth-cache';
import { beginAuthSession, resumeAuthSession } from '../services/auth-session-manager';

export interface AuthListEntry {
  realm: string;
  username: string;
  createdAt: number;
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:getStatus', async (_, realm: string) => {
    const cache = getAuthCache();
    await cache.ready();
    const entry = cache.list().find((item) => item.realm === realm);
    return { available: Boolean(entry), username: entry?.username, persistent: Boolean(entry) };
  });

  ipcMain.handle('auth:beginSession', (event, request) =>
    beginAuthSession(event.sender.id, request)
  );
  ipcMain.handle('auth:resumeSession', (event, realm: string) =>
    resumeAuthSession(event.sender.id, realm)
  );

  // Delete credential for a realm
  ipcMain.handle('auth:delete', (_, realm: string) => {
    getAuthCache().delete(realm);
    return { success: true };
  });

  // List all cached realms (without passwords)
  ipcMain.handle('auth:list', (): AuthListEntry[] => {
    return getAuthCache()
      .list()
      .filter((entry) => !entry.realm.startsWith('webhook:'));
  });

  // Clear all credentials
  ipcMain.handle('auth:clear', () => {
    getAuthCache().clear();
    return { success: true };
  });

  // Check if encryption is available
  ipcMain.handle('auth:isEncryptionAvailable', (): boolean => {
    return getAuthCache().isEncryptionAvailable();
  });
}
