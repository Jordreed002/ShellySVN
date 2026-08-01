// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
  runSvnText: vi.fn(),
  getWorkerSvnStatus: vi.fn(),
  trashItem: vi.fn().mockResolvedValue(undefined),
  sslReady: vi.fn().mockResolvedValue(undefined),
  sslFindForUrl: vi.fn(),
  existsSync: vi.fn(),
  executeHooksForType: vi.fn(),
}));

vi.mock('electron', () => ({ shell: { trashItem: mockState.trashItem } }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockState.existsSync,
  };
});

vi.mock('../svn-executor', () => ({
  DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES: 1024 * 1024,
  runSvn: mockState.runSvn,
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-status-worker', () => ({
  getWorkerSvnStatus: mockState.getWorkerSvnStatus,
}));

vi.mock('../../ipc/store', () => ({
  getStore: vi.fn(),
}));

vi.mock('../../auth-cache', () => ({
  getAuthCache: vi.fn(),
}));

vi.mock('../../hooks/HookExecutor', () => ({
  executeHooksForType: mockState.executeHooksForType,
}));

vi.mock('../../ssl-trust-cache', () => ({
  getSslTrustCache: () => ({
    ready: mockState.sslReady,
    findForUrl: mockState.sslFindForUrl,
  }),
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  classifyWorkingCopyUpgradeError,
  copy,
  cleanup,
  excludeFromWorkingCopy,
  previewCleanup,
  previewRevert,
  getRemoteStatus,
  getStatus,
  getWorkingCopyContext,
  getWorkingCopyUpgradeStatus,
  remove,
  revert,
  updateToRevision,
  updateWithProgress,
  upgradeWorkingCopy,
} from '../svn-working-copy';
import { getAuthCache } from '../../auth-cache';

describe('svn-working-copy structured read failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('catches asynchronous status rejection and preserves its SVN code', async () => {
    mockState.getWorkerSvnStatus.mockRejectedValue(
      new Error('svn: E155007: is not a working copy')
    );
    await expect(getStatus('C:\\not-a-wc')).resolves.toMatchObject({
      path: 'C:\\not-a-wc',
      entries: [],
      errorCode: 'E155007',
      error: 'svn: E155007: is not a working copy',
    });
  });
});

