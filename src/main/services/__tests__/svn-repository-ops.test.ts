// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-progress', () => ({
  runSvnOperationWithProgress: vi.fn(),
}));

import {
  copyRepositoryItem,
  createRemoteFolder,
  deleteRemoteItem,
  mergeRepositoryRange,
  moveRemoteItem,
  relocateWorkingCopy,
  resolveConflict,
  switchWorkingCopy,
} from '../svn-repository-ops';

describe('svn-repository-ops copyRepositoryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'list') {
        throw new Error('not found');
      }
      return 'Committed revision 42.';
    });
  });

  it('creates branches and tags from URL or working-copy sources', async () => {
    await expect(
      copyRepositoryItem('C:\\wc\\trunk', 'https://example.test/svn/repo/branches/feature', 'msg')
    ).resolves.toEqual({
      success: true,
      revision: 42,
      output: 'Committed revision 42.',
    });

    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'copy',
      '-m',
      'msg',
      'C:\\wc\\trunk',
      'https://example.test/svn/repo/branches/feature',
    ]);

    await expect(
      copyRepositoryItem(
        'https://example.test/svn/repo/trunk',
        'https://example.test/svn/repo/tags/v1',
        'release v1'
      )
    ).resolves.toMatchObject({ success: true, revision: 42 });
  });

  it('rejects invalid destination URLs, missing messages, and unsafe paths', async () => {
    await expect(copyRepositoryItem('C:\\wc', 'not a url', 'msg')).resolves.toMatchObject({
      success: false,
      error: 'Branch/tag destination must be a valid SVN URL.',
    });
    await expect(
      copyRepositoryItem('C:\\wc', 'https://example.test/svn/repo/tags/v1', '   ')
    ).resolves.toMatchObject({
      success: false,
      error: 'Branch/tag creation requires a log message.',
    });
    await expect(
      copyRepositoryItem('C:\\wc\0bad', 'https://example.test/svn/repo/tags/v1', 'msg')
    ).resolves.toMatchObject({
      success: false,
      error: 'Branch/tag source and destination must not contain control characters.',
    });
  });

  it('rejects existing branch or tag destinations before copying', async () => {
    mockState.runSvnText.mockResolvedValueOnce('existing target');

    const result = await copyRepositoryItem(
      'https://example.test/svn/repo/trunk',
      'https://example.test/svn/repo/tags/v1',
      'release v1'
    );

    expect(result).toEqual({
      success: false,
      revision: 0,
      error: 'Branch/tag destination already exists.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['copy']));
  });
});

describe('svn-repository-ops createRemoteFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('Committed revision 56.');
  });

  it('creates a remote folder with commit message, SSL trust, and credentials', async () => {
    const result = await createRemoteFolder(
      'https://example.test/svn/repo/trunk',
      'Feature Folder',
      'Add feature folder',
      { username: 'alice', password: 'secret' }
    );

    expect(result).toEqual({
      success: true,
      revision: 56,
      output: 'Committed revision 56.',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'mkdir',
      '-m',
      'Add feature folder',
      '--non-interactive',
      '--trust-server-cert-failures',
      'unknown-ca,cn-mismatch,expired,not-yet-valid',
      '--username',
      'alice',
      '--password',
      'secret',
      'https://example.test/svn/repo/trunk/Feature%20Folder',
    ]);
  });

  it('rejects invalid parent URLs, folder names, and missing messages', async () => {
    await expect(createRemoteFolder('not a url', 'src', 'msg')).resolves.toMatchObject({
      success: false,
      error: 'Remote folder parent must be a valid SVN URL.',
    });
    await expect(
      createRemoteFolder('https://example.test/svn/repo', 'nested/folder', 'msg')
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote folder name must be a single path segment without control characters.',
    });
    await expect(
      createRemoteFolder('https://example.test/svn/repo', 'src', '   ')
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote folder creation requires a log message.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });
});

