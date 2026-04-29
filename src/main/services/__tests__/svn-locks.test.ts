// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  executeHooksForType: vi.fn().mockResolvedValue({ allSucceeded: true }),
  getStore: vi.fn(),
  runSvnText: vi.fn(),
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

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import { forceLock, forceUnlock, listLocks, lock, unlock } from '../svn-locks';

describe('svn-locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getStore.mockRejectedValue(new Error('No store in unit test'));
    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.runSvnText.mockResolvedValue('ok');
  });

  it('runs lock and unlock commands with configured pre-hooks', async () => {
    await expect(lock('C:\\wc\\file.txt', 'working')).resolves.toEqual({
      success: true,
      output: 'ok',
    });
    await expect(unlock('C:\\wc\\file.txt', true)).resolves.toEqual({
      success: true,
      output: 'ok',
    });

    expect(mockState.executeHooksForType).toHaveBeenCalledWith(
      [],
      'pre-lock',
      expect.objectContaining({ workingCopyPath: 'C:\\wc', files: ['C:\\wc\\file.txt'] })
    );
    expect(mockState.executeHooksForType).toHaveBeenCalledWith(
      [],
      'pre-unlock',
      expect.objectContaining({ workingCopyPath: 'C:\\wc', files: ['C:\\wc\\file.txt'] })
    );
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'lock',
      '-m',
      'working',
      'C:\\wc\\file.txt',
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['unlock', '--force', 'C:\\wc\\file.txt']);
  });

  it('runs force lock and force unlock workflows', async () => {
    mockState.runSvnText.mockResolvedValueOnce('locked');
    mockState.runSvnText.mockResolvedValueOnce(`<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="C:/wc/file.txt" revision="1">
    <lock>
      <owner>alice</owner>
      <comment>mine</comment>
      <creationdate>2026-04-29T08:00:00.000Z</creationdate>
      <token>token</token>
    </lock>
  </entry>
</info>`);
    mockState.runSvnText.mockResolvedValueOnce('unlocked');

    await expect(forceLock('C:\\wc\\file.txt', 'mine')).resolves.toMatchObject({
      success: true,
      lock: { owner: 'alice', comment: 'mine' },
    });
    await expect(forceUnlock('C:\\wc\\file.txt')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'lock',
      '--force',
      '-m',
      'mine',
      'C:\\wc\\file.txt',
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['unlock', '--force', 'C:\\wc\\file.txt']);
  });

  it('lists locks from SVN status XML', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="C:/wc">
    <entry path="C:/wc/file.txt">
      <wc-status item="modified">
        <lock>
          <owner>alice</owner>
          <comment>mine</comment>
          <creationdate>2026-04-29T08:00:00.000Z</creationdate>
          <token>token</token>
        </lock>
      </wc-status>
    </entry>
  </target>
</status>`);

    await expect(listLocks('C:\\wc')).resolves.toEqual([
      {
        path: 'C:/wc/file.txt',
        owner: 'alice',
        comment: 'mine',
        date: '2026-04-29T08:00:00.000Z',
        token: 'token',
      },
    ]);
  });
});
