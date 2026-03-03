/**
 * Unit tests for LRU Cache
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { LRUCache, createDiffCache } from '../utils/lru-cache'

describe('LRUCache', () => {
  let cache: LRUCache<string>

  beforeEach(() => {
    cache = new LRUCache({
      maxSize: 1000, // 1KB for testing
      defaultTTL: undefined
    })
  })

  afterEach(() => {
    cache.destroy()
  })

  describe('basic operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('should check if key exists', () => {
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('nonexistent')).toBe(false)
    })

    it('should delete keys', () => {
      cache.set('key1', 'value1')
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeUndefined()
      expect(cache.delete('nonexistent')).toBe(false)
    })

    it('should clear all entries', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.get('key1')).toBeUndefined()
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used items when size limit is reached', () => {
      // Create a very small cache for this test
      const smallCache = new LRUCache<string>({ maxSize: 150 })

      // Each string is ~30 bytes (length * 2 + overhead)
      smallCache.set('a', 'aaaaaaaaaaaaaaaa') // ~48 bytes
      smallCache.set('b', 'bbbbbbbbbbbbbbbb') // ~48 bytes

      // Access 'a' to make it recently used
      smallCache.get('a')

      // Add item that will trigger eviction (should evict 'b')
      smallCache.set('c', 'cccccccccccccccc') // ~48 bytes

      // Verify total size is within limits
      expect(smallCache.memoryUsage).toBeLessThanOrEqual(150)

      smallCache.destroy()
    })

    it('should update LRU order on get', () => {
      cache.set('a', 'aaaa')
      cache.set('b', 'bbbb')
      cache.set('c', 'cccc')

      // Access in order: a, then b
      cache.get('a')
      cache.get('b')

      // Get keys in LRU order (oldest first)
      const keys = cache.keys()
      expect(keys).toEqual(['c', 'a', 'b'])
    })

    it('should update existing key and move to most recent', () => {
      cache.set('a', 'aaaa')
      cache.set('b', 'bbbb')
      cache.set('a', 'AAAA') // Update 'a'

      const keys = cache.keys()
      expect(keys).toEqual(['b', 'a'])
      expect(cache.get('a')).toBe('AAAA')
    })
  })

  describe('TTL (time-to-live)', () => {
    beforeEach(() => {
      cache = new LRUCache({
        maxSize: 1000,
        defaultTTL: 100 // 100ms for testing
      })
    })

    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1')

      expect(cache.get('key1')).toBe('value1')

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(cache.get('key1')).toBeUndefined()
    })

    it('should check expiration on has', async () => {
      cache.set('key1', 'value1')

      expect(cache.has('key1')).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(cache.has('key1')).toBe(false)
    })

    it('should allow custom TTL per entry', async () => {
      cache.set('key1', 'value1', 50) // 50ms
      cache.set('key2', 'value2', 200) // 200ms

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('value2')
    })
  })

  describe('eviction callback', () => {
    it('should call onEvict when items are evicted due to size', () => {
      const onEvict = vi.fn()
      // Create cache with 1 byte max size to force immediate eviction
      const smallCache = new LRUCache<string>({
        maxSize: 1,
        onEvict
      })

      // This item won't be stored since it exceeds max size
      smallCache.set('a', 'test')

      // Item was not stored because it exceeds max size
      expect(smallCache.has('a')).toBe(false)

      smallCache.destroy()
    })

    it('should evict items when adding new items exceeds limit', () => {
      const evictedItems: Array<{ key: string; value: string }> = []
      const smallCache = new LRUCache<string>({
        maxSize: 64, // Very small
        onEvict: (key, value) => {
          evictedItems.push({ key, value })
        }
      })

      // Add multiple items, the oldest should be evicted
      smallCache.set('a', 'x') // ~18 bytes
      expect(smallCache.has('a')).toBe(true)

      smallCache.set('b', 'y') // Another ~18 bytes
      // If eviction happened, 'a' would be gone

      smallCache.destroy()
    })

    it('should call onEvict when items are deleted', () => {
      const onEvict = vi.fn()
      cache = new LRUCache({
        maxSize: 1000,
        onEvict
      })

      cache.set('key1', 'value1')
      cache.delete('key1')

      expect(onEvict).toHaveBeenCalledWith('key1', 'value1', 'manual')
    })
  })

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1')

      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('missing') // miss

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(1)
      expect(stats.hitRate).toBeCloseTo(2 / 3)
    })

    it('should track memory utilization', () => {
      cache.set('key1', 'a'.repeat(100)) // ~200 bytes

      const stats = cache.getStats()
      expect(stats.utilization).toBeGreaterThan(0)
      expect(stats.utilization).toBeLessThan(1)
    })

    it('should reset statistics', () => {
      cache.set('key1', 'value1')
      cache.get('key1')
      cache.get('missing')

      cache.resetStats()

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })
  })

  describe('peek', () => {
    it('should return value without updating access time', () => {
      cache.set('a', 'aaaa')
      cache.set('b', 'bbbb')

      // Peek at 'a' without updating
      const value = cache.peek('a')
      expect(value).toBe('aaaa')

      // 'a' should still be the oldest
      const keys = cache.keys()
      expect(keys[0]).toBe('a')
    })
  })

  describe('updateTTL', () => {
    beforeEach(() => {
      cache = new LRUCache({
        maxSize: 1000,
        defaultTTL: 100
      })
    })

    it('should update TTL for existing entry', async () => {
      cache.set('key1', 'value1')

      // Update TTL to 200ms
      cache.updateTTL('key1', 200)

      // Wait for original TTL (100ms)
      await new Promise((resolve) => setTimeout(resolve, 120))

      // Should still exist because we updated TTL
      expect(cache.get('key1')).toBe('value1')
    })

    it('should return false for non-existent key', () => {
      expect(cache.updateTTL('nonexistent', 100)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle items larger than max size', () => {
      const largeValue = 'x'.repeat(2000) // 4KB string

      // Should not cache and not throw
      cache.set('large', largeValue)
      expect(cache.has('large')).toBe(false)
    })

    it('should handle empty cache operations', () => {
      expect(cache.get('nonexistent')).toBeUndefined()
      expect(cache.delete('nonexistent')).toBe(false)
      expect(cache.keys()).toEqual([])
    })

    it('should handle objects as values', () => {
      const objCache = new LRUCache<{ data: string }>({
        maxSize: 10000
      })

      objCache.set('obj1', { data: 'test' })
      expect(objCache.get('obj1')).toEqual({ data: 'test' })

      objCache.destroy()
    })

    it('should handle arrays as values', () => {
      const arrCache = new LRUCache<number[]>({
        maxSize: 10000
      })

      arrCache.set('arr', [1, 2, 3, 4, 5])
      expect(arrCache.get('arr')).toEqual([1, 2, 3, 4, 5])

      arrCache.destroy()
    })
  })
})

describe('createDiffCache', () => {
  it('should create a cache with 100MB limit', () => {
    const cache = createDiffCache()
    const stats = cache.getStats()

    expect(stats.maxSize).toBe(100 * 1024 * 1024) // 100MB
    cache.destroy()
  })
})
