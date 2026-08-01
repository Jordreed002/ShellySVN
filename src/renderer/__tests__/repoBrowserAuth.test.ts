import { describe, expect, it, vi } from 'vitest';
import {
  getRepoBrowserRealm,
  isRepoBrowserAuthError,
  loadRepoBrowserCredentials,
} from '../src/routes/repo-browser/-repoBrowserAuth';

describe('repo browser authentication helpers', () => {
  it.each([
    ['http://svn.example.com/repo/trunk', 'http://svn.example.com'],
    ['https://svn.example.com/repo/trunk', 'https://svn.example.com'],
    ['svn://svn.example.com/repo/trunk', 'svn://svn.example.com'],
    ['svn+ssh://svn.example.com/repo/trunk', 'svn+ssh://svn.example.com'],
  ])('derives a host realm for %s', (url, realm) => {
    expect(getRepoBrowserRealm(url)).toBe(realm);
  });

  it('returns null credentials for anonymous repository browsing', async () => {
    const authApi = { resumeSession: vi.fn().mockResolvedValue(null) };

    const result = await loadRepoBrowserCredentials('https://svn.example.com/repo', authApi);

    expect(authApi.resumeSession).toHaveBeenCalledWith('https://svn.example.com');
    expect(result).toEqual({
      realm: 'https://svn.example.com',
      credentials: null,
    });
  });

  it('loads an opaque credential session by repository realm', async () => {
    const session = {
      id: 'session-1',
      realm: 'https://svn.example.com',
      username: 'alice',
      persistent: true,
      expiresAt: null,
    };
    const authApi = {
      resumeSession: vi.fn().mockResolvedValue(session),
    };

    const result = await loadRepoBrowserCredentials('https://svn.example.com/repo', authApi);

    expect(result).toEqual({
      realm: 'https://svn.example.com',
      credentials: session,
    });
  });

  it('loads cached credentials for svn+ssh repositories by host realm', async () => {
    const authApi = {
      resumeSession: vi.fn().mockResolvedValue({
        id: 'session-ssh',
        realm: 'svn+ssh://svn.example.com',
        username: 'deploy',
        persistent: true,
        expiresAt: null,
      }),
    };

    const result = await loadRepoBrowserCredentials('svn+ssh://svn.example.com/repo', authApi);

    expect(authApi.resumeSession).toHaveBeenCalledWith('svn+ssh://svn.example.com');
    expect(result.credentials).toMatchObject({ id: 'session-ssh', username: 'deploy' });
    expect(result.credentials).not.toHaveProperty('password');
  });

  it.each([
    new Error('E215004: Authentication failed'),
    new Error('No credentials are available'),
    new Error('authorization failed'),
  ])('classifies SVN auth challenges: %s', (error) => {
    expect(isRepoBrowserAuthError(error)).toBe(true);
  });

  it('does not classify generic SSL trust failures as credential prompts', () => {
    expect(isRepoBrowserAuthError(new Error('certificate verify failed'))).toBe(false);
  });
});
