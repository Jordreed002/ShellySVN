// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES: 1024 * 1024,
  runSvn: mockState.runSvn,
}));

import { cancelSvnOperation, runSvnOperationWithProgress } from '../svn-progress';

describe('svn-progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams file progress and uses streamed revision when stored output is capped', async () => {
    const send = vi.fn();
    mockState.runSvn.mockImplementation(async (_args, options) => {
      options.onStdout?.('Sending        src/file.ts\nCommitted rev');
      options.onStdout?.('ision 77.\n');
      return {
        stdout: 'Sending        src/file.ts\n',
        stderr: '',
        code: 0,
        stdoutTruncated: true,
        stderrTruncated: false,
      };
    });

    const result = await runSvnOperationWithProgress(
      { sender: { send } } as never,
      'commit-1',
      'commit',
      ['commit', '-m', 'message', 'src/file.ts']
    );

    expect(result).toEqual({
      success: true,
      revision: 77,
      output: 'Sending        src/file.ts\n',
    });
    expect(mockState.runSvn).toHaveBeenCalledWith(
      ['commit', '-m', 'message', 'src/file.ts'],
      expect.objectContaining({
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
      })
    );
    expect(send).toHaveBeenCalledWith(
      'svn:operation:progress',
      expect.objectContaining({
        operationId: 'commit-1',
        operation: 'commit',
        status: 'running',
        currentFile: 'src/file.ts',
        filesProcessed: 1,
      })
    );
    expect(send).toHaveBeenCalledWith(
      'svn:operation:progress',
      expect.objectContaining({
        operationId: 'commit-1',
        operation: 'commit',
        status: 'completed',
        revision: 77,
      })
    );
  });

  it('cancels an active operation by aborting the executor signal', async () => {
    const send = vi.fn();
    mockState.runSvn.mockImplementation(
      (_args, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new Error('SVN operation cancelled'));
          });
        })
    );

    const promise = runSvnOperationWithProgress(
      { sender: { send } } as never,
      'export-1',
      'export',
      ['export', 'https://example.test/repo', 'C:\\wc']
    );
    await Promise.resolve();

    expect(cancelSvnOperation('export-1')).toEqual({ success: true });
    await expect(promise).resolves.toEqual({
      success: false,
      revision: 0,
      error: 'SVN operation cancelled',
    });
    expect(send).toHaveBeenCalledWith(
      'svn:operation:progress',
      expect.objectContaining({
        operationId: 'export-1',
        operation: 'export',
        status: 'cancelled',
      })
    );
  });
});
