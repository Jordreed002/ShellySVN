import { describe, expect, it, vi } from 'vitest';

import { invalidateAfterSvnMutation } from '../mutationInvalidation';

describe('SVN mutation query invalidation', () => {
  it('uses one authoritative invalidation for repository source and destination views', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateAfterSvnMutation({ invalidateQueries } as never, {
      localPaths: [],
      repositoryUrls: [
        'https://svn.example/repo/trunk/source',
        'https://svn.example/repo/branches/destination',
      ],
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const predicate = invalidateQueries.mock.calls[0][0].predicate;
    for (const scope of [
      'repo-browser',
      'repo:list',
      'branches',
      'svn:list',
      'svn:info',
      'svn:log',
    ]) {
      expect(predicate({ queryKey: [scope] })).toBe(true);
    }
    expect(predicate({ queryKey: ['auth'] })).toBe(false);
  });

  it('invalidates working-copy status, info, log, and sidebar views in one pass', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateAfterSvnMutation({ invalidateQueries } as never, {
      localPaths: ['/repo/src'],
      repositoryUrls: [],
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const predicate = invalidateQueries.mock.calls[0][0].predicate;
    expect(predicate({ queryKey: ['fs:getStatus', '/repo'] })).toBe(true);
    expect(predicate({ queryKey: ['svn:info', '/repo'] })).toBe(true);
    expect(predicate({ queryKey: ['sidebar:status', '/repo'] })).toBe(true);
    expect(predicate({ queryKey: ['diagnostics', '/repo'] })).toBe(true);
    expect(predicate({ queryKey: ['repo-browser'] })).toBe(false);
  });
});
