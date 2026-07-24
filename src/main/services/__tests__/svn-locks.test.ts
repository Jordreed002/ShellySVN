// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  executeHooksForType: vi.fn().mockResolvedValue({ allSucceeded: true }),
  getStore: vi.fn(),
  runSvnText: vi.fn(),
  getNetworkOptionsForWorkingCopyPath: vi.fn(),
  getWorkingCopyContext: vi.fn(),
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

vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForWorkingCopyPath: mockState.getNetworkOptionsForWorkingCopyPath,
}));
vi.mock('../svn-working-copy', () => ({
  getWorkingCopyContext: mockState.getWorkingCopyContext,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import { forceLock, forceUnlock, getLockInfo, listLocks, lock, unlock } from '../svn-locks';

describe('svn-locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getStore.mockRejectedValue(new Error('No store in unit test'));
    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.runSvnText.mockResolvedValue('ok');
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({ trustSslFailures: false });
    mockState.getWorkingCopyContext.mockResolvedValue({ workingCopyRoot: 'C:\\wc' });
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
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['lock', '-m', 'working', '--', 'C:\\wc\\file.txt'],
      { trustSslFailures: false }
    );
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['unlock', '--force', '--', 'C:\\wc\\file.txt'],
      {
        trustSslFailures: false,
      }
    );
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

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['lock', '--force', '-m', 'mine', '--', 'C:\\wc\\file.txt'],
      { trustSslFailures: false }
    );
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['unlock', '--force', '--', 'C:\\wc\\file.txt'],
      {
        trustSslFailures: false,
      }
    );
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

    await expect(listLocks('C:\\wc')).resolves.toEqual({
      locks: [
        {
          path: 'C:/wc/file.txt',
          owner: 'alice',
          comment: 'mine',
          date: '2026-04-29T08:00:00.000Z',
          token: 'token',
        },
      ],
    });
  });

  it('returns a structured lock-list error instead of a successful empty list', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('svn: E170013: Unable to connect'));
    await expect(listLocks('C:\\wc')).resolves.toMatchObject({
      locks: [],
      error: 'svn: E170013: Unable to connect',
      errorCode: 'E170013',
      commandError: {
        category: 'network',
        retryable: true,
      },
    });
  });

  it('distinguishes an unlocked path from a failed lock-info read', async () => {
    mockState.runSvnText.mockResolvedValueOnce(
      '<info><entry path="C:/wc/file.txt" revision="1"></entry></info>'
    );
    await expect(getLockInfo('C:\\wc\\file.txt')).resolves.toEqual({});

    mockState.runSvnText.mockRejectedValueOnce(new Error('svn: E170001: Authentication required'));
    await expect(getLockInfo('C:\\wc\\file.txt')).resolves.toMatchObject({
      errorCode: 'E170001',
      commandError: {
        command: 'info',
        target: 'C:\\wc\\file.txt',
        category: 'authentication',
      },
    });
  });

  it('passes working-copy-derived credentials and SSL trust to lock workflows', async () => {
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({
      credentials: { username: 'alice', password: 'secret' },
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
    });

    await lock('C:\\wc\\file.txt', 'working');

    expect(mockState.getNetworkOptionsForWorkingCopyPath).toHaveBeenCalledWith('C:\\wc\\file.txt');
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['lock', '-m', 'working', '--', 'C:\\wc\\file.txt'],
      {
        credentials: { username: 'alice', password: 'secret' },
        trustSslFailures: true,
        trustedSslFailures: 'unknown-ca',
      }
    );
  });
});
