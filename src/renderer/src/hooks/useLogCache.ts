import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { debug } from '@shared/utils/debug';
import type { SvnLogEntry, SvnLogResult } from '@shared/types';

const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedLog {
  path: string;
  data: SvnLogResult;
  cachedAt: number;
  revision: number;
}

/**
 * Hook for managing log caching
 */
export function useLogCache(path: string | null, cacheScope = 'default') {
  const [cachedLog, setCachedLog] = useState<CachedLog | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const cachePath = path ? getLogCachePath(path, cacheScope) : null;
  const activeCachePathRef = useRef(cachePath);
  activeCachePathRef.current = cachePath;

  // Load cached log from storage
  useEffect(() => {
    let active = true;
    setCachedLog(null);

    const loadCache = async () => {
      if (!path || !cachePath) {
        return;
      }

      try {
        const entry = await window.api.svnCache.get<SvnLogResult>('log', cachePath);
        if (active) {
          setCachedLog(
            entry
              ? {
                  path,
                  data: entry.data,
                  cachedAt: entry.cachedAt,
                  revision: entry.data.entries[0]?.revision ?? 0,
                }
              : null
          );
        }
      } catch {
        if (active) setCachedLog(null);
      }
    };

    void loadCache();
    return () => {
      active = false;
    };
  }, [cachePath, path]);

  useEffect(() => {
    const handleExternalClear = () => setCachedLog(null);
    window.addEventListener('svn-cache-cleared', handleExternalClear);
    return () => window.removeEventListener('svn-cache-cleared', handleExternalClear);
  }, []);

  // Save log to cache
  const saveToCache = useCallback(
    async (logData: SvnLogResult) => {
      if (!path || !cachePath || !logData.entries.length) return;

      const operationStartedAt = Date.now();
      try {
        const cached: CachedLog = {
          path,
          data: logData,
          cachedAt: operationStartedAt,
          revision: logData.entries[0]?.revision || 0,
        };
        const result = await window.api.svnCache.set(
          'log',
          cachePath,
          path,
          logData,
          MAX_CACHE_AGE,
          operationStartedAt
        );
        if (result.success && activeCachePathRef.current === cachePath) {
          setCachedLog(cached);
        } else if (!result.success && !result.stale) {
          debug.error('Failed to cache log:', result.error);
        }
      } catch (err) {
        debug.error('Failed to cache log:', err);
      }
    },
    [cachePath, path]
  );

  // Clear cache for current path
  const clearCache = useCallback(async () => {
    if (!path || !cachePath) return;

    try {
      await window.api.svnCache.clearPath(path, Date.now());
      if (activeCachePathRef.current === cachePath) {
        setCachedLog(null);
      }
    } catch (err) {
      debug.error('Failed to clear cache:', err);
    }
  }, [cachePath, path]);

  // Clear all caches
  const clearAllCaches = useCallback(async () => {
    try {
      await window.api.svnCache.clearNamespace('log', Date.now());
      setCachedLog(null);
    } catch (err) {
      debug.error('Failed to clear all caches:', err);
    }
  }, []);

  // Get cached entries
  const getCachedEntries = useCallback((): SvnLogEntry[] => {
    return cachedLog?.data.entries || [];
  }, [cachedLog]);

  // Get cache info
  const getCacheInfo = useCallback(() => {
    if (!cachedLog) return null;
    return {
      revision: cachedLog.revision,
      cachedAt: cachedLog.cachedAt,
      age: Date.now() - cachedLog.cachedAt,
      entryCount: cachedLog.data.entries.length,
    };
  }, [cachedLog]);

  // Check if we have cached data
  const hasCachedData = cachedLog !== null;

  return {
    cachedLog: cachedLog?.data,
    cachedEntries: getCachedEntries(),
    cacheInfo: getCacheInfo(),
    hasCachedData,
    isOffline,
    setIsOffline,
    saveToCache,
    clearCache,
    clearAllCaches,
  };
}

/**
 * Fetches log with cache fallback for offline support
 */
