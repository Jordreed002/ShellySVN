// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
}));

vi.mock('../svn-executor', async (importOriginal) => {
  // Keep the pure disk-full classifiers real (item #30 coverage) while the
  // spawning path stays mocked.
  const actual = await importOriginal<typeof import('../svn-executor')>();
  return {
    ...actual,
    DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES: 1024 * 1024,
    runSvn: mockState.runSvn,
  };
});

import { cancelSvnOperation, runSvnOperationWithProgress } from '../svn-progress';

describe('svn-progress', () => {
  beforeEach(() => {
    mockState.runSvn.mockReset();
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

  it('returns null when successful output has no authoritative revision', async () => {
    mockState.runSvn.mockResolvedValue({
      stdout: 'Summary of conflicts:\n  Text conflicts: 0\n',
      stderr: '',
      code: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    await expect(
      runSvnOperationWithProgress(
        { sender: { send: vi.fn() } } as never,
        'merge-no-revision',
        'merge',
        ['merge', 'source', 'target']
      )
    ).resolves.toMatchObject({ success: true, revision: null });
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
      revision: null,
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

  it('clears interrupted operations so a retry can reuse the operation id', async () => {
    const send = vi.fn();
    mockState.runSvn
      .mockRejectedValueOnce(new Error('process crashed unexpectedly'))
      .mockResolvedValueOnce({
        stdout: 'Updated to revision 88.',
        stderr: '',
        code: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      });

    await expect(
      runSvnOperationWithProgress({ sender: { send } } as never, 'update-1', 'update', [
        'update',
        'C:\\wc',
      ])
    ).resolves.toEqual({
      success: false,
      revision: null,
      error: 'process crashed unexpectedly',
    });

    expect(cancelSvnOperation('update-1')).toEqual({
      success: false,
      error: 'No active SVN operation found with that ID',
    });

    await expect(
      runSvnOperationWithProgress({ sender: { send } } as never, 'update-1', 'update', [
        'update',
        'C:\\wc',
      ])
    ).resolves.toEqual({
      success: true,
      revision: 88,
      output: 'Updated to revision 88.',
    });
    expect(send).toHaveBeenCalledWith(
      'svn:operation:progress',
      expect.objectContaining({
        operationId: 'update-1',
        operation: 'update',
        status: 'completed',
        revision: 88,
      })
    );
  });

  it('redacts secret-looking progress errors before sending them to the renderer', async () => {
    const send = vi.fn();
    mockState.runSvn.mockRejectedValue(new Error('commit failed password=hunter2 token=abc123'));

    const result = await runSvnOperationWithProgress(
      { sender: { send } } as never,
      'commit-2',
      'commit',
      ['commit', '-m', 'message', 'src/file.ts']
    );

    expect(result).toEqual({
      success: false,
      revision: null,
      error: 'commit failed password=[REDACTED] token=[REDACTED]',
    });
    expect(send).toHaveBeenCalledWith(
      'svn:operation:progress',
      expect.objectContaining({
        operationId: 'commit-2',
        operation: 'commit',
        status: 'error',
        error: 'commit failed password=[REDACTED] token=[REDACTED]',
      })
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain('hunter2');
  });

  it('maps a disk-full export failure to the typed recovery hint instead of raw stderr', async () => {
    const send = vi.fn();
    mockState.runSvn.mockRejectedValue(
      Object.assign(
        new Error("svn: E720164: Can't write to file: There is not enough space on the disk."),
        {
          code: 'SVN_DISK_FULL',
          diskFull: { operationKind: null, targetPath: null, recoveryHint: '' },
        }
      )
    );

    const result = await runSvnOperationWithProgress(
      { sender: { send } } as never,
      'export-disk-full',
      'export',
      ['export', '--non-interactive', 'https://example.test/repo', 'C:\\exports\\repo'],
      { cwd: 'C:\\work' }
    );

    expect(result.success).toBe(false);
    expect(result.diskFull).toMatchObject({
      operationKind: 'export',
      targetPath: 'C:\\exports\\repo',
    });
    expect(result.error).toBe(result.diskFull?.recoveryHint);
    expect(result.error).toContain('Free up space');
    expect(result.error).not.toContain('E720164');
    expect(send).toHaveBeenCalledWith(
      'svn:operation:progress',
      expect.objectContaining({
        operationId: 'export-disk-full',
        operation: 'export',
        status: 'error',
        error: result.diskFull?.recoveryHint,
      })
    );
  });

  it('derives the update kind and cwd target when a raw ENOSPC error escapes the executor', async () => {
    const send = vi.fn();
    mockState.runSvn.mockRejectedValue(
      Object.assign(new Error('write failed: no space left on device'), { code: 'ENOSPC' })
    );

    const result = await runSvnOperationWithProgress(
      { sender: { send } } as never,
      'update-disk-full',
      'update',
      ['update'],
      { cwd: 'C:\\working-copy' }
    );

    expect(result.diskFull).toMatchObject({
      operationKind: 'update',
      targetPath: 'C:\\working-copy',
    });
    expect(result.error).toContain('Run cleanup');
  });
});
