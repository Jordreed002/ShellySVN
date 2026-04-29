// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
  runSvnText: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES: 1024 * 1024,
  runSvn: mockState.runSvn,
  runSvnText: mockState.runSvnText,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

import { cancelCheckout, checkout, checkoutWithProgress } from '../svn-checkout';

describe('svn-checkout progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caps stored output for progress checkout and keeps streamed revision', async () => {
    const send = vi.fn();
    mockState.runSvn.mockImplementation(
      async (_args: string[], options: { onStdout?: (chunk: string) => void }) => {
        options.onStdout?.('A    src/file.ts\n');
        options.onStdout?.('Checked out rev');
        options.onStdout?.('ision 456.\n');
        return {
          stdout: 'A    src/file.ts\n',
          stderr: '',
          code: 0,
          stdoutTruncated: true,
          stderrTruncated: false,
        };
      }
    );

    const result = await checkoutWithProgress(
      { sender: { send } } as never,
      'checkout-1',
      'https://example.test/svn/project',
      'C:\\wc',
      undefined,
      'infinity',
      undefined
    );

    expect(result).toEqual({
      success: true,
      revision: 456,
      output: 'A    src/file.ts\n',
      filesProcessed: 1,
    });
    expect(mockState.runSvn).toHaveBeenCalledWith(
      [
        'checkout',
        '--non-interactive',
        '--depth',
        'infinity',
        'https://example.test/svn/project',
        'C:\\wc',
      ],
      expect.objectContaining({
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
      })
    );
  });

  it('passes checkout revision, depth, credentials, and SSL trust through executor options', async () => {
    mockState.runSvnText.mockResolvedValue('Checked out revision 321.');

    const result = await checkout(
      'https://example.test/svn/project',
      'C:\\wc',
      '123',
      'files',
      {
        trustSsl: true,
        sslFailures: ['hostname-mismatch'],
        credentials: { username: 'alice', password: 'secret' },
      }
    );

    expect(result).toEqual({
      success: true,
      revision: 321,
      output: 'Checked out revision 321.',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'checkout',
        '--non-interactive',
        '-r',
        '123',
        '--depth',
        'files',
        'https://example.test/svn/project',
        'C:\\wc',
      ],
      expect.objectContaining({
        trustSslFailures: true,
        trustedSslFailures: 'cn-mismatch',
        credentials: { username: 'alice', password: 'secret' },
      })
    );
  });

  it('does not duplicate credentials or SSL trust flags during progress checkouts', async () => {
    const send = vi.fn();
    mockState.runSvn.mockResolvedValue({
      stdout: 'Checked out revision 7.',
      stderr: '',
      code: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    await checkoutWithProgress(
      { sender: { send } } as never,
      'checkout-2',
      'https://example.test/svn/project',
      'C:\\wc',
      '7',
      'immediates',
      {
        trustSsl: true,
        sslFailures: ['expired'],
        credentials: { username: 'alice', password: 'secret' },
      }
    );

    expect(mockState.runSvn).toHaveBeenCalledWith(
      [
        'checkout',
        '--non-interactive',
        '-r',
        '7',
        '--depth',
        'immediates',
        'https://example.test/svn/project',
        'C:\\wc',
      ],
      expect.objectContaining({
        trustSslFailures: true,
        trustedSslFailures: 'expired',
        credentials: { username: 'alice', password: 'secret' },
      })
    );
  });

  it('cancels an active progress checkout', async () => {
    const send = vi.fn();
    mockState.runSvn.mockImplementation(
      (_args, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new Error('SVN operation cancelled'));
          });
        })
    );

    const promise = checkoutWithProgress(
      { sender: { send } } as never,
      'checkout-cancel',
      'https://example.test/svn/project',
      'C:\\wc'
    );
    await Promise.resolve();

    expect(cancelCheckout('checkout-cancel')).toEqual({ success: true });
    await expect(promise).resolves.toEqual({
      success: false,
      revision: 0,
      output: 'SVN operation cancelled',
    });
  });
});
