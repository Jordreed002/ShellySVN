import { useState, useCallback, useEffect } from 'react';
import type {
  SvnCacheEntry,
  SvnCacheNamespace,
  SvnCacheStats,
  SvnInfoResult,
  SvnLogResult,
  SvnStatusResult,
  SvnStatusEntry,
} from '@shared/types';
import { formatBytes } from '@shared/utils/formatBytes';
import { formatDuration } from '@shared/utils/formatTime';
import {
  OFFLINE_CACHE_TTL_MS,
  OFFLINE_CACHE_SIZE_BYTES,
  OFFLINE_DURATION_UPDATE_INTERVAL_MS,
} from '@shared/constants';
import { assertSuccessfulSvnRead } from '../utils/svnReadResult';

/**
 * Cache configuration
 */
interface OfflineCacheConfig {
  /** Default TTL in milliseconds (default: 24 hours) */
  defaultTtl: number;
  /** Maximum cache size in bytes (default: 50 MB) */
  maxCacheSize: number;
  /** Whether to persist cache to disk */
  persistToDisk: boolean;
  /** Storage key for persisted cache */
  storageKey: string;
}

const DEFAULT_CONFIG: OfflineCacheConfig = {
  defaultTtl: OFFLINE_CACHE_TTL_MS,
  maxCacheSize: OFFLINE_CACHE_SIZE_BYTES,
  persistToDisk: true,
  storageKey: 'shellysvn-offline-cache',
};

// Module-level constant for default config to avoid new instances on every render
const EMPTY_PARTIAL_CONFIG: Partial<OfflineCacheConfig> = {};
const DEFAULT_LOG_LIMIT = 100;

function getLogCacheKey(path: string, limit = DEFAULT_LOG_LIMIT): string {
  return `${path}:${limit}`;
}
const CACHE_NAMESPACES: SvnCacheNamespace[] = ['info', 'status', 'log', 'entries'];
const sharedEntries: Record<SvnCacheNamespace, Map<string, SvnCacheEntry>> = {
  info: new Map(),
  status: new Map(),
  log: new Map(),
  entries: new Map(),
};
const listeners = new Set<() => void>();
let initialized = false;
let initialization: Promise<void> | null = null;
let cacheGeneration = 0;
let sharedStats: SvnCacheStats = {
  infoCount: 0,
  statusCount: 0,
  logCount: 0,
  entriesCount: 0,
  totalSize: 0,
  logSize: 0,
  offlineSize: 0,
  logBudgetBytes: 100 * 1024 * 1024,
  offlineBudgetBytes: OFFLINE_CACHE_SIZE_BYTES,
  filePath: '',
};

function notifyCacheConsumers(): void {
  for (const listener of listeners) listener();
}

function clearSharedRendererCache(): void {
  cacheGeneration++;
  for (const namespace of CACHE_NAMESPACES) sharedEntries[namespace].clear();
  sharedStats = {
    ...sharedStats,
    infoCount: 0,
    statusCount: 0,
    logCount: 0,
    entriesCount: 0,
    totalSize: 0,
    logSize: 0,
    offlineSize: 0,
  };
  notifyCacheConsumers();
}

async function refreshSharedCache(
  namespaces: SvnCacheNamespace[] = CACHE_NAMESPACES
): Promise<void> {
  const generation = cacheGeneration;
  const [loaded, stats] = await Promise.all([
    Promise.all(namespaces.map((namespace) => window.api.svnCache.list(namespace))),
    window.api.svnCache.stats(),
  ]);
  if (generation !== cacheGeneration) return;

  namespaces.forEach((namespace, index) => {
    sharedEntries[namespace] = new Map(loaded[index].map((entry) => [entry.key, entry]));
  });
  sharedStats = stats;
  notifyCacheConsumers();
}

async function initializeSharedCache(): Promise<void> {
  if (initialized) return;
  initialization ??= (async () => {
    try {
      await refreshSharedCache();
    } catch (error) {
      console.error('Failed to load offline cache:', error);
    } finally {
      initialized = true;
      notifyCacheConsumers();
    }
  })();
  await initialization;
}

function getSharedValue<T>(namespace: SvnCacheNamespace, key: string): T | null {
  const entry = sharedEntries[namespace].get(key);
  return entry && entry.expiresAt > Date.now() ? (entry.data as T) : null;
}