describe('working-copy URL mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existsSync.mockReturnValue(false);
  });

  // These tests express paths in SVN's canonical forward-slash form. On
  // Windows, getWorkingCopyContext canonicalizes them to backslashes before
  // invoking svn, so the mock matches on a normalized target and assertions
  // convert expected local paths to the host separator.
  const isWin = process.platform === 'win32';
  const host = (p: string) => (isWin ? p.replace(/\//g, '\\') : p);
  const normTarget = (t: string | undefined) => (t ?? '').replace(/\\/g, '/');

  it('anchors a sparse target at the nearest switched versioned ancestor', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      const target = normTarget(args.at(-1));
      if (target === '/wc/switched/new folder') {
        throw new Error('svn: E155010: The node was not found');
      }
      if (target === '/wc/switched') {
        return [
          '<info><entry path="/wc/switched" revision="8" kind="dir">',
          '<url>https://svn.example.com/repo/branches/release</url>',
          '<repository><root>https://svn.example.com/repo</root><uuid>repo-1</uuid></repository>',
          '<wc-info><wcroot-abspath>/wc</wcroot-abspath></wc-info>',
          '</entry></info>',
        ].join('');
      }
      throw new Error('unexpected target');
    });

    await expect(getWorkingCopyContext('/wc/switched/new folder')).resolves.toEqual({
      workingCopyRoot: host('/wc'),
      repositoryRoot: 'https://svn.example.com/repo',
      repositoryUuid: 'repo-1',
      url: 'https://svn.example.com/repo/branches/release/new%20folder',
      localPath: host('/wc/switched/new folder'),
      nearestVersionedPath: host('/wc/switched'),
      nearestVersionedUrl: 'https://svn.example.com/repo/branches/release',
      derived: true,
    });
  });

  it('maps Windows paths case-insensitively and preserves Unicode URL segments', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      const target = args.at(-1);
      if (target === 'C:\\WC\\Switch\\日本 語') throw new Error('sparse target');
      if (target === 'C:\\WC\\Switch') {
        return [
          '<info><entry path="C:\\WC\\Switch" revision="8" kind="dir">',
          '<url>https://svn.example.com/repo/branches/release</url>',
          '<repository><root>https://svn.example.com/repo</root><uuid>repo-1</uuid></repository>',
          '<wc-info><wcroot-abspath>c:\\wc</wcroot-abspath></wc-info>',
          '</entry></info>',
        ].join('');
      }
      throw new Error(`unexpected target: ${target}`);
    });

    const context = await getWorkingCopyContext('C:\\WC\\Switch\\日本 語');

    expect(context).toMatchObject({
      workingCopyRoot: 'c:\\wc',
      url: 'https://svn.example.com/repo/branches/release/%E6%97%A5%E6%9C%AC%20%E8%AA%9E',
      nearestVersionedPath: 'C:\\WC\\Switch',
      derived: true,
    });
  });

  it('supports UNC working-copy roots without accepting sibling prefixes', async () => {
    mockState.runSvnText.mockResolvedValue(
      [
        '<info><entry path="\\\\server\\share\\wc\\folder" revision="8" kind="dir">',
        '<url>https://svn.example.com/repo/trunk/folder</url>',
        '<repository><root>https://svn.example.com/repo</root><uuid>repo-1</uuid></repository>',
        '<wc-info><wcroot-abspath>\\\\server\\share\\wc</wcroot-abspath></wc-info>',
        '</entry></info>',
      ].join('')
    );

    await expect(getWorkingCopyContext('\\\\server\\share\\wc\\folder')).resolves.toMatchObject({
      workingCopyRoot: '\\\\server\\share\\wc',
      url: 'https://svn.example.com/repo/trunk/folder',
      derived: false,
    });
  });

  it('uses a nested external as an explicit cross-repository mapping anchor', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      const target = normTarget(args.at(-1));
      if (target === '/wc/vendor/library/new.ts') throw new Error('sparse target');
      if (target === '/wc/vendor/library') {
        return [
          '<info><entry path="/wc/vendor/library" revision="3" kind="dir">',
          '<url>https://external.example.com/library/trunk</url>',
          '<repository><root>https://external.example.com/library</root>',
          '<uuid>external-repo</uuid></repository>',
          '<wc-info><wcroot-abspath>/wc/vendor/library</wcroot-abspath></wc-info>',
          '</entry></info>',
        ].join('');
      }
      throw new Error(`unexpected target: ${target}`);
    });

    await expect(getWorkingCopyContext('/wc/vendor/library/new.ts')).resolves.toMatchObject({
      workingCopyRoot: host('/wc/vendor/library'),
      repositoryRoot: 'https://external.example.com/library',
      repositoryUuid: 'external-repo',
      url: 'https://external.example.com/library/trunk/new.ts',
      nearestVersionedPath: host('/wc/vendor/library'),
      derived: true,
    });
  });
});

describe('svn-working-copy local copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('A         C:\\wc\\copy.txt');
  });

  it('schedules a history-preserving working-copy copy without a log message', async () => {
    await expect(copy('C:\\wc\\source@name.txt', 'C:\\wc\\copy.txt')).resolves.toEqual({
      success: true,
      output: 'A         C:\\wc\\copy.txt',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'copy',
      '--',
      'C:\\wc\\source@name.txt@',
      'C:\\wc\\copy.txt',
    ]);
  });
});

