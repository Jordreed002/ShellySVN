import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SvnCacheEntry, SvnCacheNamespace, SvnCacheStats, SvnInfoResult } from '@shared/types';

import { resetOfflineCacheForTests, useOfflineCache } from '../useOfflineCache';

const namespaces: SvnCacheNamespace[] = ['info', 'status', 'log', 'entries'];
let persisted: Record<SvnCacheNamespace, Map<string, SvnCacheEntry>>;

function stats(): SvnCacheStats {
  return {
    infoCount: persisted.info.size,
    statusCount: persisted.status.size,
    logCount: persisted.log.size,
    entriesCount: persisted.entries.size,
    totalSize: [...namespaces].reduce(
      (total, namespace) =>
        total +
        [...persisted[namespace].values()].reduce(
          (namespaceTotal, entry) => namespaceTotal + entry.sizeBytes,
          0
        ),
      0
    ),
    logSize: [...persisted.log.values()].reduce((total, entry) => total + entry.sizeBytes, 0),
    offlineSize: [...namespaces]
      .filter((namespace) => namespace !== 'log')
      .reduce(
        (total, namespace) =>
          total +
          [...persisted[namespace].values()].reduce(
            (namespaceTotal, entry) => namespaceTotal + entry.sizeBytes,
            0
          ),
        0
      ),
    logBudgetBytes: 100 * 1024 * 1024,
    offlineBudgetBytes: 50 * 1024 * 1024,
    filePath: '/cache/svn-cache-v2.json',
  };
}

const cacheApi = {
  list: vi.fn(async (namespace: SvnCacheNamespace) => [...persisted[namespace].values()]),
  stats: vi.fn(async () => stats()),
  set: vi.fn(
    async (
      namespace: SvnCacheNamespace,
      key: string,
      path: string,
      data: unknown,
      ttlMs: number,
      operationStartedAt: number
    ) => {
      persisted[namespace].set(key, {
        namespace,
        key,
        path,
        data,
        cachedAt: operationStartedAt,
        expiresAt: operationStartedAt + ttlMs,
        lastAccessedAt: operationStartedAt,
        sizeBytes: 123,
      });
      return { success: true };
    }
  ),
  clearAll: vi.fn(async () => {
    for (const namespace of namespaces) persisted[namespace].clear();
  }),
  clearPath: vi.fn(async (path: string) => {
    for (const namespace of namespaces) {
      for (const [key, entry] of persisted[namespace]) {
        if (
          entry.path === path ||
          entry.path.startsWith(`${path}/`) ||
          path.startsWith(`${entry.path}/`)
        ) {
          persisted[namespace].delete(key);
        }
      }
    }
  }),
  get: vi.fn(),
  delete: vi.fn(),
  clearNamespace: vi.fn(),
};

const info: SvnInfoResult = {
  path: '/repo',
  url: 'https://svn.example/repo',
  repositoryRoot: 'https://svn.example',
  repositoryUuid: 'uuid',
  revision: 10,
  nodeKind: 'dir',
  lastChangedAuthor: 'alice',
  lastChangedRevision: 10,
  lastChangedDate: '2026-07-24T10:00:00.000Z',
};

describe('useOfflineCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOfflineCacheForTests();
    persisted = {
      info: new Map(),
      status: new Map(),
      log: new Map(),
      entries: new Map(),
    };
    window.api = { svnCache: cacheApi } as unknown as Window['api'];
  });

  afterEach(() => {
    resetOfflineCacheForTests();
  });

  it('shares inserts and exact statistics between simultaneous consumers', async () => {
    const first = renderHook(() => useOfflineCache());
    const second = renderHook(() => useOfflineCache());

    await waitFor(() => {
      expect(first.result.current.isInitialized).toBe(true);
      expect(second.result.current.isInitialized).toBe(true);
    });

    await act(async () => {
      await first.result.current.setInfo('/repo', info);
    });

    expect(second.result.current.getInfo('/repo')).toEqual(info);
    expect(second.result.current.getStats()).toMatchObject({
      infoCount: 1,
      totalSize: 123,
      formattedSize: '123 B',
      isEstimated: false,
    });
  });

  it('makes path and global clears immediately visible to every consumer', async () => {
    const first = renderHook(() => useOfflineCache());
    const second = renderHook(() => useOfflineCache());
    await waitFor(() => expect(first.result.current.isInitialized).toBe(true));

    await act(async () => {
      await first.result.current.setInfo('/repo', info);
      await first.result.current.setInfo('/other', { ...info, path: '/other' });
      await second.result.current.clearPath('/repo');
    });

    expect(first.result.current.getInfo('/repo')).toBeNull();
    expect(first.result.current.getInfo('/other')).not.toBeNull();

    await act(async () => {
      await first.result.current.clearAll();
    });
    expect(second.result.current.getInfo('/other')).toBeNull();
    expect(second.result.current.getStats().totalSize).toBe(0);
  });

  it('does not restore stale hydration results after a clear', async () => {
    let resolveOldInfo: ((entries: Array<SvnCacheEntry<unknown>>) => void) | undefined;
    const oldEntry: SvnCacheEntry<SvnInfoResult> = {
      namespace: 'info',
      key: '/repo',
      path: '/repo',
      data: info,
      cachedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      lastAccessedAt: Date.now(),
      sizeBytes: 123,
    };
    cacheApi.list.mockImplementationOnce(
      () =>
        new Promise<Array<SvnCacheEntry<unknown>>>((resolve) => {
          resolveOldInfo = resolve;
        })
    );

    const cache = renderHook(() => useOfflineCache());
    await act(async () => {
      await cache.result.current.clearAll();
    });
    resolveOldInfo?.([oldEntry]);
    await act(async () => Promise.resolve());

    expect(cache.result.current.getInfo('/repo')).toBeNull();
  });

  it('drops active renderer state when application cache clearing completes', async () => {
    const cache = renderHook(() => useOfflineCache());
    await waitFor(() => expect(cache.result.current.isInitialized).toBe(true));
    await act(async () => {
      await cache.result.current.setInfo('/repo', info);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('svn-cache-cleared'));
    });

    expect(cache.result.current.getInfo('/repo')).toBeNull();
    expect(cache.result.current.getStats().totalSize).toBe(0);
  });
});
