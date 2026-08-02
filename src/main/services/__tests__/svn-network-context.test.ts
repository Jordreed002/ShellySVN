import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J11 / J14 — Network context resolution.
 *
 * `svn-network-context` is the glue that turns the auth + SSL-trust caches into
 * the options handed to every networked SVN call. Two properties matter: it
 * must only consult the SSL cache for https URLs, and a cache lookup failure
 * must never throw into the caller (it degrades to "no cached options" instead).
 */
const { authCache, sslCache } = vi.hoisted(() => ({
  authCache: { ready: vi.fn(), findForUrl: vi.fn() },
  sslCache: { ready: vi.fn(), findForUrl: vi.fn() },
}));

vi.mock('../../auth-cache', () => ({ getAuthCache: () => authCache }));
vi.mock('../../ssl-trust-cache', () => ({ getSslTrustCache: () => sslCache }));
vi.mock('../svn-working-copy', () => ({ getWorkingCopyContext: vi.fn() }));
vi.mock('../../utils/debug', () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getWorkingCopyContext } from '../svn-working-copy';
import {
  getCachedCredentialsForUrl,
  getCachedTrustedSslFailuresForUrl,
  getNetworkOptionsForUrl,
  getNetworkOptionsForWorkingCopyPath,
} from '../svn-network-context';

const mockGetWorkingCopyContext = vi.mocked(getWorkingCopyContext);

beforeEach(() => {
  vi.clearAllMocks();
  authCache.ready.mockResolvedValue(undefined);
  sslCache.ready.mockResolvedValue(undefined);
  authCache.findForUrl.mockReturnValue(null);
  sslCache.findForUrl.mockReturnValue(null);
  mockGetWorkingCopyContext.mockResolvedValue(undefined);
});

describe('getCachedCredentialsForUrl', () => {
  it('returns cached credentials when the auth cache has a match', async () => {
    authCache.findForUrl.mockReturnValue({ username: 'alice', password: 's3cr3t' });
    await expect(getCachedCredentialsForUrl('https://svn.example.com/repo')).resolves.toEqual({
      username: 'alice',
      password: 's3cr3t',
    });
  });

  it('returns undefined when there is no match', async () => {
    await expect(getCachedCredentialsForUrl('https://svn.example.com/repo')).resolves.toBeUndefined();
  });

  it('swallows cache errors and returns undefined', async () => {
    authCache.ready.mockRejectedValue(new Error('cache locked'));
    await expect(getCachedCredentialsForUrl('https://svn.example.com/repo')).resolves.toBeUndefined();
  });
});

describe('getCachedTrustedSslFailuresForUrl', () => {
  it('skips the SSL cache entirely for non-https URLs', async () => {
    await expect(getCachedTrustedSslFailuresForUrl('svn://svn.example.com/repo')).resolves.toBeUndefined();
    expect(sslCache.findForUrl).not.toHaveBeenCalled();
  });

  it('returns the trusted failures for an https URL with a match', async () => {
    sslCache.findForUrl.mockReturnValue({ realm: 'https://svn.example.com', failures: 'ABCDEF' });
    await expect(getCachedTrustedSslFailuresForUrl('https://svn.example.com/repo')).resolves.toBe(
      'ABCDEF'
    );
  });

  it('returns undefined when no trust is cached for the https URL', async () => {
    await expect(getCachedTrustedSslFailuresForUrl('https://svn.example.com/repo')).resolves.toBeUndefined();
  });
});

describe('getNetworkOptionsForUrl', () => {
  it('combines credentials and trusted SSL failures', async () => {
    authCache.findForUrl.mockReturnValue({ username: 'alice', password: 'p' });
    sslCache.findForUrl.mockReturnValue({ realm: 'https://svn.example.com', failures: 'FF' });

    await expect(getNetworkOptionsForUrl('https://svn.example.com/repo')).resolves.toEqual({
      credentials: { username: 'alice', password: 'p' },
      trustSslFailures: true,
      trustedSslFailures: 'FF',
    });
  });

  it('reports trustSslFailures=false when nothing is cached', async () => {
    await expect(getNetworkOptionsForUrl('https://svn.example.com/repo')).resolves.toEqual({
      credentials: undefined,
      trustSslFailures: false,
      trustedSslFailures: undefined,
    });
  });
});

describe('getNetworkOptionsForWorkingCopyPath', () => {
  it('delegates to the working copy URL when one is resolved', async () => {
    authCache.findForUrl.mockReturnValue({ username: 'alice', password: 'p' });
    mockGetWorkingCopyContext.mockResolvedValue({ url: 'https://svn.example.com/repo' });

    await expect(getNetworkOptionsForWorkingCopyPath('/wc')).resolves.toEqual({
      credentials: { username: 'alice', password: 'p' },
      trustSslFailures: false,
      trustedSslFailures: undefined,
    });
  });

  it('returns a no-trust default when the working copy has no URL', async () => {
    mockGetWorkingCopyContext.mockResolvedValue({ url: undefined });
    await expect(getNetworkOptionsForWorkingCopyPath('/wc')).resolves.toEqual({
      trustSslFailures: false,
    });
  });

  it('returns a no-trust default when context resolution throws', async () => {
    mockGetWorkingCopyContext.mockRejectedValue(new Error('not a working copy'));
    await expect(getNetworkOptionsForWorkingCopyPath('/wc')).resolves.toEqual({
      trustSslFailures: false,
    });
  });
});
