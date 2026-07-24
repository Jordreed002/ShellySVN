import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnCacheEntry, SvnLogEntry, SvnLogResult } from '@shared/types';

import { buildLogCacheScope, useCachedLog, useLogCache } from '../useLogCache';

interface CachedLog {
  path: string;
  data: SvnLogResult;
  cachedAt: number;
  revision: number;
}

const cacheApi = {
  get: vi.fn(),
  list: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  clearNamespace: vi.fn(),
  clearPath: vi.fn(),
  clearAll: vi.fn(),
  stats: vi.fn(),
};

const svnApi = {
  log: vi.fn(),
};

let cache: Map<string, CachedLog>;

function asEntry(key: string, cached: CachedLog): SvnCacheEntry<SvnLogResult> {
  return {
    namespace: 'log',
    key,
    path: cached.path,
    data: cached.data,
    cachedAt: cached.cachedAt,
    expiresAt: cached.cachedAt + 7 * 24 * 60 * 60 * 1000,
    lastAccessedAt: cached.cachedAt,
    sizeBytes: 1,
  };
}

function makeLog(count: number, startRevision = 1000): SvnLogResult {
  const entries: SvnLogEntry[] = Array.from({ length: count }, (_, index) => ({
    revision: startRevision - index,
    author: index % 2 === 0 ? 'alice' : 'bob',
    date: '2026-04-25T10:00:00.000Z',
    message: `Change ${startRevision - index}`,
    paths: [{ action: 'M', path: `/trunk/src/file-${index}.ts` }],
  }));

  return {
    entries,
    startRevision: entries.at(-1)?.revision ?? 0,
    endRevision: entries[0]?.revision ?? 0,
  };
}

function logCacheKey(path: string, limit: number, useMergeHistory = false): string {
  return `${path}::${buildLogCacheScope(limit, useMergeHistory, {})}`;
}

