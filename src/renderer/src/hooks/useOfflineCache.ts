import { useState, useCallback, useEffect, useRef } from 'react'
import type { SvnInfoResult, SvnLogResult, SvnStatusResult, SvnStatusEntry } from '@shared/types'

/**
 * Offline cache entry with metadata
 */
interface CacheEntry<T> {
  data: T
  cachedAt: number
  expiresAt: number
  path: string
  checksum?: string
}

/**
 * Offline cache structure
 */
interface OfflineCache {
  info: Map<string, CacheEntry<SvnInfoResult>>
  status: Map<string, CacheEntry<SvnStatusResult>>
  log: Map<string, CacheEntry<SvnLogResult>>
  entries: Map<string, CacheEntry<SvnStatusEntry[]>>
}

/**
 * Cache configuration
 */
interface OfflineCacheConfig {
  /** Default TTL in milliseconds (default: 24 hours) */
  defaultTtl: number
  /** Maximum cache size in bytes (default: 50 MB) */
  maxCacheSize: number
  /** Whether to persist cache to disk */
  persistToDisk: boolean
  /** Storage key for persisted cache */
  storageKey: string
}

const DEFAULT_CONFIG: OfflineCacheConfig = {
  defaultTtl: 24 * 60 * 60 * 1000, // 24 hours
  maxCacheSize: 50 * 1024 * 1024, // 50 MB
  persistToDisk: true,
  storageKey: 'shellysvn-offline-cache'
}

/**
 * Hook for managing offline cache of SVN data
 * 
 * Provides caching of svn:info, status, and log data for offline access.
 * Cache can be persisted to disk and restored on app restart.
 */
