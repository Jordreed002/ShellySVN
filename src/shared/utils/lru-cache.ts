/**
 * LRU (Least Recently Used) Cache Implementation
 *
 * A memory-efficient cache with automatic eviction of least recently used items
 * when the memory limit is reached. Designed for caching parsed diff data and
 * other large objects.
 *
 * Features:
 * - Memory-based limit (default 100MB)
 * - O(1) get and set operations using Map
 * - Automatic eviction of least recently used items
 * - Optional TTL (time-to-live) for entries
 * - Memory estimation for complex objects
 */

interface CacheEntry<V> {
  value: V;
  size: number; // Estimated size in bytes
  timestamp: number; // Last access time
  ttl?: number; // Time-to-live in milliseconds
  expiresAt?: number; // Expiration timestamp
}

interface LRUCacheOptions<V = unknown> {
  /** Maximum cache size in bytes (default: 100MB) */
  maxSize: number;
  /** Default TTL for entries in milliseconds (optional) */
  defaultTTL?: number;
  /** Callback when an entry is evicted */
  onEvict?: (key: string, value: V, reason: 'size' | 'ttl' | 'manual') => void;
}

interface CacheStats {
  /** Current cache size in bytes */
  size: number;
  /** Maximum cache size in bytes */
  maxSize: number;
  /** Number of entries in cache */
  entries: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Memory utilization (0-1) */
  utilization: number;
}

/** Maximum depth for recursive size estimation to prevent stack overflow */
const MAX_ESTIMATE_DEPTH = 10;

/**
 * Estimate the memory size of a value in bytes
 * Uses a depth limit to prevent stack overflow on circular references
 */
function estimateSize(
  value: unknown,
  depth: number = 0,
  seen: WeakSet<object> = new WeakSet()
): number {
  if (value === null || value === undefined) {
    return 8; // Primitive overhead
  }

  // Prevent infinite recursion on circular references
  if (depth > MAX_ESTIMATE_DEPTH) {
    return 64; // Fallback for deep nesting
  }

  switch (typeof value) {
    case 'boolean':
      return 8;
    case 'number':
      return 16;
    case 'string':
      // UTF-8: 2 bytes per character on average, plus object overhead
      return (value as string).length * 2 + 16;
    case 'object':
      // Check for circular reference
      if (seen.has(value as object)) {
        return 8; // Circular reference - just count the reference
      }
      seen.add(value as object);

      if (Array.isArray(value)) {
        // Array overhead + recursive size estimation
        return (
          32 +
          (value as unknown[]).reduce(
            (sum: number, item) => sum + estimateSize(item, depth + 1, seen),
            0
          )
        );
      }
      if (value instanceof Map) {
        let size = 32;
        value.forEach((v, k) => {
          size += estimateSize(k, depth + 1, seen) + estimateSize(v, depth + 1, seen) + 16;
        });
        return size;
      }
      if (value instanceof Set) {
        let size = 32;
        value.forEach((v) => {
          size += estimateSize(v, depth + 1, seen) + 16;
        });
        return size;
      }
      if (value instanceof Date) {
        return 32;
      }
      if (ArrayBuffer.isView(value)) {
        return (value as ArrayBufferView).byteLength + 32;
      }
      // Plain object
      return (
        32 +
        Object.entries(value as object).reduce(
          (sum, [k, v]) =>
            sum + estimateSize(k, depth + 1, seen) + estimateSize(v, depth + 1, seen) + 8,
          0
        )
      );
    default:
      return 64; // Fallback for unknown types
  }
}

/**
 * LRU Cache with memory-based eviction
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<ParsedDiff>({ maxSize: 100 * 1024 * 1024 }) // 100MB
 *
 * cache.set('diff-1', parsedDiff)
 * const cached = cache.get('diff-1')
 * ```
 */
export class LRUCache<V = unknown> {
  private cache: Map<string, CacheEntry<V>> = new Map();
  private currentSize: number = 0;
  private hits: number = 0;
  private misses: number = 0;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private readonly maxSize: number;
  private readonly defaultTTL: number | undefined;
  private readonly onEvict?: (key: string, value: V, reason: 'size' | 'ttl' | 'manual') => void;

