import { Wifi, WifiOff, CloudOff, Clock, RefreshCw, Database } from 'lucide-react'
import { useOfflineDetector, useOfflineCache } from '../../hooks/useOfflineCache'

interface OfflineIndicatorProps {
  showDetails?: boolean
  className?: string
}

/**
 * Visual indicator for offline status
 */
export function OfflineIndicator({ showDetails = false, className = '' }: OfflineIndicatorProps) {
  const { isOffline, lastOnlineTime, formattedOfflineDuration } = useOfflineDetector()
  
  if (!isOffline) return null
  
  return (
    <div className={`flex items-center gap-2 px-3 py-2 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg ${className}`}>
      <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Offline Mode
        </span>
        {showDetails && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Last online: {lastOnlineTime?.toLocaleTimeString() || 'Unknown'}
            {formattedOfflineDuration && ` (${formattedOfflineDuration} ago)`}
          </span>
        )}
      </div>
    </div>
  )
}

interface OfflineStatusBarProps {
  className?: string
}

/**
 * Full offline status bar with cache information
 */
export function OfflineStatusBar({ className = '' }: OfflineStatusBarProps) {
  const { isOnline } = useOfflineDetector()
  const cache = useOfflineCache()
  const stats = cache.getStats()
  
  return (
    <div className={`flex items-center justify-between px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 ${className}`}>
      <div className="flex items-center gap-3">
        {isOnline ? (
          <>
            <Wifi className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-600 dark:text-green-400">Online</span>
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4 text-amber-500" />
            <span className="text-sm text-amber-600 dark:text-amber-400">Offline - Limited functionality</span>
          </>
        )}
      </div>
      
      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1">
          <Database className="w-3.5 h-3.5" />
          <span>Cache: {stats.formattedSize}</span>
        </div>
        <div className="flex items-center gap-1">
          <CloudOff className="w-3.5 h-3.5" />
          <span>{stats.infoCount + stats.statusCount + stats.logCount} items cached</span>
        </div>
      </div>
    </div>
  )
}

interface OfflineAwareContainerProps {
  children: React.ReactNode
  path: string
  onRefresh?: () => void
  showCacheAge?: boolean
}

/**
 * Container that shows offline state and cache information for a specific path
 */
export function OfflineAwareContainer({ 
  children, 
  path, 
  onRefresh,
  showCacheAge = true 
}: OfflineAwareContainerProps) {
  const { isOffline } = useOfflineDetector()
  const cache = useOfflineCache()
  
  const infoAge = cache.getCacheAge('info', path)
  const statusAge = cache.getCacheAge('status', path)
  
  const formatAge = (ms: number | null) => {
    if (!ms) return null
    const minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }
  
  return (
    <div className="relative">
      {isOffline && (
        <div className="absolute top-0 right-0 z-10 flex items-center gap-2 px-2 py-1 bg-amber-100 dark:bg-amber-900/50 rounded-bl-lg border-l border-b border-amber-300 dark:border-amber-700">
          <CloudOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs text-amber-700 dark:text-amber-300">Showing cached data</span>
        </div>
      )}
      
      {showCacheAge && !isOffline && (infoAge || statusAge) && (
        <div className="absolute top-0 right-0 z-10 flex items-center gap-2 px-2 py-1">
          {statusAge && (
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <Clock className="w-3 h-3" />
              <span>Status: {formatAge(statusAge)}</span>
            </div>
          )}
          {onRefresh && (
            <button 
              onClick={onRefresh}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
              title="Refresh"
            >
              <RefreshCw className="w-3 h-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />
            </button>
          )}
        </div>
      )}
      
      {children}
    </div>
  )
}

interface OfflineCacheManagerProps {
  className?: string
}

/**
 * Cache management panel for offline data
 */
export function OfflineCacheManager({ className = '' }: OfflineCacheManagerProps) {
  const cache = useOfflineCache()
  const stats = cache.getStats()
  
  const handleClearAll = async () => {
    if (confirm('Clear all cached data? This cannot be undone.')) {
      await cache.clearAll()
    }
  }
  
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 ${className}`}>
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
        <Database className="w-5 h-5" />
        Offline Cache
      </h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-slate-50 dark:bg-slate-900 rounded p-3 text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {stats.infoCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Info Cache</div>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-900 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {stats.statusCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Status Cache</div>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-900 rounded p-3 text-center">
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {stats.logCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Log Cache</div>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-900 rounded p-3 text-center">
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {stats.formattedSize}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Size</div>
        </div>
      </div>
      
      <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cached data enables limited offline functionality
        </p>
        <button
          onClick={handleClearAll}
          className="px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded-md"
        >
          Clear Cache
        </button>
      </div>
    </div>
  )
}

export default OfflineIndicator
