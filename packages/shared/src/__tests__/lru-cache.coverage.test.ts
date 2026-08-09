/**
 * Coverage for lru-cache branches the base suite does not reach: the exotic
 * estimateSize value types, the interval-driven TTL sweep (cleanupExpired) with
 * its 'ttl' evict reason, clear() while an onEvict is attached, peek() expiry,
 * and createDiffCache's eviction log line.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { LRUCache, createDiffCache } from '../utils/lru-cache';
import { CACHE_CLEANUP_INTERVAL_MS } from '../constants';

describe('LRUCache — estimateSize value-type branches', () => {
  let cache: LRUCache<unknown>;

  beforeEach(() => {
    cache = new LRUCache({ maxSize: 1000 });
  });
  afterEach(() => cache.destroy());

  it('sizes primitives (boolean, number, null, undefined) without throwing', () => {
    expect(() => cache.set('b', true)).not.toThrow();
    expect(() => cache.set('n', 42)).not.toThrow();
    expect(() => cache.set('null', null)).not.toThrow();
    expect(() => cache.set('undef', undefined)).not.toThrow();

    expect(cache.get('b')).toBe(true);
    expect(cache.get('n')).toBe(42);
    expect(cache.get('null')).toBeNull();
    expect(cache.get('undef')).toBeUndefined();
  });

  it('sizes Map, Set, Date, and typed-array (ArrayBufferView) values', () => {
    cache.set(
      'map',
      new Map([
        ['a', 1],
        ['b', 2],
      ])
    );
    cache.set('set', new Set([1, 2, 3]));
    cache.set('date', new Date(0));
    cache.set('view', new Int32Array([1, 2, 3, 4]));

    expect(cache.get('map')).toBeInstanceOf(Map);
    expect(cache.get('set')).toBeInstanceOf(Set);
    expect(cache.get('date')).toBeInstanceOf(Date);
    expect(cache.get('view')).toBeInstanceOf(Int32Array);
  });

  it('falls back to the default size for functions and symbols', () => {
    cache.set('fn', () => 1);
    cache.set('sym', Symbol('s'));

    expect(typeof cache.get('fn')).toBe('function');
    expect(typeof cache.get('sym')).toBe('symbol');
  });
});

describe('LRUCache — clear() invokes onEvict per entry', () => {
  it('calls onEvict with the manual reason for each entry on clear', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache({ maxSize: 1000, onEvict });

    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();

    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(onEvict).toHaveBeenCalledWith('a', '1', 'manual');
    expect(onEvict).toHaveBeenCalledWith('b', '2', 'manual');
    cache.destroy();
  });
});

describe('LRUCache — peek() respects expiry', () => {
  it('returns undefined and deletes an expired entry on peek', async () => {
    const cache = new LRUCache({ maxSize: 1000, defaultTTL: 50 });

    cache.set('k', 'v');
    expect(cache.peek('k')).toBe('v');

    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(cache.peek('k')).toBeUndefined();
    expect(cache.has('k')).toBe(false);
    cache.destroy();
  });
});

describe('LRUCache — interval-driven TTL cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts expired entries via the periodic sweep with the ttl reason', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache({ maxSize: 1000, defaultTTL: 50, onEvict });

    cache.set('k', 'v');

    // Advance past the entry TTL and the cleanup interval so the periodic
    // sweep (not an inline get/has check) removes it.
    vi.advanceTimersByTime(CACHE_CLEANUP_INTERVAL_MS + 100);

    expect(onEvict).toHaveBeenCalledWith('k', 'v', 'ttl');
    expect(cache.has('k')).toBe(false);
    cache.destroy();
  });
});

describe('createDiffCache — eviction logging', () => {
  it('logs through onEvict when a diff-cache entry is removed', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const cache = createDiffCache();

    cache.set('diff-1', { files: [] });
    cache.delete('diff-1');

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('[DiffCache] Evicted diff-1'));
    cache.destroy();
    debug.mockRestore();
  });
});
