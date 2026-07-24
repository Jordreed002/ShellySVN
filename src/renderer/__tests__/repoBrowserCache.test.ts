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

  it('uses a stable non-secret session identity for authenticated query keys', () => {
    const credentials = { username: 'deploy', password: 'secret' };
    const first = getRepoBrowserListQueryKey(
      'svn+ssh://svn.example.com/repo/trunk',
      'HEAD',
      credentials
    );
    const second = getRepoBrowserListQueryKey(
      'svn+ssh://svn.example.com/repo/trunk',
      'HEAD',
      credentials
    );

    expect(first).toEqual(second);
    expect(first[3]).toEqual({ username: 'deploy', session: expect.any(Number) });
    expect(JSON.stringify(first)).not.toContain('secret');
  });

  it('changes the query identity when credentials are replaced', () => {
    const first = getRepoBrowserListQueryKey('https://svn.example.com/repo', 'HEAD', {
      username: 'deploy',
      password: 'first',
    });
    const replacement = getRepoBrowserListQueryKey('https://svn.example.com/repo', 'HEAD', {
      username: 'deploy',
      password: 'second',
    });

    expect(first[3]).not.toEqual(replacement[3]);
  });

  it('keeps prefetched repository lists warm for one minute', () => {
    expect(REPO_BROWSER_LIST_STALE_TIME_MS).toBe(60_000);
  });
});
