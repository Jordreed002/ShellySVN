import { useState, useEffect, useCallback } from 'react'
import type { SvnLogResult, SvnLogEntry } from '@shared/types'

const LOG_CACHE_KEY = 'shellysvn:log-cache'
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days

interface CachedLog {
  path: string
  data: SvnLogResult
  cachedAt: number
  revision: number
}

interface LogCacheStore {
  [path: string]: CachedLog
}

/**
 * Hook for managing log caching
 */
export function useLogCache(path: string | null) {
  const [cachedLog, setCachedLog] = useState<CachedLog | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  
  // Load cached log from storage
  useEffect(() => {
    const loadCache = async () => {
      if (!path) {
        setCachedLog(null)
        return
      }
      
      try {
        const store = await window.api.store.get<LogCacheStore>(LOG_CACHE_KEY)
        if (store && store[path]) {
          const cached = store[path]
          // Check if cache is still valid
          if (Date.now() - cached.cachedAt < MAX_CACHE_AGE) {
            setCachedLog(cached)
          } else {
            // Remove expired cache
            delete store[path]
            await window.api.store.set(LOG_CACHE_KEY, store)
            setCachedLog(null)
          }
        } else {
          setCachedLog(null)
        }
      } catch {
        setCachedLog(null)
      }
    }
    
    loadCache()
  }, [path])
  
  // Save log to cache
  const saveToCache = useCallback(async (logData: SvnLogResult) => {
    if (!path || !logData.entries.length) return
    
    try {
      const store = await window.api.store.get<LogCacheStore>(LOG_CACHE_KEY) || {}
      
      store[path] = {
        path,
        data: logData,
        cachedAt: Date.now(),
        revision: logData.entries[0]?.revision || 0
      }
      
      await window.api.store.set(LOG_CACHE_KEY, store)
      setCachedLog(store[path])
    } catch (err) {
      console.error('Failed to cache log:', err)
    }
  }, [path])
  
  // Clear cache for current path
  const clearCache = useCallback(async () => {
    if (!path) return
    
    try {
      const store = await window.api.store.get<LogCacheStore>(LOG_CACHE_KEY)
      if (store && store[path]) {
        delete store[path]
        await window.api.store.set(LOG_CACHE_KEY, store)
        setCachedLog(null)
      }
    } catch (err) {
      console.error('Failed to clear cache:', err)
    }
  }, [path])
  
  // Clear all caches
  const clearAllCaches = useCallback(async () => {
    try {
      await window.api.store.delete(LOG_CACHE_KEY)
      setCachedLog(null)
    } catch (err) {
      console.error('Failed to clear all caches:', err)
    }
  }, [])
  
  // Get cached entries
  const getCachedEntries = useCallback((): SvnLogEntry[] => {
    return cachedLog?.data.entries || []
  }, [cachedLog])
  
  // Get cache info
  const getCacheInfo = useCallback(() => {
    if (!cachedLog) return null
    return {
      revision: cachedLog.revision,
      cachedAt: cachedLog.cachedAt,
      age: Date.now() - cachedLog.cachedAt,
      entryCount: cachedLog.data.entries.length
    }
  }, [cachedLog])
  
  // Check if we have cached data
  const hasCachedData = cachedLog !== null
  
  return {
    cachedLog: cachedLog?.data,
    cachedEntries: getCachedEntries(),
    cacheInfo: getCacheInfo(),
    hasCachedData,
    isOffline,
    setIsOffline,
    saveToCache,
    clearCache,
    clearAllCaches
  }
}

/**
 * Fetches log with cache fallback for offline support
 */
export function useCachedLog(path: string | null, limit: number = 100) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const {
    cachedLog,
    cachedEntries,
    cacheInfo,
    hasCachedData,
    saveToCache,
    setIsOffline
  } = useLogCache(path)
  
  // Fetch fresh log data
  const refreshLog = useCallback(async (): Promise<SvnLogResult | null> => {
    if (!path) return null
    
    setIsRefreshing(true)
    setIsOffline(false)
    
    try {
      const result = await window.api.svn.log(path, limit)
      await saveToCache(result)
      setIsRefreshing(false)
      return result
    } catch (err) {
      setIsRefreshing(false)
      
      // Check if we're offline
      if (!navigator.onLine || (err as Error).message?.includes('network')) {
        setIsOffline(true)
      }
      
      // Return cached data if available
      if (hasCachedData && cachedLog) {
        return cachedLog
      }
      
      throw err
    }
  }, [path, limit, saveToCache, setIsOffline, hasCachedData, cachedLog])
  
  return {
    refreshLog,
    cachedLog,
    cachedEntries,
    cacheInfo,
    hasCachedData,
    isRefreshing
  }
}
