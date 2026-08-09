// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  getWorkingCopyContext: vi.fn(),
  getNetworkOptionsForUrl: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-progress', () => ({
  runSvnOperationWithProgress: vi.fn(),
}));
vi.mock('../svn-working-copy', () => ({
  getWorkingCopyContext: mockState.getWorkingCopyContext,
}));
vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForUrl: mockState.getNetworkOptionsForUrl,
  getNetworkOptionsForWorkingCopyPath: vi.fn().mockResolvedValue({ trustSslFailures: false }),
}));
vi.mock('../svn-mutation-queue', () => ({
  runSerializedWorkingCopyMutation: vi.fn(async (_key: string, task: () => Promise<unknown>) =>
    task()
  ),
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

function infoXml(
  url: string,
  uuid = 'repo-uuid',
  root = 'https://example.test/svn/repo',
  kind: 'file' | 'dir' = 'dir'
): string {
  return `<info><entry kind="${kind}" path="target" revision="41"><url>${url}</url><repository><root>${root}</root><uuid>${uuid}</uuid></repository></entry></info>`;
}

function isCreatedDestination(target: string): boolean {
  return /\/(?:feature|v1|Feature%20Folder|new)$/.test(target);
}

describe('svn-repository-ops copyRepositoryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'info' && isCreatedDestination(args.at(-1) || '')) {
        throw new Error('not found');
      }
      if (args[0] === 'info') return infoXml(args.at(-1) || '');
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
      '--non-interactive',
      '--',
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
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'info') return infoXml(args.at(-1) || '');
      return 'Committed revision 42.';
    });

    const result = await copyRepositoryItem(
      'https://example.test/svn/repo/trunk',
      'https://example.test/svn/repo/tags/v1',
      'release v1'
    );

    expect(result).toEqual({
      success: false,
      revision: null,
      error: 'Branch/tag destination already exists.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['copy']));
  });

  it('does not mistake authentication failures for a missing copy destination', async () => {
    mockState.runSvnText.mockRejectedValueOnce(new Error('svn: E215004: Authentication failed'));

    await expect(
      copyRepositoryItem(
        'https://example.test/svn/repo/trunk',
        'https://example.test/svn/repo/tags/v1',
        'release v1'
      )
    ).rejects.toThrow('Authentication failed');
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['copy']));
  });

  it('rejects copies whose source and destination parent have different repository UUIDs', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      const target = args.at(-1) || '';
      if (args[0] === 'info' && target.endsWith('/trunk')) return infoXml(target, 'source-uuid');
      if (args[0] === 'info') return infoXml(target, 'destination-uuid');
      return 'Committed revision 42.';
    });

    await expect(
      copyRepositoryItem(
        'https://example.test/svn/repo/trunk',
        'https://example.test/svn/repo/tags/v1',
        'release v1'
      )
    ).resolves.toMatchObject({
      success: false,
      error: 'Branch/tag copy source and destination must belong to the same repository.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['copy']));
  });

  it('reports a missing copy source before invoking copy', async () => {
    mockState.runSvnText.mockRejectedValueOnce(new Error('svn: E160013: path not found'));

    await expect(
      copyRepositoryItem(
        'https://example.test/svn/repo/missing',
        'https://example.test/svn/repo/tags/v1',
        'release v1'
      )
    ).rejects.toThrow('Branch/tag source does not exist.');
  });

  it('preserves source peg revisions and encoded destination-parent segments', async () => {
    await copyRepositoryItem(
      'https://example.test/svn/repo/trunk@41',
      'https://example.test/svn/repo/branches/Feature%20Space/new',
      'copy historical trunk'
    );

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'info',
        '--xml',
        '--non-interactive',
        '--',
        'https://example.test/svn/repo/branches/Feature%20Space',
      ],
      { credentials: undefined }
    );
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'copy',
      '-m',
      'copy historical trunk',
      '--non-interactive',
      '--',
      'https://example.test/svn/repo/trunk@41',
      'https://example.test/svn/repo/branches/Feature%20Space/new',
    ]);
  });
});

describe('svn-repository-ops createRemoteFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'info' && args.at(-1)?.endsWith('/Feature%20Folder')) {
        throw new Error('svn: E160013: path not found');
      }
      if (args[0] === 'info') return infoXml(args.at(-1) || '');
      return 'Committed revision 56.';
    });
  });

  it('creates a remote folder with commit message and executor credentials', async () => {
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
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'mkdir',
        '-m',
        'Add feature folder',
        '--non-interactive',
        '--',
        'https://example.test/svn/repo/trunk/Feature%20Folder',
      ],
      { credentials: { username: 'alice', password: 'secret' } }
    );
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

  it('verifies the parent and destination using the mutation credentials', async () => {
    const credentials = { username: 'alice', password: 'secret' };
    await createRemoteFolder(
      'https://example.test/svn/repo/trunk',
      'Feature Folder',
      'Add feature folder',
      credentials
    );

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['info', '--xml', '--non-interactive', '--', 'https://example.test/svn/repo/trunk'],
      { credentials }
    );
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'info',
        '--xml',
        '--non-interactive',
        '--',
        'https://example.test/svn/repo/trunk/Feature%20Folder',
      ],
      { credentials }
    );
  });
});

