import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnLogEntry, SvnLogResult } from '@shared/types';

import { useCachedLog, useLogCache } from '../useLogCache';

const LOG_CACHE_KEY = 'shellysvn:log-cache';

type LogCacheStore = Record<
  string,
  {
    path: string;
    data: SvnLogResult;
    cachedAt: number;
    revision: number;
  }
>;

const storeApi = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const svnApi = {
  log: vi.fn(),
};

let store: LogCacheStore;

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

describe('useLogCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = {};
    storeApi.get.mockImplementation(async () => store);
    storeApi.set.mockImplementation(async (_key: string, value: LogCacheStore) => {
      store = value;
    });
    storeApi.delete.mockImplementation(async () => {
      store = {};
    });
    svnApi.log.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

    window.api = {
      store: storeApi,
      svn: svnApi,
    } as unknown as Window['api'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and reports large cached log histories without truncating entries', async () => {
    const largeLog = makeLog(1000, 2000);
    store['C:/repo'] = {
      path: 'C:/repo',
      data: largeLog,
      cachedAt: Date.now(),
      revision: 2000,
    };

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

  it('invalidates expired cached histories', async () => {
    store['C:/repo'] = {
      path: 'C:/repo',
      data: makeLog(5),
      cachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      revision: 1000,
    };

    const { result } = renderHook(() => useLogCache('C:/repo'));

    await waitFor(() => {
      expect(storeApi.set).toHaveBeenCalledWith(LOG_CACHE_KEY, {});
    });

    expect(result.current.hasCachedData).toBe(false);
    expect(store['C:/repo']).toBeUndefined();
  });

  it('falls back to cached history when refresh fails offline', async () => {
    const cachedLog = makeLog(25, 500);
    store['C:/repo'] = {
      path: 'C:/repo',
      data: cachedLog,
      cachedAt: Date.now(),
      revision: 500,
    };
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
    expect(store['C:/repo']).toBeUndefined();
    expect(store['C:/repo::merge-history']).toMatchObject({
      path: 'C:/repo',
      revision: 700,
    });
  });

  it('supports manual cache clearing for one path and all paths', async () => {
    store['C:/repo'] = {
      path: 'C:/repo',
      data: makeLog(3),
      cachedAt: Date.now(),
      revision: 1000,
    };
    store['C:/other'] = {
      path: 'C:/other',
      data: makeLog(2, 900),
      cachedAt: Date.now(),
      revision: 900,
    };

    const { result } = renderHook(() => useLogCache('C:/repo'));

    await waitFor(() => {
      expect(result.current.hasCachedData).toBe(true);
    });

    await act(async () => {
      await result.current.clearCache();
    });

    expect(store['C:/repo']).toBeUndefined();
    expect(store['C:/other']).toBeDefined();
    expect(result.current.hasCachedData).toBe(false);

    await act(async () => {
      await result.current.clearAllCaches();
    });

    expect(storeApi.delete).toHaveBeenCalledWith(LOG_CACHE_KEY);
    expect(store).toEqual({});
  });
});