describe('svn-working-copy revert depth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('Reverted');
  });

  it.each(['empty', 'files', 'immediates', 'infinity'] as const)(
    'passes explicit %s depth after options and before protected targets',
    async (depth) => {
      await expect(revert(['--force'], depth)).resolves.toEqual({ success: true });
      expect(mockState.runSvnText).toHaveBeenCalledWith([
        'revert',
        '--depth',
        depth,
        '--',
        '--force',
      ]);
    }
  );

  it('previews only status entries that revert can affect', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0"?><status><target path="wc">
      <entry path="wc/modified.txt"><wc-status item="modified" /></entry>
      <entry path="wc/added.txt"><wc-status item="added" /></entry>
      <entry path="wc/normal.txt"><wc-status item="normal" /></entry>
      <entry path="wc/unversioned.txt"><wc-status item="unversioned" /></entry>
    </target></status>`);

    await expect(previewRevert(['wc'], 'immediates')).resolves.toEqual({
      depth: 'immediates',
      paths: ['wc/added.txt', 'wc/modified.txt'],
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'status',
      '--xml',
      '--depth',
      'immediates',
      '--',
      'wc',
    ]);
  });
});

describe('svn-working-copy sparse exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('Updated to revision 42.');
    mockState.existsSync.mockReturnValue(false);
  });

  it('sets sticky exclude depth without scheduling repository deletion', async () => {
    await expect(excludeFromWorkingCopy('/wc/generated')).resolves.toEqual({ success: true });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'update',
      '--set-depth',
      'exclude',
      '--',
      '/wc/generated',
    ]);
    expect(mockState.trashItem).not.toHaveBeenCalled();
  });

  it('removes a whole selection of files and folders in one command', async () => {
    await expect(excludeFromWorkingCopy(['/wc/generated', '/wc/notes.txt'])).resolves.toEqual({
      success: true,
    });

    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'update',
      '--set-depth',
      'exclude',
      '--',
      '/wc/generated',
      '/wc/notes.txt',
    ]);
  });

  it('refuses an empty selection instead of running svn with no target', async () => {
    await expect(excludeFromWorkingCopy([])).resolves.toEqual({
      success: false,
      error: 'Nothing selected to remove from the working copy',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('trashes every selected leftover, not just the first', async () => {
    mockState.existsSync.mockReturnValue(true);

    await expect(excludeFromWorkingCopy(['/wc/a', '/wc/b'])).resolves.toEqual({ success: true });

    expect(mockState.trashItem).toHaveBeenCalledWith('/wc/a');
    expect(mockState.trashItem).toHaveBeenCalledWith('/wc/b');
  });

  it('moves a folder left behind by unversioned content to the OS trash', async () => {
    mockState.existsSync.mockReturnValue(true);

    await expect(excludeFromWorkingCopy('/wc/generated')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalled();
    expect(mockState.trashItem).toHaveBeenCalledWith('/wc/generated');
    expect(mockState.runSvnText.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.trashItem.mock.invocationCallOrder[0]
    );
  });

  it('does not remove the local folder when SVN exclusion fails', async () => {
    mockState.existsSync.mockReturnValue(true);
    mockState.runSvnText.mockRejectedValue(new Error('local modifications prevent exclusion'));

    await expect(excludeFromWorkingCopy('/wc/generated')).resolves.toEqual({
      success: false,
      error: 'local modifications prevent exclusion',
    });

    expect(mockState.trashItem).not.toHaveBeenCalled();
  });

  it('reports when SVN exclusion succeeds but trashing residual files fails', async () => {
    mockState.existsSync.mockReturnValue(true);
    mockState.trashItem.mockRejectedValueOnce(new Error('trash unavailable'));

    await expect(excludeFromWorkingCopy('/wc/generated')).resolves.toEqual({
      success: false,
      error:
        'SVN excluded the selection, but remaining local files could not be moved to the trash: trash unavailable',
    });
  });
});

describe('svn-working-copy cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('');
  });

  it('passes advanced cleanup options explicitly', async () => {
    await cleanup('C:\\wc', {
      removeUnversioned: true,
      removeIgnored: true,
      vacuumPristines: true,
      includeExternals: true,
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'cleanup',
      '--remove-unversioned',
      '--remove-ignored',
      '--vacuum-pristines',
      '--include-externals',
      '--',
      'C:\\wc',
    ]);
  });

  it('previews exact unversioned and ignored cleanup targets', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0"?>
<status><target path="C:/wc">
  <entry path="C:/wc/tmp.txt"><wc-status item="unversioned" props="none"/></entry>
  <entry path="C:/wc/build"><wc-status item="ignored" props="none"/></entry>
  <entry path="C:/wc/tracked.txt"><wc-status item="modified" props="none"/></entry>
</target></status>`);
    await expect(previewCleanup('C:\\wc')).resolves.toEqual({
      unversioned: ['C:/wc/tmp.txt'],
      ignored: ['C:/wc/build'],
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'status',
      '--xml',
      '--no-ignore',
      '--depth',
      'infinity',
      '--',
      'C:\\wc',
    ]);
  });
});