  constructor(options: LRUCacheOptions) {
    this.maxSize = options.maxSize;
    this.defaultTTL = options.defaultTTL;
    this.onEvict = options.onEvict;

    // Run periodic cleanup for expired entries (every 30 seconds)
    if (this.defaultTTL) {
      this.cleanupInterval = setInterval(() => this.cleanupExpired(), 30000);
    }
  }

  /**
   * Get a value from the cache
   * Updates the access time and moves the entry to the end (most recently used)
   */
  get(key: string): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access time and move to end (most recently used)
    entry.timestamp = Date.now();
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in the cache
   * Evicts least recently used entries if necessary to make room
   */
  set(key: string, value: V, ttl?: number): void {
    const size = estimateSize(value);
    const effectiveTTL = ttl ?? this.defaultTTL;

    // If single item exceeds max size, don't cache it
    if (size > this.maxSize) {
      console.warn(
        `[LRUCache] Item size (${(size / 1024 / 1024).toFixed(2)}MB) exceeds max cache size (${(this.maxSize / 1024 / 1024).toFixed(2)}MB)`
      );
      return;
    }

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      this.currentSize -= existing.size;
      this.cache.delete(key);
    }

    // Evict entries until we have enough space
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.evictLRU();
    }

    // Add new entry
    const entry: CacheEntry<V> = {
      value,
      size,
      timestamp: Date.now(),
      ttl: effectiveTTL,
      expiresAt: effectiveTTL ? Date.now() + effectiveTTL : undefined,
    };

    this.cache.set(key, entry);
    this.currentSize += size;
  }

  /**
   * Check if a key exists in the cache (without updating access time)
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.currentSize -= entry.size;
    this.cache.delete(key);

    if (this.onEvict) {
      this.onEvict(key, entry.value, 'manual');
    }

    return true;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    if (this.onEvict) {
      this.cache.forEach((entry, key) => {
        this.onEvict!(key, entry.value, 'manual');
      });
    }
    this.cache.clear();
    this.currentSize = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    return {
      size: this.currentSize,
      maxSize: this.maxSize,
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      utilization: this.currentSize / this.maxSize,
    };
  }

  /**
   * Reset hit/miss statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get all keys in the cache (in LRU order, oldest first)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get current memory usage in bytes
   */
  get memoryUsage(): number {
    return this.currentSize;
  }

  /**
   * Get memory utilization as a percentage (0-100)
   */
  get utilization(): number {
    return (this.currentSize / this.maxSize) * 100;
  }

  /**
   * Peek at a value without updating access time
   */
  peek(key: string): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Update the TTL for an existing entry
   */
  updateTTL(key: string, ttl: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    entry.ttl = ttl;
    entry.expiresAt = Date.now() + ttl;
    return true;
  }

  /**
   * Cleanup expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (entry.expiresAt && now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    });

    for (const key of keysToDelete) {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentSize -= entry.size;
        this.cache.delete(key);

        if (this.onEvict) {
          this.onEvict(key, entry.value, 'ttl');
        }
      }
    }
  }

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): void {
    // First entry is the least recently used (Map maintains insertion order)
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey)!;
      this.currentSize -= entry.size;
      this.cache.delete(firstKey);

      if (this.onEvict) {
        this.onEvict(firstKey, entry.value, 'size');
      }
    }
  }

  /**
   * Destroy the cache and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

/**
 * Create a default LRU cache for diff data (100MB limit)
 */
export function createDiffCache(): LRUCache<unknown> {
  return new LRUCache({
    maxSize: 100 * 1024 * 1024, // 100MB
    defaultTTL: 30 * 60 * 1000, // 30 minutes
    onEvict: (key, _value, reason) => {
      console.debug(`[DiffCache] Evicted ${key} (${reason})`);
    },
  });
}

export default LRUCache;
