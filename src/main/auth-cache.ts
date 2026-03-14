import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'path';
import { safeStorage } from 'electron';

import { debug } from '@shared/utils/debug';

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

class AuthCache {
  private credentials: Map<string, CachedCredential> = new Map();
  private storePath: string;
  private encryptionAvailable: boolean;
  private loadPromise: Promise<void>;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.storePath = join(userDataPath, 'auth-cache.json');
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();

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
    const storedPassword = this.encryptionAvailable ? this.encrypt(password) : password;
    const credential: CachedCredential = {
      realm,
      username,
      password: storedPassword,
      createdAt: Date.now(),
    };
    this.credentials.set(realm, credential);
    this.save();
    debug.log('[AUTH] Credential saved for realm:', realm);
  }

  get(realm: string): { username: string; password: string } | null {
    const credential = this.credentials.get(realm);
    if (!credential) {
      return null;
    }

    try {
      const decryptedPassword = this.encryptionAvailable
        ? this.decrypt(credential.password)
        : credential.password;
      return {
        username: credential.username,
        password: decryptedPassword,
      };
    } catch {
      debug.error('[AUTH] Failed to decrypt credential for realm:', realm);
      this.delete(realm);
      return null;
    }
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

    // Then try prefix matching - find the longest matching realm
    let bestMatch: { realm: string; credential: CachedCredential } | null = null;

    for (const [realm, credential] of this.credentials) {
      // Check if the url starts with the realm (realm is a prefix)
      if (url.startsWith(realm)) {
        // Prefer longer (more specific) matches
        if (!bestMatch || realm.length > bestMatch.realm.length) {
          bestMatch = { realm, credential };
        }
      }
    }

    if (bestMatch) {
      try {
        const decryptedPassword = this.encryptionAvailable
          ? this.decrypt(bestMatch.credential.password)
          : bestMatch.credential.password;
        return {
          username: bestMatch.credential.username,
          password: decryptedPassword,
          realm: bestMatch.realm,
        };
      } catch {
        debug.error('[AUTH] Failed to decrypt credential for realm:', bestMatch.realm);
        this.delete(bestMatch.realm);
        return null;
      }
    }

    return null;
  }

  private encrypt(plaintext: string): string {
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  }

  private decrypt(ciphertext: string): string {
    const buffer = Buffer.from(ciphertext, 'base64');
    return safeStorage.decryptString(buffer);
  }

  private async load(): Promise<void> {
    try {
      await access(this.storePath);
      const content = await readFile(this.storePath, 'utf-8');
      const data: StoredCache = JSON.parse(content);

      if (data.version === 1 && Array.isArray(data.credentials)) {
        for (const cred of data.credentials) {
          if (this.encryptionAvailable) {
            try {
              this.decrypt(cred.password);
              this.credentials.set(cred.realm, cred);
            } catch {
              debug.warn('[AUTH] Could not decrypt stored credential for:', cred.realm);
            }
          } else {
            this.credentials.set(cred.realm, cred);
          }
        }
        debug.log('[AUTH] Loaded', this.credentials.size, 'credentials from disk');
      }
    } catch {
      debug.log('[AUTH] No existing credential cache found');
    }
  }

  private async save(): Promise<void> {
    await this.savePromise;

    this.savePromise = (async () => {
      try {
        const data: StoredCache = {
          version: 1,
          credentials: Array.from(this.credentials.values()),
        };

        const dir = dirname(this.storePath);
        await mkdir(dir, { recursive: true });

        await writeFile(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
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
