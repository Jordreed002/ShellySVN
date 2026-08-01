import { describe, expect, it } from 'vitest';

import type { SvnCommandErrorDetails } from '@shared/types';

import { assertSuccessfulSvnRead } from '../svnReadResult';

/**
 * Guards every renderer SVN read (status, log, info, …). A regression here
 * would either throw spuriously on clean results or, worse, swallow real SVN
 * errors so the UI renders stale/empty data as if nothing went wrong.
 */
describe('assertSuccessfulSvnRead', () => {
  it('returns the result untouched when there is no error field', () => {
    const result = { entries: [], revision: 5 };
    expect(assertSuccessfulSvnRead(result)).toBe(result);
  });

  it('throws when the result carries an `error` string', () => {
    expect(() => assertSuccessfulSvnRead({ error: 'svn: E160013: boom' })).toThrow(
      'svn: E160013: boom'
    );
  });

  it('throws a cancellation message when the operation was cancelled', () => {
    expect(() => assertSuccessfulSvnRead({ cancelled: true })).toThrow('SVN operation cancelled');
  });

  it('throws a parse message when only a parseError is present', () => {
    expect(() => assertSuccessfulSvnRead({ parseError: 'unexpected token' })).toThrow(
      'Failed to parse SVN response: unexpected token'
    );
  });

  it('prefers `error` over `cancelled`/`parseError`', () => {
    expect(() =>
      assertSuccessfulSvnRead({ error: 'hard error', cancelled: true, parseError: 'x' })
    ).toThrow('hard error');
  });

  it('attaches commandError details to the thrown error', () => {
    const commandError: SvnCommandErrorDetails = {
      message: 'boom',
      svnErrorCode: 'E160013',
      category: 'client' as SvnCommandErrorDetails['category'],
      retryable: false,
      authenticationRequired: false,
      certificateError: false,
      safeStderr: 'boom',
    };

    try {
      assertSuccessfulSvnRead({ error: 'fail', commandError });
      throw new Error('expected assertSuccessfulSvnRead to throw');
    } catch (err) {
      expect((err as Error & { commandError?: SvnCommandErrorDetails }).commandError).toBe(
        commandError
      );
    }
  });
});
