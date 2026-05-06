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

import { getBlame, getDiff, getDiffStreaming, getLog, getUrlDiff } from '../svn-history';

describe('svn-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(mockState.getWorkerLog).toHaveBeenCalledWith('C:\\wc', 50, 10, 12, true);
    expect(result.entries[0]?.revision).toBe(12);
  });

  it('passes caller job ids to cancellable log work', async () => {
    mockState.getWorkerLog.mockResolvedValue({
      entries: [],
      startRevision: 0,
      endRevision: 0,
    });

    await getLog('C:\\wc', 50, 10, 12, true, 'job-log-1');

    expect(mockState.getWorkerLog).toHaveBeenCalledWith('C:\\wc', 50, 10, 12, true, 'job-log-1');
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
});
