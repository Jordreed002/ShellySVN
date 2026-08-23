import { app } from 'electron';
import { access, constants } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

import { OFFLINE_CACHE_SIZE_BYTES } from '@shared/constants';
import type { SvnCacheEntry, SvnCacheNamespace, SvnCacheStats } from '@shared/types';

import { getSettingsManager } from '../settings-manager';
import { isPathApprovedForIpc } from '../utils/approved-paths';
import { normalizeRepoUrl } from '../utils/svn-url';

const CACHE_FILE_NAME = 'svn-cache-v2.json';
const MAX_TOMBSTONES = 500;

interface CacheDocument {
  version: 2;
  entries: SvnCacheEntry[];
  clearedAt: number;
  namespaceClearedAt: Partial<Record<SvnCacheNamespace, number>>;
  pathClearedAt: Array<[string, number]>;
}

export interface SvnCacheConfiguration {
  filePath: string;
  logBudgetBytes: number;
  offlineBudgetBytes: number;
}

export interface SvnCacheSetOptions {
  ttlMs: number;
  operationStartedAt?: number;
}

type CacheConfigurationProvider = () => Promise<SvnCacheConfiguration>;
type LegacyCacheDiscarder = () => Promise<void>;

async function discardLegacyLogCache(): Promise<void> {
  const { getStore } = await import('../ipc/store');
  await (await getStore()).delete('shellysvn:log-cache');
}

function entryId(namespace: SvnCacheNamespace, key: string): string {
  return JSON.stringify([namespace, key]);
}

/** URL-shaped keys (`scheme://…`), distinguished from `C:\`-style drive paths. */
const URL_SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

function normalizeCachePath(path: string): string {
  // URL keys are canonicalized as repository URLs (scheme/host casing,
  // percent-encoding, trailing slashes) instead of being lowercased like a
  // win32 filesystem path: URL hosts are case-insensitive but their paths
  // are not.
  if (URL_SCHEME_PREFIX.test(path)) {
    return normalizeRepoUrl(path);
  }
  const slashNormalized = path.replace(/\\/g, '/');
  const normalized =
    slashNormalized.length > 1 ? slashNormalized.replace(/\/+$/, '') : slashNormalized;
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function serializedSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function entrySerializedSize(entry: Omit<SvnCacheEntry, 'sizeBytes'>): number {
  let sizeBytes = 0;
  let nextSize = serializedSize({ ...entry, sizeBytes });
  while (nextSize !== sizeBytes) {
    sizeBytes = nextSize;
    nextSize = serializedSize({ ...entry, sizeBytes });
  }
  return sizeBytes;
}

export async function resolveSvnCacheRoot(
  configuredRoot: string,
  defaultRoot: string,
  isApproved: (path: string) => boolean = isPathApprovedForIpc,
  prepare: (path: string) => Promise<void> = async (path) => {
    await mkdir(path, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      access(path, constants.R_OK | constants.W_OK, (error) => (error ? reject(error) : resolve()));
    });
  }
): Promise<string> {
  if (!configuredRoot) return defaultRoot;
  if (!isAbsolute(configuredRoot) || !isApproved(configuredRoot)) {
    console.warn('[SVN Cache] Ignoring an unapproved custom cache directory.');
    return defaultRoot;
  }
  try {
    await prepare(configuredRoot);
    return configuredRoot;
  } catch (error) {
    console.warn(
      '[SVN Cache] Custom cache directory is unavailable; using application data:',
      (error as Error).message
    );
    return defaultRoot;
  }
}

async function getProductionConfiguration(): Promise<SvnCacheConfiguration> {
  const settingsManager = getSettingsManager();
  await settingsManager.ready();
  const settings = settingsManager.getSettings();
  const configuredRoot = settings.logCachePath.trim();
  const defaultRoot = join(app.getPath('userData'), 'shelly-cache');
  const cacheRoot = await resolveSvnCacheRoot(configuredRoot, defaultRoot);

  const configuredMegabytes = Number.isFinite(settings.maxLogCacheSize)
    ? Math.min(1000, Math.max(10, settings.maxLogCacheSize))
    : 100;

  return {
    filePath: join(normalize(cacheRoot), CACHE_FILE_NAME),
    logBudgetBytes: configuredMegabytes * 1024 * 1024,
    offlineBudgetBytes: OFFLINE_CACHE_SIZE_BYTES,
  };
}

export class SvnCacheService {
  private readonly entries = new Map<string, SvnCacheEntry>();
  private readonly pathClearedAt = new Map<string, number>();
  private readonly namespaceClearedAt = new Map<SvnCacheNamespace, number>();
  private operationChain: Promise<void> = Promise.resolve();
  private configuration: SvnCacheConfiguration | null = null;
  private clearedAt = 0;
  private legacyCacheHandled = false;