describe('svn-working-copy remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.sslReady.mockResolvedValue(undefined);
    mockState.sslFindForUrl.mockReturnValue(null);
    mockState.existsSync.mockReturnValue(false);
    mockState.getWorkerSvnStatus.mockImplementation(async (path: string) => ({
      path,
      entries: [{ path, status: path.includes('unversioned') ? '?' : 'M' }],
      revision: 0,
    }));
    mockState.runSvnText.mockResolvedValue('');
  });

  it('moves unversioned paths to OS trash and schedules SVN-managed paths', async () => {
    await remove(['C:\\wc\\tracked.txt', 'C:\\wc\\unversioned.txt']);

    expect(mockState.trashItem).toHaveBeenCalledWith('C:\\wc\\unversioned.txt');
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'delete',
      '--force',
      '--',
      'C:\\wc\\tracked.txt',
    ]);
  });

  it('does not call svn delete when all selected paths are unversioned', async () => {
    await remove(['C:\\wc\\unversioned.txt']);

    expect(mockState.trashItem).toHaveBeenCalledWith('C:\\wc\\unversioned.txt');
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['delete']));
  });

  it('does not delete anything when status cannot be determined safely', async () => {
    mockState.getWorkerSvnStatus.mockResolvedValue({
      path: 'C:\\wc\\unknown.txt',
      entries: [],
      revision: 0,
      error: 'svn: E155007: not a working copy',
    });
    await expect(remove(['C:\\wc\\unknown.txt'])).rejects.toThrow(/cannot safely delete/i);
    expect(mockState.trashItem).not.toHaveBeenCalled();
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['delete']));
  });
});

describe('svn-working-copy updateToRevision sparse additions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    mockState.sslReady.mockResolvedValue(undefined);
    mockState.sslFindForUrl.mockReturnValue(null);
    mockState.existsSync.mockReturnValue(false);
    vi.mocked(getAuthCache).mockReturnValue({
      ready: vi.fn().mockResolvedValue(undefined),
      findForUrl: vi.fn(() => null),
    } as never);
    mockState.runSvnText.mockResolvedValue('Updated to revision 99.');
  });

  it('uses svn update --parents for sparse folder additions', async () => {
    const result = await updateToRevision(
      'C:\\wc',
      'https://svn.example.com/repo/trunk/src/features',
      'C:\\wc\\src\\features',
      'infinity',
      true
    );

    expect(result).toEqual({ success: true, revision: 99 });
    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['update', '--parents', '--set-depth', 'infinity', 'src\\features'],
      expect.objectContaining({ cwd: 'C:\\wc', trustSslFailures: false })
    );
  });

  it('uses svn update --parents for sparse file additions', async () => {
    const result = await updateToRevision(
      'C:\\wc',
      'https://svn.example.com/repo/trunk/src/index.ts',
      'C:\\wc\\src\\index.ts',
      'empty',
      true
    );

    expect(result).toEqual({ success: true, revision: 99 });
    expect(mockState.runSvnText).toHaveBeenCalledTimes(1);
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['update', '--parents', '--set-depth', 'empty', 'src\\index.ts'],
      expect.objectContaining({ cwd: 'C:\\wc', trustSslFailures: false })
    );
  });

  it('rejects sparse update targets outside the working copy', async () => {
    const result = await updateToRevision(
      '/wc',
      'https://svn.example.com/repo/trunk-sibling',
      '/wc-sibling',
      'infinity',
      true
    );

    expect(result).toEqual({
      success: false,
      revision: null,
      error: 'Update target is outside the working copy',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });
});

