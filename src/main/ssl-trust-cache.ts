import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'path';

import { app } from 'electron';

import { debug } from '@shared/utils/debug';

interface CachedSslTrust {
  realm: string;
  failures: string;
  createdAt: number;
}

interface StoredSslTrustCache {
  version: number;
  trusts: CachedSslTrust[];
}

function normalizeUrl(value: string): URL | null {
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
  const parsedRealm = normalizeUrl(realm);
  const parsedUrl = normalizeUrl(url);

  if (!parsedRealm || !parsedUrl || parsedRealm.origin !== parsedUrl.origin) {
    return false;
  }

  const realmPath = normalizeRealmPath(parsedRealm.pathname);
  const urlPath = normalizeRealmPath(parsedUrl.pathname);

  return realmPath === '/' || urlPath === realmPath || urlPath.startsWith(`${realmPath}/`);
}

class SslTrustCache {
  private trusts = new Map<string, CachedSslTrust>();
  private readonly storePath: string;
  private readonly loadPromise: Promise<void>;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.storePath = join(userDataPath, 'ssl-trust-cache.json');
    this.loadPromise = this.load();
  }

  async ready(): Promise<void> {
    await this.loadPromise;
  }

  set(realm: string, failures: string): void {
    if (!realm.trim() || !failures.trim()) {
      return;
    }

    this.trusts.set(realm, {
      realm,
      failures,
      createdAt: Date.now(),
    });
    void this.save();
    debug.log('[SSL] Saved certificate trust for realm:', realm);
  }

  findForUrl(url: string): { realm: string; failures: string } | null {
    const exact = this.trusts.get(url);
    if (exact) {
      return { realm: exact.realm, failures: exact.failures };
    }

    let bestMatch: CachedSslTrust | null = null;
    for (const trust of this.trusts.values()) {
      if (isRealmAncestorOfUrl(trust.realm, url)) {
        if (!bestMatch || trust.realm.length > bestMatch.realm.length) {
          bestMatch = trust;
        }
      }
    }

    return bestMatch ? { realm: bestMatch.realm, failures: bestMatch.failures } : null;
  }

  private async load(): Promise<void> {
    try {
      await access(this.storePath);
      const content = await readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(content) as StoredSslTrustCache;
      if (parsed.version !== 1 || !Array.isArray(parsed.trusts)) {
        return;
      }

      for (const trust of parsed.trusts) {
        if (trust.realm && trust.failures) {
          this.trusts.set(trust.realm, trust);
        }
      }
      debug.log('[SSL] Loaded', this.trusts.size, 'trusted certificate entries from disk');
    } catch {
      debug.log('[SSL] No existing SSL trust cache found');
    }
  }

  private async save(): Promise<void> {
    await this.savePromise;

    this.savePromise = (async () => {
      try {
        await mkdir(dirname(this.storePath), { recursive: true });
        const data: StoredSslTrustCache = {
          version: 1,
          trusts: Array.from(this.trusts.values()),
        };
        await writeFile(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
      } catch (error) {
        debug.error('[SSL] Failed to save trust cache:', error);
      }
    })();
  }
}

let sslTrustCacheInstance: SslTrustCache | null = null;

export function getSslTrustCache(): SslTrustCache {
  if (!sslTrustCacheInstance) {
    sslTrustCacheInstance = new SslTrustCache(app.getPath('userData'));
  }
  return sslTrustCacheInstance;
}