async function setSharedValue<T>(
  namespace: SvnCacheNamespace,
  key: string,
  path: string,
  data: T,
  ttlMs: number
): Promise<void> {
  const operationStartedAt = Date.now();
  const result = await window.api.svnCache.set(
    namespace,
    key,
    path,
    data,
    ttlMs,
    operationStartedAt
  );
  if (!result.success) {
    if (!result.stale) console.error(`Failed to cache ${namespace}:`, result.error);
    return;
  }
  await refreshSharedCache([namespace]);
}

function hasSharedValue(namespace: SvnCacheNamespace, key: string): boolean {
  return getSharedValue(namespace, key) !== null;
}

function getSharedAge(namespace: SvnCacheNamespace, key: string): number | null {
  const entry = sharedEntries[namespace].get(key);
  return entry && entry.expiresAt > Date.now() ? Date.now() - entry.cachedAt : null;
}

/**
 * Hook for managing offline cache of SVN data
 *
 * Provides caching of svn:info, status, and log data for offline access.
 * Cache can be persisted to disk and restored on app restart.
 */
export function useOfflineCache(config: Partial<OfflineCacheConfig> = EMPTY_PARTIAL_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const [, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    const handleExternalClear = () => clearSharedRendererCache();
    listeners.add(listener);
    window.addEventListener('svn-cache-cleared', handleExternalClear);
    void initializeSharedCache();
    return () => {
      listeners.delete(listener);
      window.removeEventListener('svn-cache-cleared', handleExternalClear);
    };
  }, []);

  /**
   * Get cached info
   */
  const getInfo = useCallback(
    (path: string): SvnInfoResult | null => getSharedValue('info', path),
    []
  );

  /**
   * Set cached info
   */
  const setInfo = useCallback(
    async (path: string, data: SvnInfoResult, ttl?: number) => {
      await setSharedValue('info', path, path, data, ttl || cfg.defaultTtl);
    },
    [cfg.defaultTtl]
  );

  /**
   * Get cached status
   */
  const getStatus = useCallback(
    (path: string): SvnStatusResult | null => getSharedValue('status', path),
    []
  );

  /**
   * Set cached status
   */
  const setStatus = useCallback(
    async (path: string, data: SvnStatusResult, ttl?: number) => {
      await setSharedValue('status', path, path, data, ttl || cfg.defaultTtl);
    },
    [cfg.defaultTtl]
  );

  /**
   * Get cached log
   */
  const getLog = useCallback(
    (path: string, limit = DEFAULT_LOG_LIMIT): SvnLogResult | null =>
      getSharedValue('log', getLogCacheKey(path, limit)),
    []
  );

  /**
   * Set cached log
   */
  const setLog = useCallback(
    async (path: string, data: SvnLogResult, ttl?: number, limit = DEFAULT_LOG_LIMIT) => {
      await setSharedValue('log', getLogCacheKey(path, limit), path, data, ttl || cfg.defaultTtl);
    },
    [cfg.defaultTtl]
  );

  /**
   * Get cached status entries
   */
  const getEntries = useCallback(
    (path: string): SvnStatusEntry[] | null => getSharedValue('entries', path),
    []
  );

  /**
   * Set cached status entries
   */
  const setEntries = useCallback(
    async (path: string, data: SvnStatusEntry[], ttl?: number) => {
      await setSharedValue('entries', path, path, data, ttl || cfg.defaultTtl);
    },
    [cfg.defaultTtl]
  );

  /**
   * Check if path has valid cache
   */
  const hasCache = useCallback(
    (type: 'info' | 'status' | 'log' | 'entries', path: string): boolean => {
      return hasSharedValue(type, path);
    },
    []
  );

  /**
   * Get cache age in milliseconds
   */
  const getCacheAge = useCallback(
    (type: 'info' | 'status' | 'log' | 'entries', path: string): number | null => {
      return getSharedAge(type, path);
    },
    []
  );

  /**
   * Clear all cache
   */
  const clearAll = useCallback(async () => {
    cacheGeneration++;
    await window.api.svnCache.clearAll(Date.now());
    clearSharedRendererCache();
  }, []);

  /**
   * Clear cache for a specific path
   */
  const clearPath = useCallback(async (path: string) => {
    cacheGeneration++;
    await window.api.svnCache.clearPath(path, Date.now());
    await refreshSharedCache();
  }, []);

  /**
   * Get cache statistics
   * PERFORMANCE: Uses estimated entry size to avoid O(n) JSON.stringify calls
   */
  const getStats = useCallback(() => {
    return {
      ...sharedStats,
      formattedSize: formatBytes(sharedStats.totalSize),
      isEstimated: false,
    };
  }, []);

  const persist = useCallback(() => refreshSharedCache(), []);

  return {
    isInitialized: initialized,
    getInfo,
    setInfo,
    getStatus,
    setStatus,
    getLog,
    setLog,
    getEntries,
    setEntries,
    hasCache,
    getCacheAge,
    clearAll,
    clearPath,
    getStats,
    persist,
  };
}

