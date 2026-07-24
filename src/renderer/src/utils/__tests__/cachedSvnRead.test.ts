import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SvnCacheEntry, SvnInfoResult, SvnStatusResult } from '@shared/types';

import { getListCacheKey, readCachedInfo, readCachedStatus } from '../cachedSvnRead';

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

const status: SvnStatusResult = {
  path: '/repo',
  entries: [],
  revision: 10,
};

const cacheApi = {
  get: vi.fn(),
  set: vi.fn(),
};

describe('persistent cached SVN reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheApi.set.mockResolvedValue({ success: true });
    cacheApi.get.mockResolvedValue(null);
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    window.api = { svnCache: cacheApi } as unknown as Window['api'];
  });

  it('populates the cache after a successful validated online read', async () => {
    await expect(readCachedStatus('/repo', async () => status)).resolves.toEqual({
      data: status,
      source: 'network',
      cachedAt: 2_000,
      age: 0,
    });
    expect(cacheApi.set).toHaveBeenCalledWith(
      'status',
      '/repo',
      '/repo',
      status,
      expect.any(Number),
      2_000
    );
  });

  it('returns an explicitly labelled cached result when the online read fails', async () => {
    const entry: SvnCacheEntry<SvnInfoResult> = {
      namespace: 'info',
      key: '/repo',
      path: '/repo',
      data: info,
      cachedAt: 1_500,
      expiresAt: 10_000,
      lastAccessedAt: 1_500,
      sizeBytes: 123,
    };
    cacheApi.get.mockResolvedValue(entry);

    await expect(
      readCachedInfo('/repo', async () => {
        throw new Error('network unavailable');
      })
    ).resolves.toEqual({
      data: info,
      source: 'cache',
      cachedAt: 1_500,
      age: 500,
    });
  });

  it('preserves the online error when no valid cached value exists', async () => {
    await expect(
      readCachedInfo('/repo', async () => {
        throw new Error('permission denied');
      })
    ).rejects.toThrow('permission denied');
  });

  it('does not cache failed status responses that resemble empty data', async () => {
    const failed = {
      ...status,
      error: 'svn: E170013: Unable to connect',
      errorCode: 'E170013',
    };

    await expect(readCachedStatus('/repo', async () => failed)).rejects.toThrow('svn: E170013');
    expect(cacheApi.set).not.toHaveBeenCalled();
  });

  it('builds stable list keys without including passwords', () => {
    const key = getListCacheKey('https://svn.example/repo/', 'HEAD', 'immediates', 'alice');
    expect(key).toBe(JSON.stringify(['https://svn.example/repo', 'HEAD', 'immediates', 'alice']));
    expect(key).not.toContain('secret');
  });
});
