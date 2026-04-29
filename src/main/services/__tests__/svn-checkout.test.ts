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

import { checkoutWithProgress } from '../svn-checkout';

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
});
