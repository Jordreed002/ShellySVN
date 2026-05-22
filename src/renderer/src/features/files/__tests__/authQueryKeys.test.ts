import { describe, expect, it } from 'vitest';
import { createSvnListQueryKey, getAuthPresenceKey } from '../authQueryKeys';

describe('createSvnListQueryKey', () => {
  it('uses only non-secret credential state in SVN list query keys', () => {
    const authPresenceKey = getAuthPresenceKey({
      username: 'alice',
      password: 'secret-password',
    });
    const key = createSvnListQueryKey('remote', 'https://svn.example.test/repo', authPresenceKey);

    expect(key).toEqual(['svn:list:remote', 'https://svn.example.test/repo', 'stored']);
    expect(JSON.stringify(key)).not.toContain('alice');
    expect(JSON.stringify(key)).not.toContain('secret-password');
  });

  it('separates anonymous and credential-backed list results without exposing credentials', () => {
    expect(createSvnListQueryKey('online', 'https://svn.example.test/repo', 'anonymous')).toEqual([
      'svn:list:online',
      'https://svn.example.test/repo',
      'anonymous',
    ]);
  });
});
