/**
 * SSL trust cache — realm matching & persistence.
 *
 * The cache remembers which certificate failures a user accepted for which
 * realm, then answers "do we already trust failures for this URL?". The realm
 * ancestor matching is security-sensitive: too loose and a trust granted for
 * one path silently covers another; too tight and the user is re-prompted
 * endlessly. These tests pin the matching rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mocked = {
    ...actual,
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({ app: { getPath: vi.fn().mockReturnValue('/test/user-data') } }));

vi.mock('@shared/utils/debug', () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { access, readFile } from 'node:fs/promises';
import { SslTrustCache } from '../ssl-trust-cache';

const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);

 beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing cache file on disk.
  mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockReadFile.mockResolvedValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SslTrustCache', () => {
  it('is empty and finds nothing before anything is trusted', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    expect(cache.findForUrl('https://svn.example.com/repo')).toBeNull();
  });

  it('returns the exact trust for the exact realm url', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/repo', 'ABCDEF');

    expect(cache.findForUrl('https://svn.example.com/repo')).toEqual({
      realm: 'https://svn.example.com/repo',
      failures: 'ABCDEF',
    });
  });

  it('matches a trust for an ancestor realm against a deeper url', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/repo', 'ABCDEF');

    expect(cache.findForUrl('https://svn.example.com/repo/trunk/file.ts')).toEqual({
      realm: 'https://svn.example.com/repo',
      failures: 'ABCDEF',
    });
  });

  it('does not cross origin boundaries when matching', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/repo', 'ABCDEF');

    expect(cache.findForUrl('https://svn.evil.com/repo')).toBeNull();
  });

  it('prefers the most specific (longest) ancestor realm', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/', 'ROOT-FAIL');
    cache.set('https://svn.example.com/repo', 'REPO-FAIL');

    expect(cache.findForUrl('https://svn.example.com/repo/trunk')).toEqual({
      realm: 'https://svn.example.com/repo',
      failures: 'REPO-FAIL',
    });
  });

  it('treats a root realm as matching every path on that origin', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/', 'ROOT-FAIL');

    expect(cache.findForUrl('https://svn.example.com/anything/here')).toEqual({
      realm: 'https://svn.example.com/',
      failures: 'ROOT-FAIL',
    });
  });

  it('normalizes a trailing slash on the realm when matching', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/repo/', 'ABCDEF');

    expect(cache.findForUrl('https://svn.example.com/repo')).toEqual({
      realm: 'https://svn.example.com/repo/',
      failures: 'ABCDEF',
    });
  });

  it('ignores empty realm or failure values', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('   ', 'ABCDEF');
    cache.set('https://svn.example.com/repo', '   ');

    expect(cache.findForUrl('https://svn.example.com/repo')).toBeNull();
  });

  it('persists and reloads trusted realms across instances', async () => {
    const stored = JSON.stringify({
      version: 1,
      trusts: [
        { realm: 'https://svn.example.com/repo', failures: 'ABCDEF', createdAt: 1 },
      ],
    });
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(stored);

    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    // A freshly constructed cache that loaded from disk still answers.
    expect(cache.findForUrl('https://svn.example.com/repo/trunk')).toEqual({
      realm: 'https://svn.example.com/repo',
      failures: 'ABCDEF',
    });
  });

  it('ignores a cache file with the wrong version', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 999, trusts: [] }));

    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    expect(cache.findForUrl('https://svn.example.com/repo')).toBeNull();
  });

  it('writes the cache to disk when a trust is added', async () => {
    const { writeFile } = await import('node:fs/promises');
    const mockWriteFile = vi.mocked(writeFile);

    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();
    cache.set('https://svn.example.com/repo', 'ABCDEF');
    // Allow the async save to flush.
    await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled());

    const payload = mockWriteFile.mock.calls[0][1] as string;
    expect(payload).toContain('ABCDEF');
    expect(payload).toContain('"version": 1');
  });
});