  constructor(
    private readonly configurationProvider: CacheConfigurationProvider = getProductionConfiguration,
    private readonly now: () => number = Date.now,
    private readonly legacyCacheDiscarder: LegacyCacheDiscarder | null = null
  ) {}

  get<T>(namespace: SvnCacheNamespace, key: string): Promise<SvnCacheEntry<T> | null> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      const changed = this.purgeExpired();
      const cached = this.entries.get(entryId(namespace, key));
      if (!cached) {
        if (changed) await this.persist();
        return null;
      }

      cached.lastAccessedAt = this.now();
      await this.persist();
      return cached as SvnCacheEntry<T>;
    });
  }

  set<T>(
    namespace: SvnCacheNamespace,
    key: string,
    path: string,
    data: T,
    options: SvnCacheSetOptions
  ): Promise<{ success: boolean; error?: string; stale?: boolean }> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      const now = this.now();
      const operationStartedAt = options.operationStartedAt ?? now;
      const normalizedPath = normalizeCachePath(path);
      const latestPathClear = this.latestOverlappingPathClear(normalizedPath);
      const latestNamespaceClear = this.namespaceClearedAt.get(namespace) ?? 0;
      if (
        operationStartedAt <= this.clearedAt ||
        operationStartedAt <= latestNamespaceClear ||
        operationStartedAt <= latestPathClear
      ) {
        return { success: false, stale: true, error: 'Cache write was superseded by a clear.' };
      }
      if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
        return { success: false, error: 'Cache TTL must be a positive number.' };
      }

      const baseEntry = {
        namespace,
        key,
        path: normalizedPath,
        data,
        cachedAt: now,
        expiresAt: now + options.ttlMs,
        lastAccessedAt: now,
      };
      const sizeBytes = entrySerializedSize(baseEntry);
      const budget = this.budgetFor(namespace);
      if (sizeBytes > budget) {
        return {
          success: false,
          error: `Cache entry is ${sizeBytes} bytes and exceeds its ${budget}-byte budget.`,
        };
      }

      this.entries.set(entryId(namespace, key), { ...baseEntry, sizeBytes });
      this.purgeExpired();
      this.evictToBudgets();
      await this.persist();
      return { success: true };
    });
  }

  delete(namespace: SvnCacheNamespace, key: string): Promise<void> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      this.entries.delete(entryId(namespace, key));
      await this.persist();
    });
  }

  list<T>(namespace: SvnCacheNamespace): Promise<Array<SvnCacheEntry<T>>> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      if (this.purgeExpired()) await this.persist();
      return Array.from(this.entries.values()).filter(
        (entry): entry is SvnCacheEntry<T> => entry.namespace === namespace
      );
    });
  }

  clearNamespace(namespace: SvnCacheNamespace, clearedAt = this.now()): Promise<void> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      this.namespaceClearedAt.set(
        namespace,
        Math.max(this.namespaceClearedAt.get(namespace) ?? 0, clearedAt)
      );
      for (const [id, entry] of this.entries) {
        if (entry.namespace === namespace) this.entries.delete(id);
      }
      await this.persist();
    });
  }

  clearPath(path: string, clearedAt = this.now()): Promise<void> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      const normalizedPath = normalizeCachePath(path);
      this.pathClearedAt.delete(normalizedPath);
      this.pathClearedAt.set(normalizedPath, clearedAt);
      while (this.pathClearedAt.size > MAX_TOMBSTONES) {
        const oldest = this.pathClearedAt.keys().next().value;
        if (!oldest) break;
        this.pathClearedAt.delete(oldest);
      }

      for (const [id, entry] of this.entries) {
        if (pathsOverlap(entry.path, normalizedPath)) {
          this.entries.delete(id);
        }
      }
      await this.persist();
    });
  }

  clearAll(clearedAt = this.now()): Promise<void> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      this.clearedAt = Math.max(this.clearedAt, clearedAt);
      this.entries.clear();
      this.namespaceClearedAt.clear();
      this.pathClearedAt.clear();
      await this.persist();
    });
  }

  stats(): Promise<SvnCacheStats> {
    return this.withLock(async () => {
      await this.ensureConfigured();
      if (this.purgeExpired()) await this.persist();

      let logSize = 0;
      let offlineSize = 0;
      const counts: Record<SvnCacheNamespace, number> = {
        info: 0,
        status: 0,
        log: 0,
        entries: 0,
      };
      for (const entry of this.entries.values()) {
        counts[entry.namespace]++;
        if (entry.namespace === 'log') logSize += entry.sizeBytes;
        else offlineSize += entry.sizeBytes;
      }

      return {
        infoCount: counts.info,
        statusCount: counts.status,
        logCount: counts.log,
        entriesCount: counts.entries,
        totalSize: logSize + offlineSize,
        logSize,
        offlineSize,
        logBudgetBytes: this.configuration!.logBudgetBytes,
        offlineBudgetBytes: this.configuration!.offlineBudgetBytes,
        filePath: this.configuration!.filePath,
      };
    });
  }

  resetForTests(): void {
    this.entries.clear();
    this.namespaceClearedAt.clear();
    this.pathClearedAt.clear();
    this.configuration = null;
    this.clearedAt = 0;
    this.legacyCacheHandled = false;
    this.operationChain = Promise.resolve();
  }

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async ensureConfigured(): Promise<void> {
    if (!this.legacyCacheHandled && this.legacyCacheDiscarder) {
      await this.legacyCacheDiscarder();
      this.legacyCacheHandled = true;
    }
    const next = await this.configurationProvider();
    if (this.configuration?.filePath === next.filePath) {
      this.configuration = next;
      if (this.evictToBudgets()) await this.persist();
      return;
    }

    const previousEntries = Array.from(this.entries.values());
    this.configuration = next;
    this.entries.clear();
    this.namespaceClearedAt.clear();
    this.pathClearedAt.clear();
    this.clearedAt = 0;

    try {
      const raw = await readFile(next.filePath, 'utf8');
      const document = JSON.parse(raw) as CacheDocument;
      if (document.version === 2) {
        for (const entry of document.entries ?? []) {
          this.entries.set(entryId(entry.namespace, entry.key), entry);
        }
        this.clearedAt = document.clearedAt || 0;
        for (const [namespace, timestamp] of Object.entries(document.namespaceClearedAt ?? {})) {
          if (
            (namespace === 'info' ||
              namespace === 'status' ||
              namespace === 'log' ||
              namespace === 'entries') &&
            typeof timestamp === 'number'
          ) {
            this.namespaceClearedAt.set(namespace, timestamp);
          }
        }
        for (const [path, timestamp] of document.pathClearedAt ?? []) {
          this.pathClearedAt.set(path, timestamp);
        }
      }
    } catch {
      for (const entry of previousEntries) {
        this.entries.set(entryId(entry.namespace, entry.key), entry);
      }
    }

    this.purgeExpired();
    this.evictToBudgets();
    await this.persist();
  }

  private purgeExpired(): boolean {
    const now = this.now();
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  private evictToBudgets(): boolean {
    const logChanged = this.evictGroup('log', this.configuration!.logBudgetBytes);
    const offlineChanged = this.evictGroup('offline', this.configuration!.offlineBudgetBytes);
    return logChanged || offlineChanged;
  }

  private evictGroup(group: 'log' | 'offline', budget: number): boolean {
    const candidates = Array.from(this.entries.entries())
      .filter(([, entry]) =>
        group === 'log' ? entry.namespace === 'log' : entry.namespace !== 'log'
      )
      .toSorted(
        ([, left], [, right]) =>
          left.lastAccessedAt - right.lastAccessedAt || left.cachedAt - right.cachedAt
      );
    let size = candidates.reduce((total, [, entry]) => total + entry.sizeBytes, 0);
    let changed = false;
    for (const [id, entry] of candidates) {
      if (size <= budget) break;
      this.entries.delete(id);
      size -= entry.sizeBytes;
      changed = true;
    }
    return changed;
  }

  private budgetFor(namespace: SvnCacheNamespace): number {
    return namespace === 'log'
      ? this.configuration!.logBudgetBytes
      : this.configuration!.offlineBudgetBytes;
  }

  private latestOverlappingPathClear(path: string): number {
    let latest = 0;
    for (const [clearedPath, timestamp] of this.pathClearedAt) {
      if (pathsOverlap(path, clearedPath)) latest = Math.max(latest, timestamp);
    }
    return latest;
  }

  private async persist(): Promise<void> {
    const filePath = this.configuration!.filePath;
    await mkdir(dirname(filePath), { recursive: true });
    const document: CacheDocument = {
      version: 2,
      entries: Array.from(this.entries.values()),
      clearedAt: this.clearedAt,
      namespaceClearedAt: Object.fromEntries(this.namespaceClearedAt),
      pathClearedAt: Array.from(this.pathClearedAt.entries()),
    };
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(document), 'utf8');
    await rename(temporaryPath, filePath);
  }
}

let sharedSvnCacheService: SvnCacheService | null = null;

export function getSvnCacheService(): SvnCacheService {
  sharedSvnCacheService ??= new SvnCacheService(
    getProductionConfiguration,
    Date.now,
    discardLegacyLogCache
  );
  return sharedSvnCacheService;
}

export function resetSvnCacheServiceForTests(service: SvnCacheService | null = null): void {
  sharedSvnCacheService = service;
}
