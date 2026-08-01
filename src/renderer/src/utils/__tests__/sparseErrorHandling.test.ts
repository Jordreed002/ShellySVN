import { describe, expect, it, vi } from 'vitest';

import type { AppError } from '@shared/errors';

import {
  SparseErrorType,
  appErrorToSparseError,
  classifySparseError,
  credentialCache,
  getUserFriendlyMessage,
  isNetworkError,
  isRetryable,
  requiresAuthentication,
  withRetry,
} from '../sparseErrorHandling';

/**
 * J2 / J10 — Sparse checkout error handling.
 * `classifySparseError` decides, from a raw error string, what kind of recovery
 * the UI should offer (retry, prompt for auth, give up). Getting the
 * retryable/requiresAuth flags wrong either loops forever on a hard failure or
 * gives up silently on a transient one.
 */
describe('classifySparseError', () => {
  it('classifies network failures as retryable, non-auth', () => {
    const out = classifySparseError(new Error('svn: E210002 Network connection closed'));
    expect(out.type).toBe(SparseErrorType.NETWORK_FAILURE);
    expect(out.retryable).toBe(true);
    expect(out.requiresAuth).toBe(false);
    expect(out.suggestions.length).toBeGreaterThan(0);
  });

  it('classifies "could not resolve hostname" as a network failure', () => {
    expect(classifySparseError('Could not resolve hostname host.example.com').type).toBe(
      SparseErrorType.NETWORK_FAILURE
    );
  });

  it('classifies "authorization required" as AUTH_REQUIRED (retryable, auth)', () => {
    const out = classifySparseError('svn: E170001: Authorization required');
    expect(out.type).toBe(SparseErrorType.AUTH_REQUIRED);
    expect(out.requiresAuth).toBe(true);
    expect(out.retryable).toBe(true);
  });

  it('classifies "authentication failed" as AUTH_FAILED', () => {
    const out = classifySparseError('Authentication failed for realm');
    expect(out.type).toBe(SparseErrorType.AUTH_FAILED);
    expect(out.requiresAuth).toBe(true);
  });

  it('classifies permission denied as NOT retryable', () => {
    const out = classifySparseError('svn: E000013: Permission denied');
    expect(out.type).toBe(SparseErrorType.PERMISSION_DENIED);
    expect(out.retryable).toBe(false);
    expect(out.requiresAuth).toBe(false);
  });

  it('classifies repository-not-found as NOT retryable', () => {
    expect(classifySparseError('svn: E000022: Repository not found').type).toBe(
      SparseErrorType.REPO_NOT_FOUND
    );
    expect(classifySparseError('No repository found at url').retryable).toBe(false);
  });

  it('classifies ssl/certificate errors', () => {
    expect(classifySparseError('Server SSL certificate verification failed').type).toBe(
      SparseErrorType.SSL_ERROR
    );
  });

  it('classifies conflict and out-of-date', () => {
    expect(classifySparseError('svn: E155015: File or directory is out of date').type).toBe(
      SparseErrorType.OUT_OF_DATE
    );
    expect(classifySparseError('A conflict was detected').type).toBe(SparseErrorType.CONFLICT);
  });

  it('classifies locked resources', () => {
    expect(classifySparseError('svn: E175002: Path is locked').type).toBe(SparseErrorType.LOCKED);
  });

  it('classifies working-copy errors', () => {
    expect(classifySparseError('svn: E155037: Working copy is corrupt').type).toBe(
      SparseErrorType.WORKING_COPY_ERROR
    );
  });

  it('falls back to UNKNOWN for anything unmatched', () => {
    const out = classifySparseError('something completely unexpected');
    expect(out.type).toBe(SparseErrorType.UNKNOWN);
    expect(out.retryable).toBe(true);
  });

  it('precedence: a message matching multiple categories picks the first checked (network)', () => {
    // Contains both "network" and "timeout" — network is checked before timeout.
    expect(classifySparseError('network timeout occurred').type).toBe(
      SparseErrorType.NETWORK_FAILURE
    );
  });

  it('preserves the original error on the result', () => {
    const err = new Error('boom');
    expect(classifySparseError(err).originalError).toBe(err);
  });
});

