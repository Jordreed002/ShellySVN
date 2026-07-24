// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  getWorkerLog: vi.fn(),
  getWorkerUrlDiff: vi.fn(),
  getWorkerBlame: vi.fn(),
  getWorkerDiff: vi.fn(),
  getWorkerDiffStreaming: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-history-worker', () => ({
  getWorkerLog: mockState.getWorkerLog,
  getWorkerUrlDiff: mockState.getWorkerUrlDiff,
  getWorkerBlame: mockState.getWorkerBlame,
  getWorkerDiff: mockState.getWorkerDiff,
  getWorkerDiffStreaming: mockState.getWorkerDiffStreaming,
}));

import {
  getBlame,
  getDiff,
  getDiffStreaming,
  getLog,
  getMergeInfo,
  getUrlDiff,
} from '../svn-history';

describe('svn-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns sorted unique merged or eligible revisions from mergeinfo', async () => {
    mockState.runSvnText.mockResolvedValue('r12\nr7\nr12\n');

    await expect(getMergeInfo('https://svn.example.com/branch', 'C:\\wc', 'eligible')).resolves.toEqual({
      source: 'https://svn.example.com/branch',
      target: 'C:\\wc',
      kind: 'eligible',
      revisions: [7, 12],
      properties: [],
      rawOutput: 'r12\nr7\nr12\n',
    });
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(1, [
      'mergeinfo',
      '--show-revs',
      'eligible',
      '--',
      'https://svn.example.com/branch',
      'C:\\wc',
    ]);
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(2, [
      'proplist',
      '--xml',
      '-v',
      '--show-inherited-props',
      '--',
      'C:\\wc',
    ]);
  });

  it('rejects invalid mergeinfo targets and modes before invoking SVN', async () => {
    await expect(getMergeInfo('', 'C:\\wc', 'merged')).rejects.toThrow(/must not be empty/i);
    await expect(
      getMergeInfo('https://svn.example.com/branch', 'C:\\wc', 'unknown' as 'merged')
    ).rejects.toThrow(/merged or eligible/i);
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('loads merge-tracking logs with revision ranges', async () => {
    mockState.getWorkerLog.mockResolvedValue({
      entries: [
        {
          revision: 12,
          author: 'alice',
          date: '2026-04-25T10:00:00.000Z',
          message: 'Merged feature branch',
          paths: [],
        },
      ],
      startRevision: 12,
      endRevision: 12,
    });

    const result = await getLog('C:\\wc', 50, 10, 12, true);

    expect(mockState.getWorkerLog).toHaveBeenCalledWith(
      'C:\\wc', 50, 10, 12, true, undefined, {}
    );
    expect(result.entries[0]?.revision).toBe(12);
  });

  it('passes caller job ids to cancellable log work', async () => {
    mockState.getWorkerLog.mockResolvedValue({
      entries: [],
      startRevision: 0,
      endRevision: 0,
    });

    await getLog('C:\\wc', 50, 10, 12, true, 'job-log-1');

    expect(mockState.getWorkerLog).toHaveBeenCalledWith(
      'C:\\wc', 50, 10, 12, true, 'job-log-1', {}
    );
  });

  it('compares branch and tag URLs with svn diff', async () => {
    mockState.getWorkerUrlDiff.mockResolvedValue({
      files: [{ oldPath: 'src/app.ts', newPath: 'src/app.ts', hunks: [] }],
      hasChanges: true,
      rawDiff: '',
    });

    const result = await getUrlDiff(
      'https://svn.example.com/repo/trunk',
      'https://svn.example.com/repo/branches/feature'
    );

    expect(mockState.getWorkerUrlDiff).toHaveBeenCalledWith(
      'https://svn.example.com/repo/trunk',
      'https://svn.example.com/repo/branches/feature'
    );
    expect(result.hasChanges).toBe(true);
    expect(result.files[0]?.newPath).toBe('src/app.ts');
  });

  it('passes caller job ids to cancellable diff work', async () => {
    mockState.getWorkerDiff.mockResolvedValue({
      files: [],
      hasChanges: false,
      rawDiff: '',
    });
    mockState.getWorkerDiffStreaming.mockResolvedValue({
      files: [],
      hasChanges: false,
      rawDiff: '',
    });
    mockState.getWorkerUrlDiff.mockResolvedValue({
      files: [],
      hasChanges: false,
      rawDiff: '',
    });

    await getDiff('C:\\wc\\file.ts', undefined, 'job-diff-1');
    await getDiffStreaming('C:\\wc\\file.ts', '42', 'job-diff-stream-1');
    await getUrlDiff(
      'https://svn.example.com/trunk',
      'https://svn.example.com/branch',
      'job-url-1'
    );

    expect(mockState.getWorkerDiff).toHaveBeenCalledWith(
      'C:\\wc\\file.ts',
      undefined,
      'job-diff-1'
    );
    expect(mockState.getWorkerDiffStreaming).toHaveBeenCalledWith(
      'C:\\wc\\file.ts',
      '42',
      'job-diff-stream-1'
    );
    expect(mockState.getWorkerUrlDiff).toHaveBeenCalledWith(
      'https://svn.example.com/trunk',
      'https://svn.example.com/branch',
      'job-url-1'
    );
  });

  it('loads blame through the worker pool', async () => {
    mockState.getWorkerBlame.mockResolvedValue({
      path: 'C:\\wc\\src\\app.ts',
      lines: [
        {
          lineNumber: 1,
          revision: 12,
          author: 'alice',
          date: '2026-04-25T10:00:00.000Z',
          content: 'const x = 1;',
        },
      ],
      startRevision: 10,
      endRevision: 12,
    });

    const result = await getBlame('C:\\wc\\src\\app.ts', 10, 12);

    expect(mockState.getWorkerBlame).toHaveBeenCalledWith('C:\\wc\\src\\app.ts', 10, 12);
    expect(result.lines[0]?.revision).toBe(12);
  });

  it('passes caller job ids to cancellable blame work', async () => {
    mockState.getWorkerBlame.mockResolvedValue({
      path: 'C:\\wc\\src\\app.ts',
      lines: [],
      startRevision: 0,
      endRevision: 0,
    });

    await getBlame('C:\\wc\\src\\app.ts', 10, 12, 'job-blame-1');

    expect(mockState.getWorkerBlame).toHaveBeenCalledWith(
      'C:\\wc\\src\\app.ts',
      10,
      12,
      'job-blame-1'
    );
  });

  it('handles asynchronous worker rejection inside service fallbacks', async () => {
    mockState.getWorkerLog.mockRejectedValue(new Error('worker failed'));
    mockState.getWorkerDiff.mockRejectedValue(new Error('worker failed'));
    mockState.getWorkerBlame.mockRejectedValue(new Error('worker failed'));

    await expect(getLog('C:\\wc')).resolves.toMatchObject({
      entries: [],
      startRevision: 0,
      endRevision: 0,
      error: 'worker failed',
      commandError: {
        category: 'command',
        retryable: false,
      },
    });
    await expect(getDiff('C:\\wc')).resolves.toMatchObject({ hasChanges: false });
    await expect(getBlame('C:\\wc')).resolves.toMatchObject({
      lines: [],
      error: 'worker failed',
    });
  });

  it('preserves SVN error codes and cancellation classification in read failures', async () => {
    mockState.getWorkerLog.mockRejectedValue(new Error('svn: E170013: Unable to connect'));
    mockState.getWorkerBlame.mockRejectedValue(new Error('SVN operation cancelled'));

    await expect(getLog('https://svn.example.com/repo')).resolves.toMatchObject({
      entries: [],
      errorCode: 'E170013',
      error: 'svn: E170013: Unable to connect',
    });
    await expect(getBlame('C:\\wc\\file.txt')).resolves.toMatchObject({
      lines: [],
      cancelled: true,
    });
  });
});
