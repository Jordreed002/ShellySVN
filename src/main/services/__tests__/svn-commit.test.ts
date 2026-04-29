// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  executeHooksForType: vi.fn().mockResolvedValue({ allSucceeded: true }),
  getStore: vi.fn(),
  runSvnText: vi.fn(),
  runSvnOperationWithProgress: vi.fn(),
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
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'commit',
      '-m',
      'fix: message',
      'C:\\wc\\file.txt',
    ]);
  });

  it('uses sanitized messages for progress commits', async () => {
    const event = { sender: { send: vi.fn() } } as never;

    await commitWithProgress(event, 'commit-1', ['C:\\wc\\file.txt'], 'feat\0: progress');

    expect(mockState.runSvnOperationWithProgress).toHaveBeenCalledWith(event, 'commit-1', 'commit', [
      'commit',
      '-m',
      'feat: progress',
      'C:\\wc\\file.txt',
    ]);
  });
});