export function useOfflineCache(config: Partial<OfflineCacheConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const cacheRef = useRef<OfflineCache>({
    info: new Map(),
    status: new Map(),
    log: new Map(),
    entries: new Map()
  })
  const [isInitialized, setIsInitialized] = useState(false)
  
  /**
   * Initialize cache from disk
   */
  const initialize = useCallback(async () => {
    if (!cfg.persistToDisk) {
      setIsInitialized(true)
      return
    }
    
    try {
      const stored = await window.api.store.get<string>(cfg.storageKey)
      if (stored) {
        const parsed = JSON.parse(stored) as {
          info: Array<[string, CacheEntry<SvnInfoResult>]>
          status: Array<[string, CacheEntry<SvnStatusResult>]>
          log: Array<[string, CacheEntry<SvnLogResult>]>
          entries: Array<[string, CacheEntry<SvnStatusEntry[]>]>
        }
        
        // Only load non-expired entries
        const now = Date.now()
        
        for (const [key, entry] of parsed.info || []) {
          if (entry.expiresAt > now) {
            cacheRef.current.info.set(key, entry)
          }
        }
        
        for (const [key, entry] of parsed.status || []) {
          if (entry.expiresAt > now) {
            cacheRef.current.status.set(key, entry)
          }
        }
        
        for (const [key, entry] of parsed.log || []) {
          if (entry.expiresAt > now) {
            cacheRef.current.log.set(key, entry)
          }
        }
        
        for (const [key, entry] of parsed.entries || []) {
          if (entry.expiresAt > now) {
            cacheRef.current.entries.set(key, entry)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load offline cache:', error)
    }
    
    setIsInitialized(true)
  }, [cfg.persistToDisk, cfg.storageKey])
  
  /**
   * Persist cache to disk
   */
  const persist = useCallback(async () => {
    if (!cfg.persistToDisk) return
    
    try {
      const data = {
        info: Array.from(cacheRef.current.info.entries()),
        status: Array.from(cacheRef.current.status.entries()),
        log: Array.from(cacheRef.current.log.entries()),
        entries: Array.from(cacheRef.current.entries.entries())
      }
      
      await window.api.store.set(cfg.storageKey, JSON.stringify(data))
    } catch (error) {
      console.error('Failed to persist offline cache:', error)
    }
  }, [cfg.persistToDisk, cfg.storageKey])
  
  /**
   * Get cached info
   */
  const getInfo = useCallback((path: string): SvnInfoResult | null => {
    const entry = cacheRef.current.info.get(path)
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data
    }
    return null
  }, [])
  
  /**
   * Set cached info
   */
  const setInfo = useCallback(async (path: string, data: SvnInfoResult, ttl?: number) => {
    const now = Date.now()
    const entry: CacheEntry<SvnInfoResult> = {
      data,
      cachedAt: now,
      expiresAt: now + (ttl || cfg.defaultTtl),
      path
    }
    cacheRef.current.info.set(path, entry)
    await persist()
  }, [cfg.defaultTtl, persist])
  
  /**
   * Get cached status
   */
  const getStatus = useCallback((path: string): SvnStatusResult | null => {
    const entry = cacheRef.current.status.get(path)
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data
    }
    return null
  }, [])
  
  /**
   * Set cached status
   */
  const setStatus = useCallback(async (path: string, data: SvnStatusResult, ttl?: number) => {
    const now = Date.now()
    const entry: CacheEntry<SvnStatusResult> = {
      data,
      cachedAt: now,
      expiresAt: now + (ttl || cfg.defaultTtl),
      path
    }
    cacheRef.current.status.set(path, entry)
    await persist()
  }, [cfg.defaultTtl, persist])
  
  /**
   * Get cached log
   */
  const getLog = useCallback((path: string): SvnLogResult | null => {
    const entry = cacheRef.current.log.get(path)
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data
    }
    return null
  }, [])
  
  /**
   * Set cached log
   */
  const setLog = useCallback(async (path: string, data: SvnLogResult, ttl?: number) => {
    const now = Date.now()
    const entry: CacheEntry<SvnLogResult> = {
      data,
      cachedAt: now,
      expiresAt: now + (ttl || cfg.defaultTtl),
      path
    }
    cacheRef.current.log.set(path, entry)
    await persist()
  }, [cfg.defaultTtl, persist])
  
  /**
   * Get cached status entries
   */
  const getEntries = useCallback((path: string): SvnStatusEntry[] | null => {
    const entry = cacheRef.current.entries.get(path)
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data
    }
    return null
  }, [])
  
  /**
   * Set cached status entries
   */
  const setEntries = useCallback(async (path: string, data: SvnStatusEntry[], ttl?: number) => {
    const now = Date.now()
    const entry: CacheEntry<SvnStatusEntry[]> = {
      data,
      cachedAt: now,
      expiresAt: now + (ttl || cfg.defaultTtl),
      path
    }
    cacheRef.current.entries.set(path, entry)
    await persist()
  }, [cfg.defaultTtl, persist])
  
  /**
   * Check if path has valid cache
   */
  const hasCache = useCallback((type: 'info' | 'status' | 'log' | 'entries', path: string): boolean => {
    const map = cacheRef.current[type]
    const entry = map.get(path)
    return entry !== undefined && entry.expiresAt > Date.now()
  }, [])
  
  /**
   * Get cache age in milliseconds
   */
  const getCacheAge = useCallback((type: 'info' | 'status' | 'log' | 'entries', path: string): number | null => {
    const map = cacheRef.current[type]
    const entry = map.get(path)
    if (entry && entry.expiresAt > Date.now()) {
      return Date.now() - entry.cachedAt
    }
    return null
  }, [])
  
  /**
   * Clear all cache
   */
  const clearAll = useCallback(async () => {
    cacheRef.current.info.clear()
    cacheRef.current.status.clear()
    cacheRef.current.log.clear()
    cacheRef.current.entries.clear()
    await persist()
  }, [persist])
  
  /**
   * Clear cache for a specific path
   */
  const clearPath = useCallback(async (path: string) => {
    cacheRef.current.info.delete(path)
    cacheRef.current.status.delete(path)
    cacheRef.current.log.delete(path)
    cacheRef.current.entries.delete(path)
    await persist()
  }, [persist])
  
  /**
   * Get cache statistics
   */
  const getStats = useCallback(() => {
    const now = Date.now()
    let validInfo = 0
    let validStatus = 0
    let validLog = 0
    let validEntries = 0
    let totalSize = 0
    
    for (const entry of cacheRef.current.info.values()) {
      if (entry.expiresAt > now) validInfo++
      totalSize += JSON.stringify(entry).length
    }
    
    for (const entry of cacheRef.current.status.values()) {
      if (entry.expiresAt > now) validStatus++
      totalSize += JSON.stringify(entry).length
    }
    
    for (const entry of cacheRef.current.log.values()) {
      if (entry.expiresAt > now) validLog++
      totalSize += JSON.stringify(entry).length
    }
    
    for (const entry of cacheRef.current.entries.values()) {
      if (entry.expiresAt > now) validEntries++
      totalSize += JSON.stringify(entry).length
    }
    
    return {
      infoCount: validInfo,
      statusCount: validStatus,
      logCount: validLog,
      entriesCount: validEntries,
      totalSize,
      formattedSize: formatBytes(totalSize)
    }
  }, [])
  
  // Initialize on mount
  useEffect(() => {
    initialize()
  }, [initialize])
  
  return {
    isInitialized,
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
    persist
  }
}

