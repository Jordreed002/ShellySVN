import { useState, useCallback, useEffect, useMemo } from 'react'
import type { SvnLogEntry } from '@shared/types'

/**
 * Activity feed item
 */
export interface ActivityItem {
  id: string
  type: 'commit' | 'update' | 'conflict' | 'branch' | 'tag' | 'merge' | 'lock' | 'unlock' | 'warning' | 'info'
  title: string
  description?: string
  repositoryPath: string
  repositoryUrl?: string
  author: string
  timestamp: number
  revision?: number
  metadata?: Record<string, unknown>
  isRead: boolean
}

/**
 * Activity filter
 */
export interface ActivityFilter {
  types?: ActivityItem['type'][]
  repositoryPath?: string
  author?: string
  since?: number
  until?: number
  unreadOnly?: boolean
}

const STORAGE_KEY = 'shellysvn-activity-feed'

/**
 * Hook for managing activity feed
 */
export function useActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<ActivityFilter>({})
  
  /**
   * Load activities from storage
   */
  const loadActivities = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = await window.api.store.get<ActivityItem[]>(STORAGE_KEY)
      if (stored) {
        setActivities(stored)
      }
    } catch (error) {
      console.error('Failed to load activity feed:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save activities to storage
   */
  const saveActivities = useCallback(async (newActivities: ActivityItem[]) => {
    try {
      // Keep only last 1000 activities
      const trimmed = newActivities.slice(-1000)
      await window.api.store.set(STORAGE_KEY, trimmed)
    } catch (error) {
      console.error('Failed to save activity feed:', error)
    }
  }, [])
  
  /**
   * Add activity
   */
  const addActivity = useCallback(async (activity: Omit<ActivityItem, 'id' | 'timestamp' | 'isRead'>): Promise<ActivityItem> => {
    const newActivity: ActivityItem = {
      ...activity,
      id: `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      isRead: false
    }
    
    const newActivities = [...activities, newActivity]
    setActivities(newActivities)
    await saveActivities(newActivities)
    
    return newActivity
  }, [activities, saveActivities])
  
  /**
   * Add commit activity
   */
  const addCommitActivity = useCallback(async (
    logEntry: SvnLogEntry,
    repositoryPath: string
  ): Promise<ActivityItem> => {
    return addActivity({
      type: 'commit',
      title: `Commit r${logEntry.revision}`,
      description: logEntry.message,
      repositoryPath,
      author: logEntry.author,
      revision: logEntry.revision,
      metadata: {
        paths: logEntry.paths
      }
    })
  }, [addActivity])
  
  /**
   * Mark activity as read
   */
  const markAsRead = useCallback(async (id: string): Promise<void> => {
    const newActivities = activities.map(a => 
      a.id === id ? { ...a, isRead: true } : a
    )
    setActivities(newActivities)
    await saveActivities(newActivities)
  }, [activities, saveActivities])
  
  /**
   * Mark all as read
   */
  const markAllAsRead = useCallback(async (): Promise<void> => {
    const newActivities = activities.map(a => ({ ...a, isRead: true }))
    setActivities(newActivities)
    await saveActivities(newActivities)
  }, [activities, saveActivities])
  
  /**
   * Clear all activities
   */
  const clearAll = useCallback(async (): Promise<void> => {
    setActivities([])
    await window.api.store.delete(STORAGE_KEY)
  }, [])
  
  /**
   * Filtered activities
   */
  const filteredActivities = useMemo(() => {
    let result = [...activities]
    
    if (filter.types && filter.types.length > 0) {
      result = result.filter(a => filter.types!.includes(a.type))
    }
    
    if (filter.repositoryPath) {
      result = result.filter(a => a.repositoryPath === filter.repositoryPath)
    }
    
    if (filter.author) {
      result = result.filter(a => a.author === filter.author)
    }
    
    if (filter.since) {
      result = result.filter(a => a.timestamp >= filter.since!)
    }
    
    if (filter.until) {
      result = result.filter(a => a.timestamp <= filter.until!)
    }
    
    if (filter.unreadOnly) {
      result = result.filter(a => !a.isRead)
    }
    
    // Sort by timestamp descending
    return result.sort((a, b) => b.timestamp - a.timestamp)
  }, [activities, filter])
  
  /**
   * Unread count
   */
  const unreadCount = useMemo(() => {
    return activities.filter(a => !a.isRead).length
  }, [activities])
  
  /**
   * Get unique authors
   */
  const authors = useMemo(() => {
    const set = new Set<string>()
    for (const a of activities) {
      set.add(a.author)
    }
    return Array.from(set).sort()
  }, [activities])
  
  // Load on mount
  useEffect(() => {
    loadActivities()
  }, [loadActivities])
  
  return {
    activities: filteredActivities,
    allActivities: activities,
    isLoading,
    filter,
    setFilter,
    unreadCount,
    authors,
    addActivity,
    addCommitActivity,
    markAsRead,
    markAllAsRead,
    clearAll
  }
}

export default useActivityFeed
