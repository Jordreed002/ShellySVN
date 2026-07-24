// @vitest-environment node

import { writeFile } from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import { applyPatch, createPatch } from '../svn-patch';

describe('svn-patch createPatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a patch for selected files and writes the SVN diff output', async () => {
    const diff = 'Index: src/file.txt\n--- src/file.txt\n+++ src/file.txt\n';
    mockState.runSvnText.mockResolvedValue(diff);

    const result = await createPatch(['C:\\wc\\src\\file.txt'], 'C:\\patches\\selected.patch');

    expect(result).toEqual({ success: true, output: diff });
    expect(mockState.runSvnText).toHaveBeenCalledWith(['diff', '--', 'C:\\wc\\src\\file.txt']);
    expect(writeFile).toHaveBeenCalledWith('C:\\patches\\selected.patch', diff, 'utf-8');
  });

  it('creates a patch for a whole working copy path', async () => {
    const diff = 'Index: src/one.txt\n--- src/one.txt\n+++ src/one.txt\n';
    mockState.runSvnText.mockResolvedValue(diff);

    await expect(createPatch(['C:\\wc'], 'C:\\patches\\working-copy.patch')).resolves.toEqual({
      success: true,
      output: diff,
    });

    expect(mockState.runSvnText).toHaveBeenCalledWith(['diff', '--', 'C:\\wc']);
    expect(writeFile).toHaveBeenCalledWith('C:\\patches\\working-copy.patch', diff, 'utf-8');
  });

  it('returns SVN errors without writing a patch file', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('svn: E155007: not a working copy'));

    await expect(createPatch(['C:\\not-wc'], 'C:\\patches\\bad.patch')).resolves.toEqual({
      success: false,
      output: 'svn: E155007: not a working copy',
    });
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('svn-patch applyPatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies patch dry-runs and reports patched file counts', async () => {
    mockState.runSvnText.mockResolvedValue(
      'U         src/a.txt\nU         src/b.txt\nPatched 2 files.'
    );

    const result = await applyPatch('C:\\patches\\changes.patch', 'C:\\wc', true);

    expect(result).toEqual({
      success: true,
      appliedWithConflicts: false,
      filesPatched: 2,
      rejects: 0,
      rejectFiles: [],
      offsetHunks: 0,
      fuzzedHunks: 0,
      output: 'U         src/a.txt\nU         src/b.txt\nPatched 2 files.',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'patch',
      '--dry-run',
      '--',
      'C:\\patches\\changes.patch',
      'C:\\wc',
    ]);
  });

  it('preserves reject-file output and marks rejected patches as failed', async () => {
    const output = [
      'U         src/file.txt',
      'Rejected hunk in src/file.txt',
      'Rejected hunk saved to src/file.txt.rej',
      'Patched 1 file.',
      '1 reject.',
    ].join('\n');
    mockState.runSvnText.mockResolvedValue(output);

    await expect(applyPatch('C:\\patches\\changes.patch', 'C:\\wc')).resolves.toEqual({
      success: false,
      appliedWithConflicts: true,
      filesPatched: 1,
      rejects: 1,
      rejectFiles: [],
      offsetHunks: 0,
      fuzzedHunks: 0,
      output,
    });
  });

  it('passes reverse, whitespace, and strip options to SVN', async () => {
    mockState.runSvnText.mockResolvedValue('U         src/a.txt');
    await applyPatch('C:\\patches\\changes.patch', 'C:\\wc', false, {
      reverse: true,
      ignoreWhitespace: true,
      stripCount: 2,
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'patch',
      '--reverse-diff',
      '--ignore-whitespace',
      '--strip',
      '2',
      '--',
      'C:\\patches\\changes.patch',
      'C:\\wc',
    ]);
  });

  it('returns binary patch failures without losing the SVN message', async () => {
    mockState.runSvnText.mockRejectedValue(
      new Error('svn: E200009: Cannot apply textual patch to binary file assets/logo.png')
    );

    await expect(applyPatch('C:\\patches\\binary.patch', 'C:\\wc')).resolves.toEqual({
      success: false,
      appliedWithConflicts: false,
      filesPatched: 0,
      rejects: 0,
      rejectFiles: [],
      offsetHunks: 0,
      fuzzedHunks: 0,
      output: 'svn: E200009: Cannot apply textual patch to binary file assets/logo.png',
    });
  });

  it('reports conflict recovery files, offsets, and fuzz separately', async () => {
    const output = [
      'C         src/file.txt',
      '>         applied hunk @@ -1,3 +1,3 @@ with offset 2 and fuzz 1.',
      '>         rejected hunk @@ -8,3 +8,3 @@',
      'Rejected hunk saved to src/file.txt.svnpatch.rej',
    ].join('\n');
    mockState.runSvnText.mockResolvedValue(output);

    await expect(applyPatch('changes.patch', 'wc')).resolves.toEqual({
      success: false,
      appliedWithConflicts: true,
      filesPatched: 1,
      rejects: 2,
      rejectFiles: ['src/file.txt.svnpatch.rej'],
      offsetHunks: 1,
      fuzzedHunks: 1,
      output,
    });
  });
});
