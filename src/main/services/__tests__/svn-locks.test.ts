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

import {
  breakLock,
  forceLock,
  forceUnlock,
  getLockInfo,
  getLockRecord,
  listLocks,
  lock,
  setLockComment,
  stealLock,
  unlock,
} from '../svn-locks';

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

function lockXml(
  owner: string,
  options: { created?: string; expires?: string; comment?: string } = {}
): string {
  const { created = '2026-04-29T08:00:00.000Z', expires, comment = 'mine' } = options;
  return `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="C:/wc/file.txt" revision="1">
    <lock>
      <owner>${owner}</owner>
      <comment>${comment}</comment>
      <created>${created}</created>
      ${expires ? `<expires>${expires}</expires>` : ''}
      <token>token</token>
    </lock>
  </entry>
</info>`;
}

const UNLOCKED_XML = '<info><entry path="C:/wc/file.txt" revision="1"></entry></info>';

describe('svn-locks steal/break/comment (item 57)', () => {
  const LOCKED_FILE = 'C:\\wc\\file.txt';

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getStore.mockRejectedValue(new Error('No store in unit test'));
    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.runSvnText.mockResolvedValue('ok');
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({ trustSslFailures: false });
    mockState.getWorkingCopyContext.mockResolvedValue({ workingCopyRoot: 'C:\\wc' });
  });

  it('getLockRecord parses owner, comment, created, and expiry from info XML', async () => {
    mockState.runSvnText.mockResolvedValueOnce(
      lockXml('bob', { expires: '2027-04-29T08:00:00.000Z' })
    );

    await expect(getLockRecord(LOCKED_FILE)).resolves.toEqual({
      lock: {
        path: 'C:/wc/file.txt',
        owner: 'bob',
        comment: 'mine',
        date: '2026-04-29T08:00:00.000Z',
        token: 'token',
        expires: '2027-04-29T08:00:00.000Z',
      },
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith(['info', '--xml', '--', LOCKED_FILE]);
  });

  it('marks a lock whose expiry has passed as expired', async () => {
    mockState.runSvnText.mockResolvedValueOnce(
      lockXml('bob', { expires: '2020-04-29T08:00:00.000Z' })
    );
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({
      credentials: { username: 'alice', password: 'secret' },
    });

    await expect(getLockRecord(LOCKED_FILE)).resolves.toEqual({
      lock: expect.objectContaining({
        owner: 'bob',
        expires: '2020-04-29T08:00:00.000Z',
        expired: true,
        isOwner: false,
      }),
    });
  });

  it('returns an empty record when the path is unlocked', async () => {
    mockState.runSvnText.mockResolvedValueOnce(UNLOCKED_XML);
    await expect(getLockRecord(LOCKED_FILE)).resolves.toEqual({});
  });

  it('refuses to steal a lock without an explicit confirmation token', async () => {
    await expect(stealLock(LOCKED_FILE, 'taken over')).resolves.toMatchObject({
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
    });
    await expect(breakLock(LOCKED_FILE)).resolves.toMatchObject({
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('refuses when the confirmation token names a stale owner', async () => {
    mockState.runSvnText.mockResolvedValueOnce(lockXml('carol'));

    const result = await stealLock(LOCKED_FILE, undefined, {
      confirmed: true,
      confirmedOwner: 'bob',
    });

    expect(result).toMatchObject({
      success: false,
      reason: 'OWNER_CHANGED',
      lock: expect.objectContaining({ owner: 'carol' }),
    });
    // The unlock must not run against a lock the user never saw.
    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['info', '--xml', '--', LOCKED_FILE]);
  });

  it('steals a lock: force-unlocks the confirmed owner and re-locks with a comment', async () => {
    mockState.runSvnText
      .mockResolvedValueOnce(lockXml('bob')) // pre-read for owner warning
      .mockResolvedValueOnce('unlocked') // svn unlock --force
      .mockResolvedValueOnce('locked') // svn lock -m
      .mockResolvedValueOnce(lockXml('alice', { comment: 'taken over' })); // post-read

    const result = await stealLock(LOCKED_FILE, 'taken over', {
      confirmed: true,
      confirmedOwner: 'bob',
    });

    expect(result).toMatchObject({
      success: true,
      previousOwner: 'bob',
      lock: expect.objectContaining({ owner: 'alice', comment: 'taken over' }),
    });
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      2,
      ['unlock', '--force', '--', LOCKED_FILE],
      { trustSslFailures: false }
    );
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      3,
      ['lock', '-m', 'taken over', '--', LOCKED_FILE],
      { trustSslFailures: false }
    );
    expect(mockState.executeHooksForType).toHaveBeenCalledWith(
      [],
      'pre-unlock',
      expect.objectContaining({ force: true })
    );
    expect(mockState.executeHooksForType).toHaveBeenCalledWith(
      [],
      'pre-lock',
      expect.objectContaining({ force: true, message: 'taken over' })
    );
  });

  it('breaks a lock without re-locking it', async () => {
    mockState.runSvnText
      .mockResolvedValueOnce(lockXml('bob')) // pre-read for owner warning
      .mockResolvedValueOnce('unlocked');

    const result = await breakLock(LOCKED_FILE, { confirmed: true, confirmedOwner: 'bob' });

    expect(result).toEqual({ success: true, previousOwner: 'bob' });
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      2,
      ['unlock', '--force', '--', LOCKED_FILE],
      { trustSslFailures: false }
    );
    expect(mockState.runSvnText).toHaveBeenCalledTimes(2);
  });

  it('refuses to break a lock that does not exist', async () => {
    mockState.runSvnText.mockResolvedValueOnce(UNLOCKED_XML);

    await expect(
      breakLock(LOCKED_FILE, { confirmed: true, confirmedOwner: 'bob' })
    ).resolves.toMatchObject({ success: false, reason: 'NOT_LOCKED' });
    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
  });

  it('setLockComment updates the comment of the current user own lock', async () => {
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({
      credentials: { username: 'alice', password: 'secret' },
    });
    mockState.runSvnText
      .mockResolvedValueOnce(lockXml('alice')) // pre-read
      .mockResolvedValueOnce('locked') // svn lock --force -m
      .mockResolvedValueOnce(lockXml('alice', { comment: 'revised' })); // post-read

    const result = await setLockComment(LOCKED_FILE, 'revised');

    expect(result).toMatchObject({
      success: true,
      lock: expect.objectContaining({ owner: 'alice', comment: 'revised' }),
    });
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      2,
      ['lock', '--force', '-m', 'revised', '--', LOCKED_FILE],
      {
        credentials: { username: 'alice', password: 'secret' },
      }
    );
  });

  it('setLockComment refuses a foreign lock without owner confirmation', async () => {
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({
      credentials: { username: 'alice', password: 'secret' },
    });
    mockState.runSvnText.mockResolvedValueOnce(lockXml('bob'));

    const result = await setLockComment(LOCKED_FILE, 'revised');

    expect(result).toMatchObject({
      success: false,
      reason: 'FOREIGN_LOCK',
      lock: expect.objectContaining({ owner: 'bob' }),
    });
    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
  });

  it('setLockComment requires confirmation when ownership cannot be proven', async () => {
    mockState.runSvnText.mockResolvedValueOnce(lockXml('bob'));

    const result = await setLockComment(LOCKED_FILE, 'revised');

    expect(result).toMatchObject({
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
      lock: expect.objectContaining({ owner: 'bob' }),
    });
    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
  });

  it('setLockComment proceeds for a foreign lock with a matching confirmation', async () => {
    mockState.runSvnText
      .mockResolvedValueOnce(lockXml('bob')) // pre-read
      .mockResolvedValueOnce('locked') // svn lock --force -m
      .mockResolvedValueOnce(lockXml('alice', { comment: 'taken' })); // post-read

    const result = await setLockComment(LOCKED_FILE, 'taken', {
      confirmed: true,
      confirmedOwner: 'bob',
    });

    expect(result).toMatchObject({ success: true, previousOwner: 'bob' });
    expect(mockState.runSvnText).toHaveBeenNthCalledWith(
      2,
      ['lock', '--force', '-m', 'taken', '--', LOCKED_FILE],
      { trustSslFailures: false }
    );
  });

  it('setLockComment refuses an unlocked path', async () => {
    mockState.runSvnText.mockResolvedValueOnce(UNLOCKED_XML);

    await expect(setLockComment(LOCKED_FILE, 'revised')).resolves.toMatchObject({
      success: false,
      reason: 'NOT_LOCKED',
    });
  });

  it('listLocks exposes repository lock expiry and expired state', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="C:/wc">
    <entry path="C:/wc/file.txt">
      <repos-status props="none" item="none">
        <lock>
          <owner>bob</owner>
          <comment>mine</comment>
          <creationdate>2026-04-29T08:00:00.000Z</creationdate>
          <expirationdate>2020-04-29T08:00:00.000Z</expirationdate>
          <token>token</token>
        </lock>
      </repos-status>
    </entry>
    <entry path="C:/wc/other.txt">
      <wc-status item="normal">
        <lock>
          <owner>alice</owner>
          <comment></comment>
          <creationdate>2026-04-29T08:00:00.000Z</creationdate>
          <token>token-2</token>
        </lock>
      </wc-status>
    </entry>
  </target>
</status>`);

    await expect(listLocks('C:\\wc')).resolves.toEqual({
      locks: [
        {
          path: 'C:/wc/file.txt',
          owner: 'bob',
          comment: 'mine',
          date: '2026-04-29T08:00:00.000Z',
          token: 'token',
          expires: '2020-04-29T08:00:00.000Z',
          expired: true,
        },
        {
          path: 'C:/wc/other.txt',
          owner: 'alice',
          comment: '',
          date: '2026-04-29T08:00:00.000Z',
          token: 'token-2',
        },
      ],
    });
  });
});