describe('svn-repository-ops deleteRemoteItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'info') return infoXml(args.at(-1) || '');
      return 'Committed revision 57.';
    });
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
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'delete',
        '-m',
        'Remove old',
        '--non-interactive',
        '--',
        'https://example.test/svn/repo/trunk/old',
      ],
      { credentials: { username: 'alice', password: 'secret' } }
    );
  });

  it('rejects invalid remote delete targets and missing messages', async () => {
    await expect(deleteRemoteItem('not a url', 'msg')).resolves.toMatchObject({
      success: false,
      error: 'Remote delete target must be a valid SVN URL.',
    });
    await expect(
      deleteRemoteItem('https://example.test/svn/repo/trunk/old', '   ')
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote delete requires a log message.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });
});

describe('svn-repository-ops moveRemoteItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'info' && args.at(-1)?.endsWith('/new')) {
        throw new Error('svn: E160013: path not found');
      }
      if (args[0] === 'info') return infoXml(args.at(-1) || '');
      return 'Committed revision 58.';
    });
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
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'move',
        '-m',
        'Rename old to new',
        '--non-interactive',
        '--',
        'https://example.test/svn/repo/trunk/old',
        'https://example.test/svn/repo/trunk/new',
      ],
      { credentials: { username: 'alice', password: 'secret' } }
    );
  });

  it('rejects invalid move destinations and missing messages', async () => {
    await expect(
      moveRemoteItem('https://example.test/svn/repo/trunk/old', 'not a url', 'msg')
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote move destination must be a valid SVN URL.',
    });
    await expect(
      moveRemoteItem(
        'https://example.test/svn/repo/trunk/old',
        'https://example.test/svn/repo/trunk/new',
        '   '
      )
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

  it('rejects a cross-repository move before invoking svn move', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      const target = args.at(-1) || '';
      if (args[0] === 'info' && target.endsWith('/old')) return infoXml(target, 'source-uuid');
      if (args[0] === 'info') return infoXml(target, 'destination-uuid');
      return 'Committed revision 58.';
    });

    await expect(
      moveRemoteItem(
        'https://example.test/svn/repo/trunk/old',
        'https://mirror.example.test/svn/other/trunk/new',
        'Move item'
      )
    ).resolves.toMatchObject({
      success: false,
      error: 'Remote move source and destination must belong to the same repository.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['move']));
  });
});

describe('svn-repository-ops switch and relocate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches a whole working copy to a URL and optional revision', async () => {
    mockState.runSvnText.mockResolvedValue('Updated to revision 77.');

    const result = await switchWorkingCopy(
      'C:\\wc',
      'https://example.test/svn/repo/branches/a',
      '77'
    );

    expect(result).toEqual({
      success: true,
      revision: 77,
      output: 'Updated to revision 77.',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'switch',
      '-r',
      '77',
      '--',
      'https://example.test/svn/repo/branches/a',
      'C:\\wc',
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
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'relocate',
        '--',
        'https://old.example.test/svn/repo',
        'https://new.example.test/svn/repo',
        'C:\\wc',
      ],
      { trustSslFailures: false }
    );
  });
});

describe('svn-repository-ops mergeRepositoryRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getWorkingCopyContext.mockResolvedValue({ workingCopyRoot: 'C:\\wc' });
    mockState.getNetworkOptionsForUrl.mockResolvedValue({ trustSslFailures: false });
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
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
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
        '--',
        'https://example.test/svn/repo/branches/feature',
        'C:\\wc',
      ],
      { trustSslFailures: false }
    );
  });

  it('rejects a merge target that is not a working copy before mutation', async () => {
    mockState.getWorkingCopyContext.mockResolvedValue(null);
    await expect(
      mergeRepositoryRange('https://example.test/svn/repo/branches/feature', 'C:\\plain')
    ).rejects.toThrow(/valid svn working copy/i);
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('builds SVN two-source merge form without cherry-pick options', async () => {
    await mergeRepositoryRange(
      'https://example.test/svn/repo/vendor/old',
      'C:\\wc',
      undefined,
      undefined,
      { secondSource: 'https://example.test/svn/repo/vendor/new' }
    );

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'merge',
        '--',
        'https://example.test/svn/repo/vendor/old',
        'https://example.test/svn/repo/vendor/new',
        'C:\\wc',
      ],
      { trustSslFailures: false }
    );
  });

  it('rejects revision ranges mixed with SVN two-source merge form', async () => {
    await expect(
      mergeRepositoryRange('https://example.test/svn/repo/vendor/old', 'C:\\wc', ['5'], undefined, {
        secondSource: 'https://example.test/svn/repo/vendor/new',
      })
    ).rejects.toThrow(/cannot also specify/i);
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

      expect(mockState.runSvnText).toHaveBeenCalledWith(
        ['resolve', '--accept', resolution, '--', 'C:\\wc\\conflict.txt'],
        { trustSslFailures: false }
      );
    }
  );

  it('uses the working file for manual merges and rejects a still-conflicted result', async () => {
    mockState.runSvnText
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(
        '<?xml version="1.0"?><status><target path="C:\\wc"><entry path="C:\\wc\\conflict.txt"><wc-status item="conflicted" /></entry></target></status>'
      );

    await expect(resolveConflict('C:\\wc\\conflict.txt', 'working')).rejects.toThrow(
      /still reports an unresolved conflict/i
    );
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      1,
      ['resolve', '--accept', 'working', '--', 'C:\\wc\\conflict.txt'],
      { trustSslFailures: false }
    );
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      2,
      ['status', '--xml', '--', 'C:\\wc\\conflict.txt'],
      { trustSslFailures: false }
    );
  });
});
