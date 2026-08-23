// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
  runSvnText: vi.fn(),
  sslReady: vi.fn().mockResolvedValue(undefined),
  sslSet: vi.fn(),
}));

vi.mock('../svn-executor', async (importOriginal) => {
  // Keep the pure disk-full classifiers real (item #30 coverage) while the
  // spawning path stays mocked.
  const actual = await importOriginal<typeof import('../svn-executor')>();
  return {
    ...actual,
    DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES: 1024 * 1024,
    runSvn: mockState.runSvn,
    runSvnText: mockState.runSvnText,
  };
});

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../ssl-trust-cache', () => ({
  getSslTrustCache: () => ({
    ready: mockState.sslReady,
    set: mockState.sslSet,
  }),
}));

import { cancelCheckout, checkout, checkoutWithProgress } from '../svn-checkout';

describe('svn-checkout progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.sslReady.mockResolvedValue(undefined);
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
        '--',
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

    const result = await checkout('https://example.test/svn/project', 'C:\\wc', '123', 'files', {
      trustSsl: true,
      sslFailures: ['hostname-mismatch'],
      credentials: { username: 'alice', password: 'secret' },
    });

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
        '--',
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

  it('rejects an invalid checkout revision before spawning svn', async () => {
    const result = await checkout('https://example.test/svn/project', 'C:\\wc', 'latest');

    expect(result.success).toBe(false);
    expect(result.revision).toBeNull();
    expect(result.output).toContain('not a valid SVN revision');
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('persists trusted SSL failures after a permanent-trust checkout succeeds', async () => {
    mockState.runSvnText.mockResolvedValue('Checked out revision 321.');

    await checkout('https://example.test/svn/project', 'C:\\wc', undefined, 'files', {
      trustSsl: true,
      trustPermanently: true,
      sslFailures: ['hostname-mismatch'],
    });

    expect(mockState.sslSet).toHaveBeenCalledWith(
      'https://example.test/svn/project',
      'cn-mismatch'
    );
  });

  it.each([
    'http://example.test/svn/project',
    'svn://example.test/project',
    'svn+ssh://example.test/project',
    'file:///tmp/repository',
  ])('does not apply or persist HTTPS certificate trust for %s', async (url) => {
    mockState.runSvnText.mockResolvedValue('Checked out revision 321.');

    await checkout(url, 'C:\\wc', undefined, 'files', {
      trustSsl: true,
      trustPermanently: true,
      sslFailures: ['hostname-mismatch'],
    });

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        trustSslFailures: false,
        trustedSslFailures: undefined,
      })
    );
    expect(mockState.sslReady).not.toHaveBeenCalled();
    expect(mockState.sslSet).not.toHaveBeenCalled();
  });

  it('implements sparse checkout as empty checkout plus targeted updates', async () => {
    mockState.runSvnText
      .mockResolvedValueOnce('Checked out revision 12.')
      .mockResolvedValueOnce('Updated to revision 12.')
      .mockResolvedValueOnce('Updated to revision 12.');

    const result = await checkout(
      'https://example.test/svn/project/trunk',
      'C:\\wc',
      undefined,
      'empty',
      {
        sparsePaths: [
          'https://example.test/svn/project/trunk/src/file1.ts',
          'https://example.test/svn/project/trunk/src/file2.ts',
        ],
      }
    );

    expect(result).toEqual({
      success: true,
      revision: 12,
      output: 'Checked out revision 12.Updated to revision 12.Updated to revision 12.',
    });
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      1,
      [
        'checkout',
        '--non-interactive',
        '--depth',
        'empty',
        '--',
        'https://example.test/svn/project/trunk',
        'C:\\wc',
      ],
      expect.any(Object)
    );
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      2,
      ['update', '--parents', '--depth', 'infinity', 'src/file1.ts'],
      expect.objectContaining({ cwd: 'C:\\wc' })
    );
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      3,
      ['update', '--parents', '--depth', 'infinity', 'src/file2.ts'],
      expect.objectContaining({ cwd: 'C:\\wc' })
    );
  });

  it('rejects sparse selections outside the checkout URL before checkout starts', async () => {
    const result = await checkout(
      'https://example.test/svn/project/trunk',
      'C:\\wc',
      undefined,
      'empty',
      {
        sparsePaths: ['https://example.test/svn/project/branches/sibling'],
      }
    );

    expect(result).toMatchObject({ success: false, revision: null });
    expect(result.output).toContain('outside the checkout URL');
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it.each([
    ['https://other.test/svn/project/trunk/src', 'different server'],
    ['../branches/sibling', 'relative traversal'],
    ['C:\\outside\\src', 'absolute Windows path'],
  ])('rejects unsafe sparse target %s (%s)', async (sparsePath) => {
    const result = await checkout(
      'https://example.test/svn/project/trunk',
      'C:\\wc',
      undefined,
      'empty',
      { sparsePaths: [sparsePath] }
    );

    expect(result.success).toBe(false);
    expect(mockState.runSvnText).not.toHaveBeenCalled();
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
        '--',
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
      revision: null,
      output: 'SVN operation cancelled',
    });
  });

  it('maps a disk-full checkout failure to the typed recovery hint (item #30)', async () => {
    mockState.runSvnText.mockRejectedValue(
      new Error("svn: E720164: Can't write to file: There is not enough space on the disk.")
    );

    const result = await checkout('https://example.test/svn/project', 'C:\\wc');

    expect(result.success).toBe(false);
    expect(result.revision).toBeNull();
    expect(result.diskFull).toMatchObject({
      operationKind: 'checkout',
      targetPath: 'C:\\wc',
    });
    expect(result.output).toBe(result.diskFull?.recoveryHint);
    expect(result.output).toContain('Free up space');
    expect(result.output).toContain('C:\\wc');
    expect(result.output).not.toContain('E720164');
  });

  it('surfaces typed disk-full details from a failed progress checkout', async () => {
    const send = vi.fn();
    mockState.runSvn.mockRejectedValue(
      Object.assign(new Error('write failed: no space left on device'), {
        code: 'SVN_DISK_FULL',
        diskFull: { operationKind: 'checkout', targetPath: null, recoveryHint: '' },
      })
    );

    const result = await checkoutWithProgress(
      { sender: { send } } as never,
      'checkout-disk-full',
      'https://example.test/svn/project',
      '/tmp/wc'
    );

    expect(result.success).toBe(false);
    expect(result.diskFull).toMatchObject({
      operationKind: 'checkout',
      targetPath: '/tmp/wc',
    });
    expect(result.output).toBe(result.diskFull?.recoveryHint);
    expect(result.output).toContain('partial destination');
  });

  it('keeps ordinary checkout failures as raw messages without disk-full details', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('svn: E175002: connection refused'));

    const result = await checkout('https://example.test/svn/project', 'C:\\wc');

    expect(result).toEqual({
      success: false,
      revision: null,
      output: 'svn: E175002: connection refused',
    });
    expect(result.diskFull).toBeUndefined();
  });
});
