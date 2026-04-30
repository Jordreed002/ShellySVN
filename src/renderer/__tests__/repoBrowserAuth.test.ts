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
    const authApi = { get: vi.fn().mockResolvedValue(null) };

    const result = await loadRepoBrowserCredentials('https://svn.example.com/repo', authApi);

    expect(authApi.get).toHaveBeenCalledWith('https://svn.example.com');
    expect(result).toEqual({
      realm: 'https://svn.example.com',
      credentials: null,
    });
  });

  it('loads cached username and password credentials by repository realm', async () => {
    const authApi = {
      get: vi.fn().mockResolvedValue({ username: 'alice', password: 'secret' }),
    };

    const result = await loadRepoBrowserCredentials('https://svn.example.com/repo', authApi);

    expect(result).toEqual({
      realm: 'https://svn.example.com',
      credentials: { username: 'alice', password: 'secret' },
    });
  });

  it('loads cached credentials for svn+ssh repositories by host realm', async () => {
    const authApi = {
      get: vi.fn().mockResolvedValue({ username: 'deploy', password: 'ssh-secret' }),
    };

    const result = await loadRepoBrowserCredentials('svn+ssh://svn.example.com/repo', authApi);

    expect(authApi.get).toHaveBeenCalledWith('svn+ssh://svn.example.com');
    expect(result.credentials).toEqual({ username: 'deploy', password: 'ssh-secret' });
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
