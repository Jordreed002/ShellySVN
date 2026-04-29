// @vitest-environment node

import { rm } from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvn: vi.fn(),
  runSvnText: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
}));

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

vi.mock('../../ipc/store', () => ({
  getStore: vi.fn(),
}));

vi.mock('../../auth-cache', () => ({
  getAuthCache: vi.fn(),
}));

vi.mock('../../hooks/HookExecutor', () => ({
  executeHooksForType: vi.fn(),
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
  updateWithProgress,
  upgradeWorkingCopy,
} from '../svn-working-copy';

const statusXml = (path: string, item: string) => `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="${path}">
    <entry path="${path}">
      <wc-status item="${item}" props="none" />
    </entry>
  </target>
</status>`;

describe('svn-working-copy remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        const path = args[2];
        return statusXml(path, path.includes('unversioned') ? 'unversioned' : 'modified');
      }
      return '';
    });
  });

  it('deletes unversioned paths from disk and SVN-managed paths with force', async () => {
    await remove(['C:\\wc\\tracked.txt', 'C:\\wc\\unversioned.txt']);

    expect(rm).toHaveBeenCalledWith('C:\\wc\\unversioned.txt', {
      recursive: true,
      force: true,
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'delete',
      '--force',
      'C:\\wc\\tracked.txt',
    ]);
  });

  it('does not call svn delete when all selected paths are unversioned', async () => {
    await remove(['C:\\wc\\unversioned.txt']);

    expect(rm).toHaveBeenCalledWith('C:\\wc\\unversioned.txt', {
      recursive: true,
      force: true,
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(
      expect.arrayContaining(['delete'])
    );
  });
});

describe('svn-working-copy status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets local status without repository update checks', async () => {
    mockState.runSvnText.mockResolvedValue(statusXml('/wc/file.txt', 'modified'));

    const result = await getStatus('/wc');

    expect(result.remoteChecked).toBe(false);
    expect(result.entries[0].status).toBe('M');
    expect(mockState.runSvnText).toHaveBeenCalledWith(['status', '--xml', '/wc']);
  });

  it('gets remote status with explicit repository update checks', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="/wc">
    <entry path="/wc/file.txt">
      <wc-status item="normal" props="none" />
      <repos-status item="modified" props="none" />
    </entry>
  </target>
</status>`);

    const result = await getRemoteStatus('/wc');

    expect(result.remoteChecked).toBe(true);
    expect(result.entries[0].status).toBe(' ');
    expect(result.entries[0].remoteStatus).toBe('M');
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['status', '--xml', '--show-updates', '/wc'],
      { trustSslFailures: true }
    );
  });
});

describe('svn-working-copy upgrade helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        trustSslFailures: true,
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

    await updateWithProgress(
      { sender: { send } } as never,
      'update-options',
      '/wc',
      'files',
      {
        revision: '42',
        ignoreExternals: true,
        force: true,
      }
    );

    expect(mockState.runSvn).toHaveBeenCalledWith(
      ['update', '-r', '42', '--depth', 'files', '--ignore-externals', '--force', '/wc'],
      expect.objectContaining({
        trustSslFailures: true,
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