describe('svn-working-copy status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.sslReady.mockResolvedValue(undefined);
    mockState.sslFindForUrl.mockReturnValue(null);
    mockState.existsSync.mockReturnValue(false);
    vi.mocked(getAuthCache).mockReturnValue({
      ready: vi.fn().mockResolvedValue(undefined),
      findForUrl: vi.fn(() => null),
    } as never);
  });

  it('gets local status without repository update checks', async () => {
    mockState.getWorkerSvnStatus.mockResolvedValue({
      path: '/wc',
      entries: [{ path: '/wc/file.txt', status: 'M' }],
      revision: 0,
      remoteChecked: false,
    });

    const result = await getStatus('/wc');

    expect(result.remoteChecked).toBe(false);
    expect(result.entries[0].status).toBe('M');
    expect(mockState.getWorkerSvnStatus).toHaveBeenCalledWith('/wc');
  });

  it('passes caller job ids to cancellable local status work', async () => {
    mockState.getWorkerSvnStatus.mockResolvedValue({
      path: '/wc',
      entries: [],
      revision: 0,
      remoteChecked: false,
    });

    await getStatus('/wc', 'job-status-1');

    expect(mockState.getWorkerSvnStatus).toHaveBeenCalledWith('/wc', {
      jobId: 'job-status-1',
    });
  });

  it('gets remote status with explicit repository update checks', async () => {
    mockState.existsSync.mockImplementation((path: string) => path === '/wc/.svn');
    mockState.runSvnText.mockResolvedValue(
      '<info><entry><url>https://svn.example.com/repo/trunk</url><repository><root>https://svn.example.com/repo</root></repository><wc-info><wcroot-abspath>/wc</wcroot-abspath></wc-info></entry></info>'
    );
    mockState.sslFindForUrl.mockReturnValue({
      realm: 'https://svn.example.com/repo',
      failures: 'unknown-ca',
    });
    vi.mocked(getAuthCache).mockReturnValue({
      ready: vi.fn().mockResolvedValue(undefined),
      findForUrl: vi.fn(() => ({
        username: 'alice',
        password: 'secret',
        realm: 'https://svn.example.com/repo',
      })),
    } as never);
    mockState.getWorkerSvnStatus.mockResolvedValue({
      path: '/wc',
      entries: [{ path: '/wc/file.txt', status: ' ', remoteStatus: 'M' }],
      revision: 0,
      remoteChecked: true,
    });

    const result = await getRemoteStatus('/wc');

    expect(result.remoteChecked).toBe(true);
    expect(result.entries[0].status).toBe(' ');
    expect(result.entries[0].remoteStatus).toBe('M');
    expect(mockState.getWorkerSvnStatus).toHaveBeenCalledWith('/wc', {
      showUpdates: true,
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
      credentials: { username: 'alice', password: 'secret' },
    });
  });

  it('passes caller job ids to cancellable remote status work', async () => {
    mockState.existsSync.mockImplementation((path: string) => path === '/wc/.svn');
    mockState.runSvnText.mockResolvedValue(
      '<info><entry><url>https://svn.example.com/repo/trunk</url><repository><root>https://svn.example.com/repo</root></repository><wc-info><wcroot-abspath>/wc</wcroot-abspath></wc-info></entry></info>'
    );
    mockState.sslFindForUrl.mockReturnValue({
      realm: 'https://svn.example.com/repo',
      failures: 'unknown-ca',
    });
    vi.mocked(getAuthCache).mockReturnValue({
      ready: vi.fn().mockResolvedValue(undefined),
      findForUrl: vi.fn(() => ({
        username: 'alice',
        password: 'secret',
        realm: 'https://svn.example.com/repo',
      })),
    } as never);
    mockState.getWorkerSvnStatus.mockResolvedValue({
      path: '/wc',
      entries: [],
      revision: 0,
      remoteChecked: true,
    });

    await getRemoteStatus('/wc', 'job-status-remote-1');

    expect(mockState.getWorkerSvnStatus).toHaveBeenCalledWith('/wc', {
      showUpdates: true,
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
      credentials: { username: 'alice', password: 'secret' },
      jobId: 'job-status-remote-1',
    });
  });
});