export function useCachedLog(
  path: string | null,
  limit: number = 100,
  useMergeHistory = false,
  options: {
    stopOnCopy?: boolean;
    strictNodeHistory?: boolean;
    includeAllRevisionProperties?: boolean;
    revisionProperties?: string[];
  } = {}
) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const revisionPropertiesKey = JSON.stringify(
    normalizeRevisionProperties(options.revisionProperties)
  );
  const requestOptions = useMemo(
    () => ({
      stopOnCopy: Boolean(options.stopOnCopy),
      strictNodeHistory: Boolean(options.strictNodeHistory),
      includeAllRevisionProperties: Boolean(options.includeAllRevisionProperties),
      revisionProperties: JSON.parse(revisionPropertiesKey) as string[],
    }),
    [
      options.includeAllRevisionProperties,
      options.stopOnCopy,
      options.strictNodeHistory,
      revisionPropertiesKey,
    ]
  );
  const hasAdvancedOptions = Boolean(
    requestOptions.stopOnCopy ||
    requestOptions.strictNodeHistory ||
    requestOptions.includeAllRevisionProperties ||
    requestOptions.revisionProperties.length
  );
  const cacheScope = buildLogCacheScope(limit, useMergeHistory, requestOptions);
  const {
    cachedLog,
    cachedEntries,
    cacheInfo,
    hasCachedData,
    isOffline,
    saveToCache,
    setIsOffline,
    clearCache,
  } = useLogCache(path, cacheScope);
  const cachedLogRef = useRef(cachedLog);
  cachedLogRef.current = cachedLog;

  // Fetch fresh log data
  const refreshLog = useCallback(async (): Promise<SvnLogResult | null> => {
    if (!path) return null;

    setIsRefreshing(true);
    setIsOffline(false);

    try {
      const result = hasAdvancedOptions
        ? await window.api.svn.log(
            path,
            limit,
            undefined,
            undefined,
            useMergeHistory,
            requestOptions
          )
        : await window.api.svn.log(path, limit, undefined, undefined, useMergeHistory);
      if (result.cancelled) {
        throw new Error(result.error || 'Log request was cancelled');
      }
      if (result.error || result.parseError) {
        throw new Error(result.error || `Failed to parse SVN log: ${result.parseError}`);
      }
      await saveToCache(result);
      setIsRefreshing(false);
      return result;
    } catch (err) {
      setIsRefreshing(false);

      // Check if we're offline
      if (!navigator.onLine || (err as Error).message?.includes('network')) {
        setIsOffline(true);
      }

      // Return cached data if available
      if (cachedLogRef.current) {
        return cachedLogRef.current;
      }

      throw err;
    }
  }, [
    path,
    limit,
    useMergeHistory,
    requestOptions,
    hasAdvancedOptions,
    saveToCache,
    setIsOffline,
  ]);

  return {
    refreshLog,
    cachedLog,
    cachedEntries,
    cacheInfo,
    hasCachedData,
    isOffline,
    isRefreshing,
    clearCache,
  };
}

function getLogCachePath(path: string, cacheScope: string): string {
  return cacheScope === 'default' ? path : `${path}::${cacheScope}`;
}

export function buildLogCacheScope(
  limit: number,
  useMergeHistory: boolean,
  options: {
    stopOnCopy?: boolean;
    strictNodeHistory?: boolean;
    includeAllRevisionProperties?: boolean;
    revisionProperties?: string[];
  }
): string {
  const revisionProperties = normalizeRevisionProperties(options.revisionProperties);

  return `log:${JSON.stringify([
    limit,
    useMergeHistory,
    Boolean(options.stopOnCopy),
    Boolean(options.strictNodeHistory),
    Boolean(options.includeAllRevisionProperties),
    revisionProperties,
  ])}`;
}

function normalizeRevisionProperties(revisionProperties?: string[]): string[] {
  return Array.from(
    new Set((revisionProperties ?? []).map((property) => property.trim()).filter(Boolean))
  ).toSorted();
}
