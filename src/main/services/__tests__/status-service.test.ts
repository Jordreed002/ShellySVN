import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEEP_STATUS_CACHE_TTL_MS, StatusService } from '../status-service';

function statusResult(path: string) {
  return {
    directStatus: {},
    allEntries: [{ status: 'M' as const, fullPath: `${path}/file.txt` }],
  };
}

describe('StatusService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches and returns deep status results', () => {
    const service = new StatusService();
    const result = statusResult('/repo');

    service.setDeepStatus('/repo', result);

    expect(service.getDeepStatus('/repo')).toBe(result);
    expect(service.getStateForTests()).toMatchObject({
      deepStatusCacheSize: 1,
      cachedPaths: ['/repo'],
    });
  });

  it('invalidates overlapping cached paths', () => {
    const service = new StatusService();
    service.setDeepStatus('/repo', statusResult('/repo'));
    service.setDeepStatus('/repo/src', statusResult('/repo/src'));
    service.setDeepStatus('/other', statusResult('/other'));

    service.invalidatePath('/repo/src/file.txt');

    expect(service.getDeepStatus('/repo')).toBeNull();
    expect(service.getDeepStatus('/repo/src')).toBeNull();
    expect(service.getDeepStatus('/other')).not.toBeNull();
  });

  it('does not invalidate sibling paths with common prefixes', () => {
    const service = new StatusService();
    service.setDeepStatus('/repo', statusResult('/repo'));
    service.setDeepStatus('/repo2', statusResult('/repo2'));

    service.invalidatePath('/repo/src/file.txt');

    expect(service.getDeepStatus('/repo')).toBeNull();
    expect(service.getDeepStatus('/repo2')).not.toBeNull();
  });

  it('normalizes cache lookup paths', () => {
    const service = new StatusService();
    const result = statusResult('/repo');

    service.setDeepStatus('/repo/', result);

    expect(service.getDeepStatus('/repo')).toBe(result);
  });

  it('expires deep status entries after the cache TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T00:00:00Z'));

    const service = new StatusService();
    service.setDeepStatus('/repo', statusResult('/repo'));

    vi.setSystemTime(new Date(Date.now() + DEEP_STATUS_CACHE_TTL_MS + 1));

    expect(service.getDeepStatus('/repo')).toBeNull();
    expect(service.getStateForTests()).toMatchObject({ deepStatusCacheSize: 0 });
  });

  it('evicts least recently used deep status entries when bounded', () => {
    const service = new StatusService(2);
    const repoA = statusResult('/repo-a');
    const repoB = statusResult('/repo-b');
    const repoC = statusResult('/repo-c');

    service.setDeepStatus('/repo-a', repoA);
    service.setDeepStatus('/repo-b', repoB);
    expect(service.getDeepStatus('/repo-a')).toBe(repoA);
    service.setDeepStatus('/repo-c', repoC);

    expect(service.getDeepStatus('/repo-a')).toBe(repoA);
    expect(service.getDeepStatus('/repo-b')).toBeNull();
    expect(service.getDeepStatus('/repo-c')).toBe(repoC);
    expect(service.getStateForTests()).toMatchObject({
      deepStatusCacheSize: 2,
      cachedPaths: ['/repo-a', '/repo-c'],
    });
  });
});

/*
 * Windows path-key normalization. The status cache is keyed by a normalized
 * path: on win32, backslashes collapse to '/' and the whole key is lowercased
 * (Windows filesystems are case-insensitive). Without that, a status cached
 * under 'C:\Repo' would be missed by a lookup for 'c:\repo' or 'C:/Repo'.
 */
describe('StatusService — Windows path normalization', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  it('treats drive-letter case and separator style as equivalent', () => {
    const service = new StatusService();
    const result = statusResult('C:\\Repo');

    service.setDeepStatus('C:\\Repo', result);

    expect(service.getDeepStatus('c:\\repo')).toBe(result);
    expect(service.getDeepStatus('C:/Repo')).toBe(result);
    // Trailing separators are stripped before keying.
    expect(service.getDeepStatus('c:/repo/')).toBe(result);
  });

  it('stores a single entry for case/separator variants of the same path', () => {
    const service = new StatusService();
    service.setDeepStatus('C:\\Repo', statusResult('C:\\Repo'));
    service.setDeepStatus('c:/repo', statusResult('c:/repo'));

    expect(service.getStateForTests()).toMatchObject({ deepStatusCacheSize: 1 });
  });

  it('invalidates case-insensitively across separators', () => {
    const service = new StatusService();
    service.setDeepStatus('C:\\Repo', statusResult('C:\\Repo'));

    service.invalidatePath('c:/repo/src/file.txt');

    expect(service.getDeepStatus('C:\\Repo')).toBeNull();
  });
});

describe('StatusService — POSIX path-key normalization (platform boundary)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  it('is case-sensitive on POSIX (no lowercasing)', () => {
    const service = new StatusService();
    const result = statusResult('/Repo');

    service.setDeepStatus('/Repo', result);

    expect(service.getDeepStatus('/Repo')).toBe(result);
    expect(service.getDeepStatus('/repo')).toBeNull();
  });
});
