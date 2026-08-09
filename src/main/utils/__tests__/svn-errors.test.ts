// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { classifySvnCommandError, getSvnReadError, SvnCommandError } from '../svn-errors';

describe('structured SVN command errors', () => {
  it.each([
    ['svn: E215004: Authentication failed', 'authentication', true],
    ['svn: E230001: Server SSL certificate verification failed', 'certificate', true],
    ['svn: E170013: Unable to connect', 'network', true],
    ["svn: E155007: '/tmp/repo' is not a working copy", 'working-copy', false],
    ['svn: E155004: Working copy is locked', 'locked', true],
    ['svn: E160028: File is out of date', 'out-of-date', true],
    ['SVN operation cancelled', 'cancelled', false],
    ['SVN operation timed out after 30 seconds', 'timeout', true],
  ] as const)('classifies %s as %s', (message, category, retryable) => {
    expect(classifySvnCommandError(new Error(message))).toMatchObject({
      category,
      retryable,
      safeStderr: message,
    });
  });

  it('preserves command context, SVN codes, and redacts secrets', () => {
    const result = getSvnReadError(
      new Error('svn: E215004: authentication failed password=hunter2'),
      { command: 'commit', target: '/wc/file.txt' }
    );

    expect(result).toMatchObject({
      errorCode: 'E215004',
      commandError: {
        category: 'authentication',
        command: 'commit',
        target: '/wc/file.txt',
        authenticationRequired: true,
      },
    });
    expect(result.error).toContain('password=[REDACTED]');
    expect(result.error).not.toContain('hunter2');
  });

  it('retains runner-provided details while adding missing service context', () => {
    const error = new SvnCommandError('svn: E170013: Unable to connect', {
      command: 'list',
    });

    expect(
      classifySvnCommandError(error, { target: 'https://svn.example.com/repo' })
    ).toMatchObject({
      category: 'network',
      command: 'list',
      target: 'https://svn.example.com/repo',
    });
  });
});