export function resetOfflineCacheForTests(): void {
  for (const namespace of CACHE_NAMESPACES) sharedEntries[namespace].clear();
  initialized = false;
  initialization = null;
  cacheGeneration = 0;
  sharedStats = {
    ...sharedStats,
    infoCount: 0,
    statusCount: 0,
    logCount: 0,
    entriesCount: 0,
    totalSize: 0,
    logSize: 0,
    offlineSize: 0,
  };
  listeners.clear();
}

/**
 * Hook for detecting offline state
 */
export function useOfflineDetector() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [lastOnlineTime, setLastOnlineTime] = useState<Date | null>(
    navigator.onLine ? new Date() : null
  );
  const [offlineDuration, setOfflineDuration] = useState(0);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setLastOnlineTime(new Date());
      setOfflineDuration(0);
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Update offline duration periodically
    const interval = setInterval(() => {
      if (isOffline && lastOnlineTime) {
        setOfflineDuration(Date.now() - lastOnlineTime.getTime());
      }
    }, OFFLINE_DURATION_UPDATE_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [isOffline, lastOnlineTime]);

  return {
    isOffline,
    isOnline: !isOffline,
    lastOnlineTime,
    offlineDuration,
    formattedOfflineDuration: formatDuration(offlineDuration, 'long'),
  };
}

/**
 * Hook for offline-aware SVN operations
 */
export function useOfflineAware(path: string) {
  const { isOffline } = useOfflineDetector();
  const cache = useOfflineCache();

  /**
   * Get info, from cache if offline
   */
  const getInfo = useCallback(async (): Promise<SvnInfoResult | null> => {
    if (isOffline) {
      return cache.getInfo(path);
    }

    try {
      const result = await window.api.svn.info(path);
      await cache.setInfo(path, result);
      return result;
    } catch {
      // Fallback to cache on error
      return cache.getInfo(path);
    }
  }, [isOffline, path, cache]);

  /**
   * Get status, from cache if offline
   */
  const getStatus = useCallback(async (): Promise<SvnStatusResult | null> => {
    if (isOffline) {
      return cache.getStatus(path);
    }

    try {
      const result = assertSuccessfulSvnRead(await window.api.svn.status(path));
      await cache.setStatus(path, result);
      return result;
    } catch {
      // Fallback to cache on error
      return cache.getStatus(path);
    }
  }, [isOffline, path, cache]);

  /**
   * Get log, from cache if offline
   */
  const getLog = useCallback(
    async (limit?: number): Promise<SvnLogResult | null> => {
      if (isOffline) {
        return cache.getLog(path, limit);
      }

      try {
        const result = assertSuccessfulSvnRead(await window.api.svn.log(path, limit));
        await cache.setLog(path, result, undefined, limit);
        return result;
      } catch {
        // Fallback to cache on error
        return cache.getLog(path, limit);
      }
    },
    [isOffline, path, cache]
  );

  /**
   * Get available offline data
   */
  const getOfflineData = useCallback(() => {
    return {
      hasInfo: cache.hasCache('info', path),
      hasStatus: cache.hasCache('status', path),
      hasLog: cache.hasCache('log', path),
      info: cache.getInfo(path),
      status: cache.getStatus(path),
    };
  }, [path, cache]);

  return {
    isOffline,
    getInfo,
    getStatus,
    getLog,
    getOfflineData,
    cache,
  };
}

export default useOfflineCache;