describe('convenience predicates', () => {
  it('requiresAuthentication wraps classify', () => {
    expect(requiresAuthentication('authorization required')).toBe(true);
    expect(requiresAuthentication('permission denied')).toBe(false);
  });

  it('isRetryable wraps classify', () => {
    expect(isRetryable('network failure')).toBe(true);
    expect(isRetryable('repository not found')).toBe(false);
  });

  it('isNetworkError is true for network and timeout, false otherwise', () => {
    expect(isNetworkError('connection refused')).toBe(true);
    expect(isNetworkError('operation timed out')).toBe(true);
    expect(isNetworkError('permission denied')).toBe(false);
  });

  it('getUserFriendlyMessage returns the classified message', () => {
    expect(getUserFriendlyMessage('repository not found')).toBe(
      'The repository could not be found at the specified URL.'
    );
  });
});

describe('appErrorToSparseError', () => {
  it('classifies from the AppError message and keeps details when present', () => {
    const appError: AppError = {
      code: 'SVN_ERROR' as AppError['code'],
      message: 'Network connection closed',
      details: { url: 'https://repo' },
    };

    const out = appErrorToSparseError(appError);
    expect(out.type).toBe(SparseErrorType.NETWORK_FAILURE);
    expect(out.details).toContain('https://repo');
  });

  it('falls back to the classified details string when AppError has no details', () => {
    const appError: AppError = {
      code: 'SVN_ERROR' as AppError['code'],
      message: 'Repository not found',
    };

    expect(appErrorToSparseError(appError).details).toBe('Repository not found');
  });
});

describe('CredentialCache', () => {
  // The cache is a module-level singleton; reset between tests.
  beforeEach(() => credentialCache.clear());

  it('normalizes a URL to its protocol//host key', () => {
    credentialCache.set('https://host.example.com/repo/path', {
      id: '1',
      realm: 'r',
      username: 'u',
      persistent: false,
    } as never);
    expect(credentialCache.has('https://host.example.com/other/path')).toBe(true);
  });

  it('returns undefined for a miss', () => {
    expect(credentialCache.get('https://nope.example.com')).toBeUndefined();
  });

  it('falls back to the raw url key when the URL is invalid', () => {
    credentialCache.set('not-a-url', {
      id: '2',
      realm: 'r',
      username: 'u',
      persistent: false,
    } as never);
    expect(credentialCache.get('not-a-url')?.id).toBe('2');
  });

  it('clears a single host while leaving others intact', () => {
    credentialCache.set('https://a.example.com', {
      id: 'a',
      realm: 'r',
      username: 'u',
      persistent: false,
    } as never);
    credentialCache.set('https://b.example.com', {
      id: 'b',
      realm: 'r',
      username: 'u',
      persistent: false,
    } as never);

    credentialCache.clear('https://a.example.com/x');
    expect(credentialCache.has('https://a.example.com')).toBe(false);
    expect(credentialCache.has('https://b.example.com')).toBe(true);
  });
});

describe('withRetry', () => {
  // Real timers with a 1ms delay keep these tests deterministic and fast
  // without the microtask/timer interleaving that fake timers cause around
  // rejected promises.
  it('returns the value on the first success without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable error (permission denied)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permission denied'));
    await expect(withRetry(fn, { maxAttempts: 5 })).rejects.toThrow('permission denied');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry an auth-required error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('authorization required'));
    await expect(withRetry(fn, { maxAttempts: 5 })).rejects.toThrow('authorization required');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error up to maxAttempts, then throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network connection closed'));
    const onRetry = vi.fn();

    await expect(
      withRetry(fn, { maxAttempts: 3, delayMs: 1, backoffMultiplier: 1, onRetry })
    ).rejects.toThrow('network connection closed');

    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('eventually succeeds after a transient failure', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(fn, { maxAttempts: 3, delayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
