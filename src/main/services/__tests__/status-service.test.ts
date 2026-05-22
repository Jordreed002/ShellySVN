import { describe, expect, it } from 'vitest';

import { StatusService } from '../status-service';

function statusResult(path: string) {
  return {
    directStatus: {},
    allEntries: [{ status: 'M' as const, fullPath: `${path}/file.txt` }],
  };
}

describe('StatusService', () => {
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
});