describe('svn-working-copy upgrade helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.sslReady.mockResolvedValue(undefined);
    mockState.sslFindForUrl.mockReturnValue(null);
    mockState.existsSync.mockReturnValue(false);
  });

  it('reports no upgrade requirement when svn info succeeds', async () => {
    mockState.runSvnText.mockResolvedValue('<info />');

    const result = await getWorkingCopyUpgradeStatus('/wc');

    expect(result).toEqual({ path: '/wc', required: false });
    expect(mockState.runSvnText).toHaveBeenCalledWith(['info', '--xml', '--', '/wc']);
  });

  it('detects old working copy metadata errors', async () => {
    mockState.runSvnText.mockRejectedValue(
      new Error("svn: E155036: Please see the 'svn upgrade' command")
    );

    const result = await getWorkingCopyUpgradeStatus('/wc');

    expect(result.required).toBe(true);
    expect(result.path).toBe('/wc');
    expect(result.reason).toContain('older SVN client');
  });

  it('treats a path outside any checkout as needing no upgrade, without an error', async () => {
    mockState.runSvnText.mockRejectedValue(
      new Error("svn: E155007: '/Users/jordan/Work' is not a working copy")
    );

    const result = await getWorkingCopyUpgradeStatus('/Users/jordan/Work');

    // An `error` here would surface an expected condition as a failure.
    expect(result).toEqual({ path: '/Users/jordan/Work', required: false });
  });

  it('still reports a genuine failure to answer the upgrade question', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('svn: E170013: Unable to connect'));

    const result = await getWorkingCopyUpgradeStatus('/wc');

    expect(result).toMatchObject({ path: '/wc', required: false });
    expect(result.error).toContain('E170013');
  });

  it('classifies an already-observed svn info failure without a second process', () => {
    const notAWorkingCopy = classifyWorkingCopyUpgradeError(
      '/Users/jordan/Work',
      new Error("svn: E155007: '/Users/jordan/Work' is not a working copy")
    );
    const tooOld = classifyWorkingCopyUpgradeError(
      '/wc',
      new Error("svn: E155036: Please see the 'svn upgrade' command")
    );

    expect(notAWorkingCopy).toEqual({ path: '/Users/jordan/Work', required: false });
    expect(tooOld.required).toBe(true);
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('runs svn upgrade for the selected working copy', async () => {
    mockState.runSvnText.mockResolvedValue('Upgraded /wc');

    const result = await upgradeWorkingCopy('/wc');

    expect(result).toEqual({ success: true, output: 'Upgraded /wc' });
    expect(mockState.runSvnText).toHaveBeenCalledWith(['upgrade', '/wc']);
  });
});

describe('svn-working-copy update progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.executeHooksForType.mockResolvedValue({ allSucceeded: true });
    vi.mocked(getAuthCache).mockReturnValue({
      ready: vi.fn().mockResolvedValue(undefined),
      findForUrl: vi.fn(() => null),
    } as never);
  });

  it('emits update progress and completion events', async () => {
    const send = vi.fn();
    mockState.runSvn.mockImplementation(
      async (_args: string[], options: { onStdout?: (chunk: string) => void }) => {
        options.onStdout?.('U    src/file.ts\nA    src/new.ts\n');
        return {
          stdout: 'Updated to revision 99.\n',
          stderr: '',
          code: 0,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }
    );

    const result = await updateWithProgress(
      { sender: { send } } as never,
      'update-1',
      '/wc',
      'infinity',
      { revision: 'HEAD' }
    );

    expect(result).toEqual({
      success: true,
      revision: 99,
      output: 'Updated to revision 99.\n',
    });
    expect(mockState.runSvn).toHaveBeenCalledWith(
      ['update', '--depth', 'infinity', '/wc'],
      expect.objectContaining({
        trustSslFailures: false,
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
      })
    );
    expect(send).toHaveBeenCalledWith(
      'svn:update:progress',
      expect.objectContaining({
        updateId: 'update-1',
        status: 'completed',
        filesProcessed: 2,
        revision: 99,
      })
    );
  });

  it('passes revision, depth, ignore-externals, and force options to svn update', async () => {
    const send = vi.fn();
    mockState.runSvn.mockResolvedValue({
      stdout: 'Updated to revision 42.\n',
      stderr: '',
      code: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    await updateWithProgress({ sender: { send } } as never, 'update-options', '/wc', 'files', {
      revision: '42',
      ignoreExternals: true,
      force: true,
    });

    expect(mockState.runSvn).toHaveBeenCalledWith(
      ['update', '-r', '42', '--depth', 'files', '--ignore-externals', '--force', '/wc'],
      expect.objectContaining({
        trustSslFailures: false,
      })
    );
  });

  it('uses streamed revision when stored update output is capped', async () => {
    const send = vi.fn();
    mockState.runSvn.mockImplementation(
      async (_args: string[], options: { onStdout?: (chunk: string) => void }) => {
        options.onStdout?.('U    src/file.ts\n');
        options.onStdout?.('Updated to rev');
        options.onStdout?.('ision 123.\n');
        return {
          stdout: 'U    src/file.ts\n',
          stderr: '',
          code: 0,
          stdoutTruncated: true,
          stderrTruncated: false,
        };
      }
    );

    const result = await updateWithProgress(
      { sender: { send } } as never,
      'update-2',
      '/wc',
      undefined,
      undefined
    );

    expect(result.revision).toBe(123);
    expect(send).toHaveBeenCalledWith(
      'svn:update:progress',
      expect.objectContaining({
        updateId: 'update-2',
        status: 'completed',
        revision: 123,
      })
    );
  });
});