describe('svn-repository-ops deleteRemoteItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('Committed revision 57.');
  });

  it('deletes a remote repository item with commit message and credentials', async () => {
    const result = await deleteRemoteItem('https://example.test/svn/repo/trunk/old', 'Remove old', {
      username: 'alice',
      password: 'secret',
    });

    expect(result).toEqual({
      success: true,
      revision: 57,
      output: 'Committed revision 57.',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'delete',
      '-m',
      'Remove old',
      '--non-interactive',
      '--trust-server-cert-failures',
      'unknown-ca,cn-mismatch,expired,not-yet-valid',
      '--username',
      'alice',
      '--password',
      'secret',
      'https://example.test/svn/repo/trunk/old',
    ]);
  });

  it('rejects invalid remote delete targets and missing messages', async () => {
    await expect(deleteRemoteItem('not a url', 'msg')).resolves.toMatchObject({
      success: false,
      error: 'Remote delete target must be a valid SVN URL.',
    });
    await expect(deleteRemoteItem('https://example.test/svn/repo/trunk/old', '   ')).resolves.toMatchObject({
      success: false,
      error: 'Remote delete requires a log message.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });
});

describe('svn-repository-ops moveRemoteItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('Committed revision 58.');
  });

  it('moves or renames a remote repository item with commit message and credentials', async () => {
    const result = await moveRemoteItem(
      'https://example.test/svn/repo/trunk/old',
      'https://example.test/svn/repo/trunk/new',
      'Rename old to new',
      { username: 'alice', password: 'secret' }
    );

    expect(result).toEqual({
      success: true,
      revision: 58,
      output: 'Committed revision 58.',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'move',
      '-m',
      'Rename old to new',
      '--non-interactive',
      '--trust-server-cert-failures',
      'unknown-ca,cn-mismatch,expired,not-yet-valid',
      '--username',
      'alice',
      '--password',
      'secret',
      'https://example.test/svn/repo/trunk/old',
      'https://example.test/svn/repo/trunk/new',
    ]);
  });

  it('rejects invalid move destinations and missing messages', async () => {
    await expect(
      moveRemoteItem('https://example.test/svn/repo/trunk/old', 'not a url', 'msg')
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote move destination must be a valid SVN URL.',
    });
    await expect(
      moveRemoteItem('https://example.test/svn/repo/trunk/old', 'https://example.test/svn/repo/trunk/new', '   ')
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote move requires a log message.',
    });
    await expect(
      moveRemoteItem(
        'https://example.test/svn/repo/trunk/old',
        'https://example.test/svn/repo/trunk/old',
        'msg'
      )
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote move destination must be different from the source.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });
});

describe('svn-repository-ops switch and relocate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches a whole working copy to a URL and optional revision', async () => {
    mockState.runSvnText.mockResolvedValue('Updated to revision 77.');

    const result = await switchWorkingCopy('C:\\wc', 'https://example.test/svn/repo/branches/a', '77');

    expect(result).toEqual({
      success: true,
      revision: 77,
      output: 'Updated to revision 77.',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'switch',
      'https://example.test/svn/repo/branches/a',
      'C:\\wc',
      '-r',
      '77',
    ]);
  });

  it('relocates a working copy between repository root URLs', async () => {
    mockState.runSvnText.mockResolvedValue('Relocated C:\\wc');

    const result = await relocateWorkingCopy(
      'https://old.example.test/svn/repo',
      'https://new.example.test/svn/repo',
      'C:\\wc'
    );

    expect(result).toEqual({ success: true, output: 'Relocated C:\\wc' });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'relocate',
      'https://old.example.test/svn/repo',
      'https://new.example.test/svn/repo',
      'C:\\wc',
    ]);
  });
});

describe('svn-repository-ops mergeRepositoryRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('C src/conflict.txt\nU src/app.ts');
  });

  it('supports ranges, dry-run preview, and merge options', async () => {
    const result = await mergeRepositoryRange(
      'https://example.test/svn/repo/branches/feature',
      'C:\\wc',
      ['155'],
      [{ start: 100, end: 150 }],
      {
        dryRun: true,
        depth: 'infinity',
        ignoreAncestry: true,
        allowMixedRevisions: true,
        onlyRecordMerge: true,
      }
    );

    expect(result).toEqual({ success: true, output: 'C src/conflict.txt\nU src/app.ts' });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'merge',
      '--dry-run',
      '--depth',
      'infinity',
      '--ignore-ancestry',
      '--allow-mixed-revisions',
      '--record-only',
      '-c',
      '155',
      '-r',
      '100:150',
      'https://example.test/svn/repo/branches/feature',
      'C:\\wc',
    ]);
  });
});

describe('svn-repository-ops resolveConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('');
  });

  it.each(['base', 'mine-full', 'theirs-full', 'mine-conflict', 'theirs-conflict'] as const)(
    'runs guided resolve with --accept %s',
    async (resolution) => {
      await expect(resolveConflict('C:\\wc\\conflict.txt', resolution)).resolves.toEqual({
        success: true,
      });

      expect(mockState.runSvnText).toHaveBeenCalledWith([
        'resolve',
        '--accept',
        resolution,
        'C:\\wc\\conflict.txt',
      ]);
    }
  );
});
