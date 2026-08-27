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
  ipcMain.handle('auth:delete', async (_, realm: string) => {
    const cache = getAuthCache();
    await cache.ready();
    await cache.delete(realm);
    return { success: true };
  });

  // List all cached realms (without passwords)
  ipcMain.handle('auth:list', async (): Promise<AuthListEntry[]> => {
    const cache = getAuthCache();
    await cache.ready();
    return cache
      .list()
      .filter((entry) => !entry.realm.startsWith('webhook:'));
  });

  // Clear all credentials
  ipcMain.handle('auth:clear', async () => {
    const cache = getAuthCache();
    await cache.ready();
    await cache.clear();
    return { success: true };
  });

  // Reveal one stored credential, on explicit request from the credentials
  // page so the user can confirm what was actually saved. This is the only
  // channel that returns a decrypted password; list, diagnostics, logs and
  // notifications must never include it.
  ipcMain.handle('auth:reveal', async (_, realm: string) => {
    if (typeof realm !== 'string' || !realm.trim()) {
      throw new Error('Credential realm is required');
    }
    const cache = getAuthCache();
    await cache.ready();
    const credential = cache.get(realm);
    if (!credential) {
      throw new Error('No saved credential for this realm');
    }
    return {
      realm,
      username: credential.username,
      password: credential.password,
      createdAt: cache.list().find((entry) => entry.realm === realm)?.createdAt ?? null,
      encrypted: cache.isEncryptionAvailable(),
    };
  });

  // Check if encryption is available
  ipcMain.handle('auth:isEncryptionAvailable', (): boolean => {
    return getAuthCache().isEncryptionAvailable();
  });
}