/**
 * Hook for detecting offline state
 */
export function useOfflineDetector() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [lastOnlineTime, setLastOnlineTime] = useState<Date | null>(
    navigator.onLine ? new Date() : null
  )
  const [offlineDuration, setOfflineDuration] = useState(0)
  
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false)
      setLastOnlineTime(new Date())
      setOfflineDuration(0)
    }
    
    const handleOffline = () => {
      setIsOffline(true)
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Update offline duration every minute
    const interval = setInterval(() => {
      if (isOffline && lastOnlineTime) {
        setOfflineDuration(Date.now() - lastOnlineTime.getTime())
      }
    }, 60000)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(interval)
    }
  }, [isOffline, lastOnlineTime])
  
  return {
    isOffline,
    isOnline: !isOffline,
    lastOnlineTime,
    offlineDuration,
    formattedOfflineDuration: formatDuration(offlineDuration)
  }
}

/**
 * Hook for offline-aware SVN operations
 */
export function useOfflineAware(path: string) {
  const { isOffline } = useOfflineDetector()
  const cache = useOfflineCache()
  
  /**
   * Get info, from cache if offline
   */
  const getInfo = useCallback(async (): Promise<SvnInfoResult | null> => {
    if (isOffline) {
      return cache.getInfo(path)
    }
    
    try {
      const result = await window.api.svn.info(path)
      await cache.setInfo(path, result)
      return result
    } catch {
      // Fallback to cache on error
      return cache.getInfo(path)
    }
  }, [isOffline, path, cache])
  
  /**
   * Get status, from cache if offline
   */
  const getStatus = useCallback(async (): Promise<SvnStatusResult | null> => {
    if (isOffline) {
      return cache.getStatus(path)
    }
    
    try {
      const result = await window.api.svn.status(path)
      await cache.setStatus(path, result)
      return result
    } catch {
      // Fallback to cache on error
      return cache.getStatus(path)
    }
  }, [isOffline, path, cache])
  
  /**
   * Get log, from cache if offline
   */
  const getLog = useCallback(async (limit?: number): Promise<SvnLogResult | null> => {
    const cacheKey = `${path}:${limit || 100}`
    
    if (isOffline) {
      return cache.getLog(cacheKey)
    }
    
    try {
      const result = await window.api.svn.log(path, limit)
      await cache.setLog(cacheKey, result)
      return result
    } catch {
      // Fallback to cache on error
      return cache.getLog(cacheKey)
    }
  }, [isOffline, path, cache])
  
  /**
   * Get available offline data
   */
  const getOfflineData = useCallback(() => {
    return {
      hasInfo: cache.hasCache('info', path),
      hasStatus: cache.hasCache('status', path),
      hasLog: cache.hasCache('log', path),
      info: cache.getInfo(path),
      status: cache.getStatus(path)
    }
  }, [path, cache])
  
  return {
    isOffline,
    getInfo,
    getStatus,
    getLog,
    getOfflineData,
    cache
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Format duration to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 60000) return '< 1 minute'
  if (ms < 3600000) return `${Math.floor(ms / 60000)} minutes`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)} hours`
  return `${Math.floor(ms / 86400000)} days`
}

export default useOfflineCache
