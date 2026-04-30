import { describe, expect, it } from 'vitest';
import {
  getRepoBrowserListQueryKey,
  REPO_BROWSER_LIST_STALE_TIME_MS,
} from '../src/routes/repo-browser/-repoBrowserCache';

describe('repo browser cache helpers', () => {
  it('builds stable anonymous list query keys with URL and revision', () => {
    expect(getRepoBrowserListQueryKey('https://svn.example.com/repo/trunk', '123', null)).toEqual([
      'repo-browser',
      'https://svn.example.com/repo/trunk',
      '123',
      null,
    ]);
  });

  it('includes credentials in authenticated list query keys', () => {
    expect(
      getRepoBrowserListQueryKey('svn+ssh://svn.example.com/repo/trunk', 'HEAD', {
        username: 'deploy',
        password: 'secret',
      })
    ).toEqual([
      'repo-browser',
      'svn+ssh://svn.example.com/repo/trunk',
      'HEAD',
      { username: 'deploy', password: 'secret' },
    ]);
  });

  it('keeps prefetched repository lists warm for one minute', () => {
    expect(REPO_BROWSER_LIST_STALE_TIME_MS).toBe(60_000);
  });
});
