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

import { copyRepositoryItem } from '../svn-repository-ops';

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