describe('useLogCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache = new Map();
    cacheApi.get.mockImplementation(async (_namespace: string, key: string) => {
      const cached = cache.get(key);
      return cached ? asEntry(key, cached) : null;
    });
    cacheApi.set.mockImplementation(
      async (
        _namespace: string,
        key: string,
        path: string,
        value: SvnLogResult,
        _ttl: number,
        operationStartedAt: number
      ) => {
        cache.set(key, {
          path,
          data: value,
          cachedAt: operationStartedAt,
          revision: value.entries[0]?.revision ?? 0,
        });
        return { success: true };
      }
    );
    cacheApi.clearPath.mockImplementation(async (path: string) => {
      for (const [key, value] of cache) {
        if (value.path === path) cache.delete(key);
      }
    });
    cacheApi.clearNamespace.mockImplementation(async () => {
      cache.clear();
    });
    svnApi.log.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

    window.api = {
      svnCache: cacheApi,
      svn: svnApi,
    } as unknown as Window['api'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and reports large cached log histories without truncating entries', async () => {
    const largeLog = makeLog(1000, 2000);
    cache.set('C:/repo', {
      path: 'C:/repo',
      data: largeLog,
      cachedAt: Date.now(),
      revision: 2000,
    });

    const { result } = renderHook(() => useLogCache('C:/repo'));

    await waitFor(() => {
      expect(result.current.hasCachedData).toBe(true);
    });

    expect(result.current.cachedEntries).toHaveLength(1000);
    expect(result.current.cacheInfo).toMatchObject({
      revision: 2000,
      entryCount: 1000,
    });
  });

  it('treats an expired service result as a cache miss', async () => {
    cacheApi.get.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useLogCache('C:/repo'));

    await waitFor(() => expect(cacheApi.get).toHaveBeenCalledWith('log', 'C:/repo'));
    expect(result.current.hasCachedData).toBe(false);
  });

  it('falls back to cached history when refresh fails offline', async () => {
    const cachedLog = makeLog(25, 500);
    cache.set(logCacheKey('C:/repo', 200), {
      path: 'C:/repo',
      data: cachedLog,
      cachedAt: Date.now(),
      revision: 500,
    });
    svnApi.log.mockRejectedValue(new Error('network unavailable'));
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useCachedLog('C:/repo', 200));

    await waitFor(() => {
      expect(result.current.hasCachedData).toBe(true);
    });

    let refreshed: SvnLogResult | null = null;
    await act(async () => {
      refreshed = await result.current.refreshLog();
    });

    expect(svnApi.log).toHaveBeenCalledWith('C:/repo', 200, undefined, undefined, false);
    expect(refreshed).toBe(cachedLog);
    expect(result.current.isOffline).toBe(true);
  });

  it('keeps merge-tracking history in a separate cache entry', async () => {
    svnApi.log.mockResolvedValue(makeLog(2, 700));

    const { result } = renderHook(() => useCachedLog('C:/repo', 200, true));

    await act(async () => {
      await result.current.refreshLog();
    });

    expect(svnApi.log).toHaveBeenCalledWith('C:/repo', 200, undefined, undefined, true);
    expect(cache.get('C:/repo')).toBeUndefined();
    expect(cache.get(logCacheKey('C:/repo', 200, true))).toMatchObject({
      path: 'C:/repo',
      revision: 700,
    });
  });

  it('keeps different result limits in separate cache entries', async () => {
    svnApi.log.mockResolvedValueOnce(makeLog(25, 700)).mockResolvedValueOnce(makeLog(200, 800));

    const first = renderHook(() => useCachedLog('C:/repo', 25));
    await act(async () => {
      await first.result.current.refreshLog();
    });
    first.unmount();

    const second = renderHook(() => useCachedLog('C:/repo', 200));
    await act(async () => {
      await second.result.current.refreshLog();
    });

    expect(cache.get(logCacheKey('C:/repo', 25))?.data.entries).toHaveLength(25);
    expect(cache.get(logCacheKey('C:/repo', 200))?.data.entries).toHaveLength(200);
  });

  it('ignores a delayed cache load after the requested path changes', async () => {
    let resolveFirst: ((value: SvnCacheEntry<SvnLogResult> | null) => void) | undefined;
    cacheApi.get
      .mockReturnValueOnce(
        new Promise<SvnCacheEntry<SvnLogResult> | null>((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValueOnce(
        asEntry('C:/new', {
          path: 'C:/new',
          data: makeLog(2, 900),
          cachedAt: Date.now(),
          revision: 900,
        })
      );

    const { result, rerender } = renderHook(({ path }) => useLogCache(path), {
      initialProps: { path: 'C:/old' },
    });
    rerender({ path: 'C:/new' });

    await waitFor(() => expect(result.current.cacheInfo?.revision).toBe(900));
    resolveFirst?.(
      asEntry('C:/old', {
        path: 'C:/old',
        data: makeLog(3, 100),
        cachedAt: Date.now(),
        revision: 100,
      })
    );
    await act(async () => Promise.resolve());

    expect(result.current.cacheInfo?.revision).toBe(900);
  });

  it.each([
    [
      'structured command failure',
      {
        entries: [],
        startRevision: 0,
        endRevision: 0,
        error: 'svn: E170013: Unable to connect',
        errorCode: 'E170013',
      },
      'svn: E170013: Unable to connect',
    ],
    [
      'XML parse failure',
      {
        entries: [],
        startRevision: 0,
        endRevision: 0,
        parseError: 'Unexpected closing tag',
      },
      'Failed to parse SVN log: Unexpected closing tag',
    ],
    [
      'cancellation',
      {
        entries: [],
        startRevision: 0,
        endRevision: 0,
        cancelled: true,
      },
      'Log request was cancelled',
    ],
  ])('does not cache an empty-looking %s', async (_label, response, expectedMessage) => {
    svnApi.log.mockResolvedValue(response);
    const { result } = renderHook(() => useCachedLog('C:/repo', 50));

    await expect(
      act(async () => {
        await result.current.refreshLog();
      })
    ).rejects.toThrow(expectedMessage);
    expect(cache.get('C:/repo')).toBeUndefined();
  });

  it('supports manual cache clearing for one path and all paths', async () => {
    cache.set('C:/repo', {
      path: 'C:/repo',
      data: makeLog(3),
      cachedAt: Date.now(),
      revision: 1000,
    });
    cache.set('C:/other', {
      path: 'C:/other',
      data: makeLog(2, 900),
      cachedAt: Date.now(),
      revision: 900,
    });

    const { result } = renderHook(() => useLogCache('C:/repo'));

    await waitFor(() => {
      expect(result.current.hasCachedData).toBe(true);
    });

    await act(async () => {
      await result.current.clearCache();
    });

    expect(cache.get('C:/repo')).toBeUndefined();
    expect(cache.get('C:/other')).toBeDefined();
    expect(result.current.hasCachedData).toBe(false);

    await act(async () => {
      await result.current.clearAllCaches();
    });

    expect(cacheApi.clearNamespace).toHaveBeenCalledWith('log', Date.now());
    expect(cache.size).toBe(0);
  });

  it('drops the visible log when application cache clearing completes', async () => {
    cache.set('C:/repo', {
      path: 'C:/repo',
      data: makeLog(3),
      cachedAt: Date.now(),
      revision: 1000,
    });
    const { result } = renderHook(() => useLogCache('C:/repo'));
    await waitFor(() => expect(result.current.hasCachedData).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent('svn-cache-cleared'));
    });

    expect(result.current.hasCachedData).toBe(false);
  });
});
