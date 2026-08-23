// @vitest-environment node
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
import {
  SslTrustCache,
  parseSslCertFailure,
  trustableFailureKinds,
  type SslCertFailureInfo,
} from '../ssl-trust-cache';

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
      trusts: [{ realm: 'https://svn.example.com/repo', failures: 'ABCDEF', createdAt: 1 }],
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

// ---------------------------------------------------------------------------
// Certificate-failure classification (backlog item #38)
// ---------------------------------------------------------------------------

describe('parseSslCertFailure', () => {
  // Real svn 1.14.5 stderr captured with --non-interactive against badssl.com.
  const selfSignedStderr = [
    "svn: E170013: Unable to connect to a repository at URL 'https://self-signed.badssl.com'",
    'svn: E230001: Server SSL certificate verification failed: issuer is not trusted',
  ].join('\n');
  const expiredStderr = [
    "svn: E170013: Unable to connect to a repository at URL 'https://expired.badssl.com'",
    'svn: E230001: Server SSL certificate verification failed: certificate has expired, issuer is not trusted',
  ].join('\n');
  const hostnameMismatchStderr = [
    "svn: E170013: Unable to connect to a repository at URL 'https://wrong.host.badssl.com'",
    'svn: E230001: Server SSL certificate verification failed: certificate issued for a different hostname, issuer is not trusted',
  ].join('\n');

  it('classifies a self-signed certificate as unknown-ca', () => {
    const failure = parseSslCertFailure(selfSignedStderr);
    expect(failure).not.toBeNull();
    expect(failure?.failureKind).toBe('unknown-ca');
    expect(failure?.failureKinds).toEqual(['unknown-ca']);
    expect(failure?.host).toBe('self-signed.badssl.com');
  });

  it('distinguishes an expired certificate even when combined with unknown-ca', () => {
    const failure = parseSslCertFailure(expiredStderr);
    expect(failure).not.toBeNull();
    expect(failure?.failureKind).toBe('expired');
    expect(failure?.failureKinds).toEqual(['expired', 'unknown-ca']);
  });

  it('classifies a wrong-host certificate as cn-mismatch', () => {
    const failure = parseSslCertFailure(hostnameMismatchStderr);
    expect(failure).not.toBeNull();
    expect(failure?.failureKind).toBe('cn-mismatch');
    expect(failure?.failureKinds).toEqual(['cn-mismatch', 'unknown-ca']);
  });

  it('classifies not-yet-valid certificates', () => {
    const failure = parseSslCertFailure(
      'svn: E230001: Server SSL certificate verification failed: certificate is not yet valid'
    );
    expect(failure?.failureKind).toBe('not-yet-valid');
  });

  it('prefers the URL host when one is supplied', () => {
    const failure = parseSslCertFailure(selfSignedStderr, 'https://svn.example.com/repo');
    expect(failure?.host).toBe('svn.example.com');
  });

  it('extracts fingerprint and validity from interactive prompt output', () => {
    const promptOutput = [
      "Error validating server certificate for 'https://svn.example.com:443':",
      ' - The certificate is not issued by a trusted authority. Use the',
      '   fingerprint to validate the certificate manually!',
      'Certificate information:',
      ' - Hostname: svn.example.com',
      ' - Valid: from Jan 20 00:00:00 2024 GMT until Feb 20 00:00:00 2025 GMT',
      ' - Issuer: Example CA',
      ' - Fingerprint: 3F:2B:99:5C:1A:D4:8E:77:FF:00:11:22:33:44:55:66:77:88:99:AA',
    ].join('\n');

    const failure = parseSslCertFailure(promptOutput, 'https://svn.example.com/repo');
    expect(failure?.failureKind).toBe('unknown-ca');
    expect(failure?.fingerprint).toBe(
      '3F:2B:99:5C:1A:D4:8E:77:FF:00:11:22:33:44:55:66:77:88:99:AA'
    );
    expect(failure?.validUntil).toBe('Feb 20 00:00:00 2025 GMT');
  });

  it('returns null for non-certificate failures so they can never be trusted', () => {
    expect(
      parseSslCertFailure("svn: E175015: The HTTP method 'OPTIONS' is not allowed on '/'")
    ).toBeNull();
    expect(parseSslCertFailure('svn: E170013: unable to connect')).toBeNull();
    expect(parseSslCertFailure('')).toBeNull();
    expect(parseSslCertFailure('Authorization failed (403)')).toBeNull();
  });

  it('marks revoked certificates as untrustable "other"', () => {
    const failure = parseSslCertFailure(
      'svn: E230001: Server SSL certificate verification failed: certificate revoked'
    );
    expect(failure?.failureKind).toBe('other');
    expect(trustableFailureKinds(failure?.failureKinds ?? [])).toEqual([]);
  });
});

