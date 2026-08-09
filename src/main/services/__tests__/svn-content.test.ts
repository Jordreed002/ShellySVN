// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({ runSvn: vi.fn() }));
vi.mock('../svn-executor', () => ({ runSvn: mockState.runSvn }));
vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForUrl: vi.fn().mockResolvedValue({ trustSslFailures: false }),
  getNetworkOptionsForWorkingCopyPath: vi.fn().mockResolvedValue({ trustSslFailures: false }),
}));

import { catRepositoryFile } from '../svn-content';

describe('svn-content', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retrieves exact binary bytes with an operative revision', async () => {
    const bytes = Buffer.from([0, 255, 1, 2]);
    mockState.runSvn.mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutBase64: bytes.toString('base64'),
    });

    await expect(
      catRepositoryFile('https://svn.example.com/repo/image.bin', '42')
    ).resolves.toEqual({
      target: 'https://svn.example.com/repo/image.bin',
      revision: '42',
      contentBase64: bytes.toString('base64'),
      byteLength: 4,
      binary: true,
      truncated: false,
    });
    expect(mockState.runSvn).toHaveBeenCalledWith(
      ['cat', '-r', '42', '--', 'https://svn.example.com/repo/image.bin'],
      {
        trustSslFailures: false,
        binaryStdout: true,
        maxStdoutBytes: 32 * 1024 * 1024,
      }
    );
  });

  it('escapes local peg ambiguity and rejects invalid revisions', async () => {
    mockState.runSvn.mockResolvedValue({ stdoutBase64: '', stdoutTruncated: false });
    await catRepositoryFile('/wc/file@name', 'HEAD');
    expect(mockState.runSvn.mock.calls[0][0]).toEqual([
      'cat',
      '-r',
      'HEAD',
      '--',
      '/wc/file@name@',
    ]);
    await expect(catRepositoryFile('/wc/file', '1:2')).rejects.toThrow(/invalid svn revision/i);
  });
});
