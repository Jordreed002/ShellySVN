import { useState, useCallback, useEffect } from 'react'
import type { SvnStatusEntry } from '@shared/types'

/**
 * Review item structure
 */
export interface ReviewItem {
  path: string
  status: string
  reviewStatus: 'pending' | 'approved' | 'changes-requested' | 'commented'
  comments: ReviewComment[]
  addedAt: number
}

/**
 * Review comment structure
 */
export interface ReviewComment {
  id: string
  path: string
  lineNumber?: number
  content: string
  author: string
  createdAt: number
}

/**
 * Review bundle structure
 */
export interface ReviewBundle {
  id: string
  name: string
  description?: string
  items: ReviewItem[]
  createdBy: string
  createdAt: number
  updatedAt: number
  status: 'draft' | 'ready' | 'submitted' | 'completed'
  repositoryPath: string
  baseRevision: number
  diff?: string
}

/**
 * Storage key for review bundles
 */
const STORAGE_KEY = 'shellysvn-review-bundles'

/**
 * Hook for managing review mode
 */
export function useReviewMode(repositoryPath: string) {
  const [bundles, setBundles] = useState<ReviewBundle[]>([])
  const [activeBundle, setActiveBundle] = useState<ReviewBundle | null>(null)
  const [reviewItems, setReviewItems] = useState<Map<string, ReviewItem>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  
  /**
   * Load bundles from storage
   */
  const loadBundles = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = await window.api.store.get<ReviewBundle[]>(STORAGE_KEY)
      if (stored) {
        const repoBundles = stored.filter(b => b.repositoryPath === repositoryPath)
        setBundles(repoBundles)
      }
    } catch (error) {
      console.error('Failed to load review bundles:', error)
    } finally {
      setIsLoading(false)
    }
  }, [repositoryPath])
  
  /**
   * Save bundles to storage
   */
  const saveBundles = useCallback(async (newBundles: ReviewBundle[]) => {
    try {
      // Get all bundles and merge with updated ones
      const stored = await window.api.store.get<ReviewBundle[]>(STORAGE_KEY) || []
      const updated = [...stored]
      
      for (const bundle of newBundles) {
        const index = updated.findIndex(b => b.id === bundle.id)
        if (index >= 0) {
          updated[index] = bundle
        } else {
          updated.push(bundle)
        }
      }
      
      await window.api.store.set(STORAGE_KEY, updated)
    } catch (error) {
      console.error('Failed to save review bundles:', error)
    }
  }, [])
  
  /**
   * Create a new review bundle
   */
  const createBundle = useCallback(async (
    name: string, 
    description?: string,
    items: SvnStatusEntry[] = []
  ): Promise<ReviewBundle> => {
    const now = Date.now()
    const bundle: ReviewBundle = {
      id: `bundle-${now}`,
      name,
      description,
      items: items.map(item => ({
        path: item.path,
        status: item.status,
        reviewStatus: 'pending',
        comments: [],
        addedAt: now
      })),
      createdBy: process.env.USER || process.env.USERNAME || 'unknown',
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      repositoryPath,
      baseRevision: 0
    }
    
    const newBundles = [...bundles, bundle]
    setBundles(newBundles)
    await saveBundles(newBundles)
    
    return bundle
  }, [bundles, repositoryPath, saveBundles])
  
  /**
   * Update a bundle
   */
  const updateBundle = useCallback(async (
    bundleId: string, 
    updates: Partial<ReviewBundle>
  ): Promise<void> => {
    const newBundles = bundles.map(b => 
      b.id === bundleId 
        ? { ...b, ...updates, updatedAt: Date.now() }
        : b
    )
    setBundles(newBundles)
    await saveBundles(newBundles)
    
    if (activeBundle?.id === bundleId) {
      setActiveBundle(newBundles.find(b => b.id === bundleId) || null)
    }
  }, [bundles, activeBundle, saveBundles])
  
  /**
   * Delete a bundle
   */
  const deleteBundle = useCallback(async (bundleId: string): Promise<void> => {
    const newBundles = bundles.filter(b => b.id !== bundleId)
    setBundles(newBundles)
    await saveBundles(newBundles)
    
    if (activeBundle?.id === bundleId) {
      setActiveBundle(null)
    }
  }, [bundles, activeBundle, saveBundles])
  
  /**
   * Add file to active bundle
   */
  const addToBundle = useCallback(async (
    bundleId: string, 
    entry: SvnStatusEntry
  ): Promise<void> => {
    const bundle = bundles.find(b => b.id === bundleId)
    if (!bundle) return
    
    const exists = bundle.items.some(i => i.path === entry.path)
    if (exists) return
    
    const newItem: ReviewItem = {
      path: entry.path,
      status: entry.status,
      reviewStatus: 'pending',
      comments: [],
      addedAt: Date.now()
    }
    
    await updateBundle(bundleId, {
      items: [...bundle.items, newItem]
    })
  }, [bundles, updateBundle])
  
  /**
   * Remove file from bundle
   */
  const removeFromBundle = useCallback(async (
    bundleId: string, 
    path: string
  ): Promise<void> => {
    const bundle = bundles.find(b => b.id === bundleId)
    if (!bundle) return
    
    await updateBundle(bundleId, {
      items: bundle.items.filter(i => i.path !== path)
    })
  }, [bundles, updateBundle])
  
  /**
   * Update review status of an item
   */
  const updateReviewStatus = useCallback(async (
    bundleId: string,
    path: string,
    status: ReviewItem['reviewStatus']
  ): Promise<void> => {
    const bundle = bundles.find(b => b.id === bundleId)
    if (!bundle) return
    
    await updateBundle(bundleId, {
      items: bundle.items.map(i => 
        i.path === path ? { ...i, reviewStatus: status } : i
      )
    })
  }, [bundles, updateBundle])
  
  /**
   * Add comment to an item
   */
  const addComment = useCallback(async (
    bundleId: string,
    path: string,
    content: string,
    lineNumber?: number
  ): Promise<void> => {
    const bundle = bundles.find(b => b.id === bundleId)
    if (!bundle) return
    
    const comment: ReviewComment = {
      id: `comment-${Date.now()}`,
      path,
      lineNumber,
      content,
      author: process.env.USER || process.env.USERNAME || 'unknown',
      createdAt: Date.now()
    }
    
    await updateBundle(bundleId, {
      items: bundle.items.map(i => 
        i.path === path 
          ? { ...i, comments: [...i.comments, comment] }
          : i
      )
    })
  }, [bundles, updateBundle])
  
  /**
   * Mark file for review (outside of bundle)
   */
  const markForReview = useCallback((entry: SvnStatusEntry) => {
    const item: ReviewItem = {
      path: entry.path,
      status: entry.status,
      reviewStatus: 'pending',
      comments: [],
      addedAt: Date.now()
    }
    
    setReviewItems(prev => {
      const next = new Map(prev)
      next.set(entry.path, item)
      return next
    })
  }, [])
  
  /**
   * Unmark file for review
   */
  const unmarkForReview = useCallback((path: string) => {
    setReviewItems(prev => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }, [])
  
  /**
   * Check if file is marked for review
   */
  const isMarkedForReview = useCallback((path: string): boolean => {
    return reviewItems.has(path)
  }, [reviewItems])
  
  /**
   * Export bundle as patch
   */
  const exportAsPatch = useCallback(async (bundleId: string): Promise<string> => {
    const bundle = bundles.find(b => b.id === bundleId)
    if (!bundle) throw new Error('Bundle not found')
    
    const paths = bundle.items.map(i => i.path)
    const result = await window.api.svn.patch.create(paths, `${bundle.name}.patch`)
    
    return result.output
  }, [bundles])
  
  /**
   * Export bundle metadata as JSON
   */
  const exportAsJson = useCallback((bundleId: string): string => {
    const bundle = bundles.find(b => b.id === bundleId)
    if (!bundle) throw new Error('Bundle not found')
    
    return JSON.stringify(bundle, null, 2)
  }, [bundles])
  
  /**
   * Get review statistics
   */
  const getStats = useCallback(() => {
    if (!activeBundle) {
      return {
        total: 0,
        pending: 0,
        approved: 0,
        changesRequested: 0,
        commented: 0
      }
    }
    
    return {
      total: activeBundle.items.length,
      pending: activeBundle.items.filter(i => i.reviewStatus === 'pending').length,
      approved: activeBundle.items.filter(i => i.reviewStatus === 'approved').length,
      changesRequested: activeBundle.items.filter(i => i.reviewStatus === 'changes-requested').length,
      commented: activeBundle.items.filter(i => i.reviewStatus === 'commented').length
    }
  }, [activeBundle])
  
  // Load bundles on mount
  useEffect(() => {
    loadBundles()
  }, [loadBundles])
  
  return {
    bundles,
    activeBundle,
    setActiveBundle,
    reviewItems: Array.from(reviewItems.values()),
    isLoading,
    createBundle,
    updateBundle,
    deleteBundle,
    addToBundle,
    removeFromBundle,
    updateReviewStatus,
    addComment,
    markForReview,
    unmarkForReview,
    isMarkedForReview,
    exportAsPatch,
    exportAsJson,
    getStats
  }
}

export default useReviewMode