describe('SslTrustCache decisions (backlog item #38)', () => {
  const selfSignedFailure = (): SslCertFailureInfo => {
    const failure = parseSslCertFailure(
      'svn: E230001: Server SSL certificate verification failed: issuer is not trusted',
      'https://svn.example.com/repo'
    );
    if (!failure) throw new Error('classification failed');
    return failure;
  };

  it('records an accepted decision and exposes it through findForUrl', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.recordDecision('https://svn.example.com/repo', selfSignedFailure(), 'accepted');

    expect(cache.findForUrl('https://svn.example.com/repo/trunk')).toEqual({
      realm: 'https://svn.example.com/repo',
      failures: 'unknown-ca',
    });
    expect(cache.findDecisionForUrl('https://svn.example.com/repo/trunk')?.decision).toBe(
      'accepted'
    );
  });

  it('never exposes a rejected certificate through findForUrl (auto-trust paths)', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.recordDecision('https://svn.example.com/repo', selfSignedFailure(), 'rejected');

    expect(cache.findForUrl('https://svn.example.com/repo/trunk')).toBeNull();
    const decision = cache.findDecisionForUrl('https://svn.example.com/repo/trunk');
    expect(decision?.decision).toBe('rejected');
    expect(decision?.failureKind).toBe('unknown-ca');
  });

  it('lets a deeper rejection shadow a broader acceptance', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/', 'unknown-ca');
    cache.recordDecision('https://svn.example.com/untrusted', selfSignedFailure(), 'rejected');

    // Under the rejected realm: no automatic trust.
    expect(cache.findForUrl('https://svn.example.com/untrusted/trunk')).toBeNull();
    // Elsewhere on the origin the acceptance still applies.
    expect(cache.findForUrl('https://svn.example.com/other')).toEqual({
      realm: 'https://svn.example.com/',
      failures: 'unknown-ca',
    });
  });

  it('prompts exactly once per (host, fingerprint, failureKind) per session', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    const failure = selfSignedFailure();
    expect(cache.hasPrompted(failure)).toBe(false);
    cache.markPrompted(failure);
    expect(cache.hasPrompted(failure)).toBe(true);

    // Same host, different failure kind → a new prompt key.
    const expired = parseSslCertFailure(
      'svn: E230001: Server SSL certificate verification failed: certificate has expired, issuer is not trusted',
      'https://untrusted.example.com/repo'
    );
    if (!expired) throw new Error('classification failed');
    cache.markPrompted(expired);
    expect(cache.hasPrompted(selfSignedFailure())).toBe(true);
    expect(cache.hasPrompted(expired)).toBe(true);

    // A different host never collides.
    const otherHost = parseSslCertFailure(
      'svn: E230001: Server SSL certificate verification failed: issuer is not trusted',
      'https://other.example.com/repo'
    );
    if (!otherHost) throw new Error('classification failed');
    expect(cache.hasPrompted(otherHost)).toBe(false);
  });

  it('persists decisions and reloads them across instances', async () => {
    const { writeFile } = await import('node:fs/promises');
    const mockWriteFile = vi.mocked(writeFile);

    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();
    cache.recordDecision('https://svn.example.com/repo', selfSignedFailure(), 'rejected');
    await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled());

    const payload = JSON.parse(mockWriteFile.mock.calls.at(-1)![1] as string);
    expect(payload.version).toBe(1);
    expect(payload.trusts[0].decision).toBe('rejected');
    expect(payload.trusts[0].failureKind).toBe('unknown-ca');

    // Reload from the persisted payload.
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify(payload));
    const reloaded = new SslTrustCache('/test/ssl');
    await reloaded.ready();
    expect(reloaded.findForUrl('https://svn.example.com/repo')).toBeNull();
    expect(reloaded.findDecisionForUrl('https://svn.example.com/repo')?.decision).toBe('rejected');
  });

  it('treats legacy entries without a decision as accepted', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        trusts: [{ realm: 'https://svn.example.com/repo', failures: 'unknown-ca', createdAt: 1 }],
      })
    );

    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    expect(cache.findDecisionForUrl('https://svn.example.com/repo')?.decision).toBe('accepted');
  });

  it('lists only accepted http(s) origins for diagnostics', async () => {
    const cache = new SslTrustCache('/test/ssl');
    await cache.ready();

    cache.set('https://svn.example.com/repo/a', 'unknown-ca');
    cache.set('https://svn.example.com/repo/b', 'unknown-ca');
    cache.set('https://other.example.com/repo', 'unknown-ca');
    cache.recordDecision('https://rejected.example.com/repo', selfSignedFailure(), 'rejected');

    expect(cache.listTrustedOrigins()).toEqual([
      'https://other.example.com',
      'https://svn.example.com',
    ]);
  });
});
