import { readFile, access, chmod } from 'node:fs/promises';
import { join } from 'path';
import { safeStorage } from 'electron';

import { debug } from '@shared/utils/debug';
import { writeSecureJson } from './utils/secure-json';
import {
  decodeLegacyBase64Secret,
  decryptSecret,
  encryptSecret,
  isSecureStorageAvailable,
} from './utils/secure-storage';

interface CachedCredential {
  realm: string;
  username: string;
  password: string;
  createdAt: number;
}

interface StoredCache {
  version: number;
  credentials: CachedCredential[];
}

function normalizeUrlForRealmMatch(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeRealmPath(pathname: string): string {
  if (pathname === '') return '/';
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function isRealmAncestorOfUrl(realm: string, url: string): boolean {
  const parsedRealm = normalizeUrlForRealmMatch(realm);
  const parsedUrl = normalizeUrlForRealmMatch(url);

  if (!parsedRealm || !parsedUrl || parsedRealm.origin !== parsedUrl.origin) {
    return false;
  }

  const realmPath = normalizeRealmPath(parsedRealm.pathname);
  const urlPath = normalizeRealmPath(parsedUrl.pathname);

  return realmPath === '/' || urlPath === realmPath || urlPath.startsWith(`${realmPath}/`);
}

class AuthCache {
  private credentials: Map<string, CachedCredential> = new Map();
  private storePath: string;
  private encryptionAvailable: boolean;
  private loadPromise: Promise<void>;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.storePath = join(userDataPath, 'auth-cache.json');
    this.encryptionAvailable = isSecureStorageAvailable(safeStorage);

    if (!this.encryptionAvailable) {
      debug.warn(
        '[AUTH] Encryption not available. Credentials will be stored in memory only.',
        'On macOS, ensure the app has Keychain access.'
      );
    } else {
      debug.log('[AUTH] Secure storage available - credentials will persist');
    }

    this.loadPromise = this.load();
  }

  async ready(): Promise<void> {
    await this.loadPromise;
  }

  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable;
  }

  set(realm: string, username: string, password: string): void {
    let storedPassword = password;
    if (this.encryptionAvailable) {
      const encrypted = encryptSecret(safeStorage, password);
      if (encrypted === null) {
        // Fail closed: caching the value would require keeping it in
        // plaintext, so drop the credential entirely and let the user
        // re-authenticate instead of persisting a recoverable secret.
        debug.error('[AUTH] OS keychain refused to encrypt credential for realm:', realm);
        return;
      }
      storedPassword = encrypted;
    }
    const credential: CachedCredential = {
      realm,
      username,
      password: storedPassword,
      createdAt: Date.now(),
    };
    this.credentials.set(realm, credential);
    if (this.encryptionAvailable) {
      this.save();
    }
    debug.log('[AUTH] Credential saved for realm:', realm);
  }

  get(realm: string): { username: string; password: string } | null {
    const credential = this.credentials.get(realm);
    if (!credential) {
      return null;
    }

    const decryptedPassword = this.readablePassword(credential.password);
    if (decryptedPassword === null) {
      debug.error('[AUTH] Failed to decrypt credential for realm:', realm);
      this.delete(realm);
      return null;
    }
    return {
      username: credential.username,
      password: decryptedPassword,
    };
  }

  delete(realm: string): void {
    this.credentials.delete(realm);
    this.save();
  }

  clear(): void {
    this.credentials.clear();
    this.save();
  }

  list(): Array<{ realm: string; username: string; createdAt: number }> {
    return Array.from(this.credentials.values()).map((c) => ({
      realm: c.realm,
      username: c.username,
      createdAt: c.createdAt,
    }));
  }

  has(realm: string): boolean {
    return this.credentials.has(realm);
  }

  /**
   * Find credentials for a URL by matching against stored realms.
   * This handles the case where credentials are stored for the repository root
   * but we're looking up a subdirectory URL.
   *
   * @param url - The full URL to find credentials for
   * @returns Credentials if found, null otherwise
   */
  findForUrl(url: string): { username: string; password: string; realm: string } | null {
    // First try exact match
    const exact = this.get(url);
    if (exact) {
      return { ...exact, realm: url };
    }

    // Then try URL-aware ancestor matching - find the longest matching realm.
    let bestMatch: { realm: string; credential: CachedCredential } | null = null;

    for (const [realm, credential] of this.credentials) {
      if (isRealmAncestorOfUrl(realm, url)) {
        // Prefer longer (more specific) matches
        if (!bestMatch || realm.length > bestMatch.realm.length) {
          bestMatch = { realm, credential };
        }
      }
    }

    if (bestMatch) {
      const decryptedPassword = this.readablePassword(bestMatch.credential.password);
      if (decryptedPassword === null) {
        debug.error('[AUTH] Failed to decrypt credential for realm:', bestMatch.realm);
        this.delete(bestMatch.realm);
        return null;
      }
      return {
        username: bestMatch.credential.username,
        password: decryptedPassword,
        realm: bestMatch.realm,
      };
    }

    return null;
  }

  /**
   * Decrypt a stored password, or return null when it cannot be recovered.
   * Session-only entries (encryption unavailable) hold plaintext in memory
   * and are returned as-is; they are never written to disk.
   */
  private readablePassword(stored: string): string | null {
    if (!this.encryptionAvailable) return stored;
    return decryptSecret(safeStorage, stored);
  }

  private async load(): Promise<void> {
    if (!this.encryptionAvailable) {
      debug.log('[AUTH] Skipping credential cache load because encryption is unavailable');
      return;
    }

    try {
      await access(this.storePath);
      if (process.platform !== 'win32') await chmod(this.storePath, 0o600);
      const content = await readFile(this.storePath, 'utf-8');
      const data: StoredCache = JSON.parse(content);

      if (data.version === 1 && Array.isArray(data.credentials)) {
        let migratedAny = false;

        for (const cred of data.credentials) {
          if (decryptSecret(safeStorage, cred.password) !== null) {
            // Healthy safeStorage entry — keep the stored ciphertext as-is.
            this.credentials.set(cred.realm, cred);
            continue;
          }

          // One-time migration: pre-safeStorage builds persisted credentials
          // as plain base64 when the OS keyring was unavailable, which is
          // recoverable by anyone with file access. Re-encrypt such entries
          // immediately; the single atomic save below (temp file + rename)
          // removes every plaintext-format copy at once. This is idempotent —
          // migrated entries decrypt normally on the next launch — and crash
          // safe: dying before the save leaves the original file untouched so
          // the migration simply retries.
          const legacyPlaintext = decodeLegacyBase64Secret(cred.password);
          if (legacyPlaintext === null) {
            debug.warn('[AUTH] Could not decrypt stored credential for:', cred.realm);
            continue;
          }

          const reEncrypted = encryptSecret(safeStorage, legacyPlaintext);
          if (reEncrypted === null) {
            debug.warn('[AUTH] Could not re-encrypt legacy credential for:', cred.realm);
            continue;
          }

          this.credentials.set(cred.realm, { ...cred, password: reEncrypted });
          migratedAny = true;
        }

        if (migratedAny) {
          debug.log('[AUTH] Migrating legacy credentials to safeStorage format');
          await this.save();
        }
        debug.log('[AUTH] Loaded', this.credentials.size, 'credentials from disk');
      }
    } catch {
      debug.log('[AUTH] No existing credential cache found');
    }
  }

  private async save(): Promise<void> {
    if (!this.encryptionAvailable) {
      debug.warn('[AUTH] Skipping credential persistence because encryption is unavailable');
      return;
    }

    await this.savePromise;

    this.savePromise = (async () => {
      try {
        const data: StoredCache = {
          version: 1,
          credentials: Array.from(this.credentials.values()),
        };

        await writeSecureJson(this.storePath, data);
        debug.log('[AUTH] Saved', this.credentials.size, 'credentials to disk');
      } catch (error) {
        debug.error('[AUTH] Failed to save credentials:', error);
      }
    })();
  }
}

let authCacheInstance: AuthCache | null = null;

export function getAuthCache(): AuthCache {
  if (!authCacheInstance) {
    const { app } = require('electron');
    const userDataPath = app.getPath('userData');
    debug.log('[AUTH] Using userData path:', userDataPath);
    authCacheInstance = new AuthCache(userDataPath);
  }
  return authCacheInstance;
}

export { AuthCache };

export const authCache = {
  get instance(): AuthCache {
    return getAuthCache();
  },
};
