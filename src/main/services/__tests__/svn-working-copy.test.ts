// @vitest-environment node

import { rm } from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
  runSvnText: vi.fn(),
  getWorkerSvnStatus: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  sslReady: vi.fn().mockResolvedValue(undefined),
  sslFindForUrl: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockState.existsSync,
  };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    rm: mockState.rm,
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
  executeHooksForType: vi.fn(),
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
  getRemoteStatus,
  getStatus,
  getWorkingCopyUpgradeStatus,
  remove,
  updateToRevision,
  updateWithProgress,
  upgradeWorkingCopy,
} from '../svn-working-copy';
import { getAuthCache } from '../../auth-cache';

describe('svn-working-copy remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('deletes unversioned paths from disk and SVN-managed paths with force', async () => {
    await remove(['C:\\wc\\tracked.txt', 'C:\\wc\\unversioned.txt']);

    expect(rm).toHaveBeenCalledWith('C:\\wc\\unversioned.txt', {
      recursive: true,
      force: true,
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith(['delete', '--force', 'C:\\wc\\tracked.txt']);
  });

  it('does not call svn delete when all selected paths are unversioned', async () => {
    await remove(['C:\\wc\\unversioned.txt']);

    expect(rm).toHaveBeenCalledWith('C:\\wc\\unversioned.txt', {
      recursive: true,
      force: true,
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['delete']));
  });
});

describe('svn-working-copy updateToRevision sparse additions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mockState.runSvnText).toHaveBeenCalledWith(['info', '--xml', '/wc']);
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
