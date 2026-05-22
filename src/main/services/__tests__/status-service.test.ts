import { afterEach, describe, expect, it, vi } from 'vitest';

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
