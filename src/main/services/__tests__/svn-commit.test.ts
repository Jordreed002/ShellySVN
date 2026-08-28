// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  executeHooksForType: vi.fn().mockResolvedValue({ allSucceeded: true }),
  getStore: vi.fn(),
  runSvnText: vi.fn(),
  runSvnOperationWithProgress: vi.fn(),
  getNetworkOptionsForWorkingCopyPath: vi.fn(),
}));

vi.mock('../../hooks/HookExecutor', () => ({
  executeHooksForType: mockState.executeHooksForType,
}));

vi.mock('../../ipc/store', () => ({
  getStore: mockState.getStore,
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-progress', () => ({
  runSvnOperationWithProgress: mockState.runSvnOperationWithProgress,
}));

vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForWorkingCopyPath: mockState.getNetworkOptionsForWorkingCopyPath,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import { commit, commitWithProgress } from '../svn-commit';

describe('svn-commit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getStore.mockRejectedValue(new Error('No store in unit test'));
    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.runSvnText.mockResolvedValue('Committed revision 123.');
    mockState.runSvnOperationWithProgress.mockResolvedValue({
      success: true,
      revision: 123,
      output: 'Committed revision 123.',
    });
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({ trustSslFailures: false });
  });

  it('strips null bytes before passing commit messages to hooks and svn', async () => {
    const result = await commit(['C:\\wc\\file.txt'], 'fix\0: message');

    expect(result).toEqual({ success: true, revision: 123 });
    expect(mockState.executeHooksForType).toHaveBeenCalledWith(
      [],
      'start-commit',
      expect.objectContaining({ message: 'fix: message' })
    );
    expect(mockState.executeHooksForType).toHaveBeenCalledWith(
      [],
      'pre-commit',
      expect.objectContaining({ message: 'fix: message' })
    );
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['commit', '-m', 'fix: message', '--', 'C:\\wc\\file.txt'],
      { trustSslFailures: false }
    );
  });

  it('uses sanitized messages for progress commits', async () => {
    const event = { sender: { send: vi.fn() } } as never;

    await commitWithProgress(event, 'commit-1', ['C:\\wc\\file.txt'], 'feat\0: progress');

    expect(mockState.runSvnOperationWithProgress).toHaveBeenCalledWith(
      event,
      'commit-1',
      'commit',
      ['commit', '-m', 'feat: progress', '--', 'C:\\wc\\file.txt'],
      { trustSslFailures: false }
    );
  });

  it('adds selected unversioned targets before a normal commit', async () => {
    const folder = 'C:\\wc\\assets\\icons\\social';
    const child = `${folder}\\mastodon.svg`;

    const result = await commit(
      ['C:\\wc\\tracked.css', folder, child],
      'add social icons',
      [folder, child]
    );

    expect(result).toEqual({ success: true, revision: 123 });
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(1, [
      'add',
      '--parents',
      '--',
      folder,
    ]);
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      2,
      ['commit', '-m', 'add social icons', '--', 'C:\\wc\\tracked.css', folder, child],
      { trustSslFailures: false }
    );
  });

  it('adds unversioned targets before a progress commit', async () => {
    const event = { sender: { send: vi.fn() } } as never;
    const newFile = 'C:\\wc\\new.txt';

    await commitWithProgress(event, 'commit-add-1', [newFile], 'add file', [newFile]);

    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'add',
      '--parents',
      '--',
      newFile,
    ]);
    expect(mockState.runSvnText.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.runSvnOperationWithProgress.mock.invocationCallOrder[0]
    );
  });

  it('does not commit when scheduling an unversioned target fails', async () => {
    const newFile = 'C:\\wc\\new.txt';
    mockState.runSvnText.mockRejectedValueOnce(new Error('svn add failed'));

    await expect(commit([newFile], 'add file', [newFile])).rejects.toThrow('svn add failed');

    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
  });

  it('rejects unversioned targets outside the selected commit paths', async () => {
    await expect(
      commit(['C:\\wc\\tracked.txt'], 'invalid add', ['C:\\wc\\other.txt'])
    ).rejects.toThrow('must also be selected');
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('runs start, pre, svn, and post commit in order', async () => {
    const hooks = [
      { id: 'start', name: 'Start', type: 'start-commit', enabled: true },
      { id: 'pre', name: 'Pre', type: 'pre-commit', enabled: true },
      { id: 'post', name: 'Post', type: 'post-commit', enabled: true },
    ];
    const store = {
      get: vi.fn().mockResolvedValue({ 'C:\\wc\\file.txt': hooks }),
    };
    mockState.getStore.mockResolvedValue(store);
    const order: string[] = [];

    mockState.executeHooksForType.mockImplementation(async (_hooks, type) => {
      order.push(type);
      return { allSucceeded: true };
    });
    mockState.runSvnText.mockImplementation(async () => {
      order.push('svn');
      return 'Committed revision 124.';
    });

    const result = await commit(['C:\\wc\\file.txt'], 'ordered commit');

    expect(result).toEqual({ success: true, revision: 124 });
    expect(order).toEqual(['start-commit', 'pre-commit', 'svn', 'post-commit']);
    expect(mockState.executeHooksForType).toHaveBeenNthCalledWith(
      1,
      hooks,
      'start-commit',
      expect.objectContaining({ workingCopyPath: 'C:\\wc\\file.txt' })
    );
  });

  it('returns blocking hook output before invoking svn', async () => {
    mockState.executeHooksForType.mockResolvedValueOnce({
      allSucceeded: false,
      error: 'Hook rejected commit: run formatter',
    });

    const result = await commit(['C:\\wc\\file.txt'], 'blocked commit');

    expect(result).toEqual({
      success: false,
      error: 'Hook rejected commit: run formatter',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('passes working-copy-derived credentials and SSL trust to commit commands', async () => {
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({
      credentials: { username: 'alice', password: 'secret' },
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
    });

    await commit(['C:\\wc\\file.txt'], 'networked commit');

    expect(mockState.getNetworkOptionsForWorkingCopyPath).toHaveBeenCalledWith('C:\\wc\\file.txt');
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['commit', '-m', 'networked commit', '--', 'C:\\wc\\file.txt'],
      {
        credentials: { username: 'alice', password: 'secret' },
        trustSslFailures: true,
        trustedSslFailures: 'unknown-ca',
      }
    );
  });
});
