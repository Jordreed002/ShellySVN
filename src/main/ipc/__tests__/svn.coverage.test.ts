// @vitest-environment node
/**
 * Coverage for src/main/ipc/svn.ts (was 0%; 86 ipcMain.handle delegations).
 * Every service module is mocked; the handlers are captured through
 * ipcMain.handle and invoked with a per-channel argument table so each
 * delegation arrow runs, plus targeted wiring/branch assertions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ipcHandle = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({ ipcMain: { handle: ipcHandle } }));

vi.mock('../../services/svn-checkout', () => ({
  cancelCheckout: vi.fn(),
  checkout: vi.fn(),
  checkoutWithProgress: vi.fn(),
}));
vi.mock('../../services/svn-commit', () => ({ commit: vi.fn(), commitWithProgress: vi.fn() }));
vi.mock('../../services/svn-native-auth', () => ({
  listNativeAuth: vi.fn(),
  removeNativeAuth: vi.fn(),
}));
vi.mock('../../services/svn-content', () => ({ catRepositoryFile: vi.fn() }));
vi.mock('../../services/svn-history', () => ({
  getBlame: vi.fn(),
  getDiff: vi.fn(),
  getDiffStreaming: vi.fn(),
  getLog: vi.fn(),
  getMergeInfo: vi.fn(),
  getUrlDiff: vi.fn(),
}));
vi.mock('../../services/svn-merge-readiness', () => ({ getMergeReadiness: vi.fn() }));
vi.mock('../../services/svn-revision-impact', () => ({ getRevisionImpact: vi.fn() }));
vi.mock('../../services/svn-branch-comparison', () => ({ compareBranches: vi.fn() }));
vi.mock('../../services/svn-locks', () => ({
  forceLock: vi.fn(),
  forceUnlock: vi.fn(),
  getLockInfo: vi.fn(),
  listLocks: vi.fn(),
  lock: vi.fn(),
  unlock: vi.fn(),
}));
vi.mock('../../services/svn-metadata', () => ({
  changelistAdd: vi.fn(),
  changelistDelete: vi.fn(),
  changelistList: vi.fn(),
  changelistRemove: vi.fn(),
  externalsAdd: vi.fn(),
  externalsEdit: vi.fn(),
  externalsList: vi.fn(),
  externalsRemove: vi.fn(),
  externalsUpdate: vi.fn(),
  listRepository: vi.fn(),
  propdel: vi.fn(),
  propdelRemote: vi.fn(),
  propget: vi.fn(),
  proplist: vi.fn(),
  propset: vi.fn(),
  propsetRemote: vi.fn(),
  revpropdel: vi.fn(),
  revpropget: vi.fn(),
  revpropset: vi.fn(),
  shelveApply: vi.fn(),
  shelveDelete: vi.fn(),
  shelveList: vi.fn(),
  shelveSave: vi.fn(),
}));
vi.mock('../../services/auth-session-manager', () => ({
  resolveAuthSession: vi.fn(() => ({ sessionId: 'resolved' })),
}));
vi.mock('../../services/svn-diagnostics', () => ({
  getDiagnostics: vi.fn(),
  getSvnCapabilities: vi.fn(() => ({ supportsShelve: true })),
  trustServerCertificate: vi.fn(),
}));
vi.mock('../../services/svn-patch', () => ({ applyPatch: vi.fn(), createPatch: vi.fn() }));
vi.mock('../../services/svn-repository-ops', () => ({
  copyRepositoryItem: vi.fn(),
  createRemoteFolder: vi.fn(),
  deleteRemoteItem: vi.fn(),
  exportRepository: vi.fn(),
  exportRepositoryWithProgress: vi.fn(),
  importRepository: vi.fn(),
  importRepositoryWithProgress: vi.fn(),
  mergeRepositoryRange: vi.fn(),
  mergeRepositoryRangeWithProgress: vi.fn(),
  moveRemoteItem: vi.fn(),
  relocateWorkingCopy: vi.fn(),
  resolveConflict: vi.fn(),
  switchWorkingCopy: vi.fn(),
}));
vi.mock('../../services/svn-progress', () => ({ cancelSvnOperation: vi.fn() }));
vi.mock('../../services/status-service', () => ({
  getStatusService: vi.fn(() => ({ invalidatePaths: vi.fn() })),
}));
vi.mock('../../services/svn-cache-service', () => ({
  getSvnCacheService: vi.fn(() => ({ clearPath: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock('../../services/svn-working-copy', () => ({
  add: vi.fn(),
  cancelUpdate: vi.fn(),
  cleanup: vi.fn(),
  previewCleanup: vi.fn(),
  excludeFromWorkingCopy: vi.fn(),
  getWorkingCopyContext: vi.fn(),
  getInfo: vi.fn(),
  getInfoUrl: vi.fn(),
  getRemoteStatus: vi.fn(),
  getStatus: vi.fn(),
  getWorkingCopyUpgradeStatus: vi.fn(),
  move: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  revert: vi.fn(),
  previewRevert: vi.fn(),
  unversion: vi.fn(),
  getChildCommits: vi.fn(),
  update: vi.fn(),
  updateWithProgress: vi.fn(),
  upgradeWorkingCopy: vi.fn(),
  updateItem: vi.fn(),
  updateToRevision: vi.fn(),
}));
vi.mock('../../workers/WorkerPool', () => ({
  getSharedWorkerPool: vi.fn(() => ({ cancel: vi.fn(() => true) })),
}));
vi.mock('../../utils/svn-errors', () => ({
  getSvnReadError: vi.fn(() => ({ svnErrorCode: 'E1', message: 'err' })),
}));
vi.mock('../fs', () => ({
  closeFileWatchersForPath: vi.fn().mockResolvedValue(undefined),
}));

import { registerSvnHandlers } from '../svn';
import * as checkoutMod from '../../services/svn-checkout';
import * as commitMod from '../../services/svn-commit';
import * as history from '../../services/svn-history';
import * as diag from '../../services/svn-diagnostics';
import * as wc from '../../services/svn-working-copy';
import * as meta from '../../services/svn-metadata';
import * as auth from '../../services/auth-session-manager';
import { getStatusService } from '../../services/status-service';
import { getSvnReadError } from '../../utils/svn-errors';
import { closeFileWatchersForPath } from '../fs';
import * as patchMod from '../../services/svn-patch';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  ipcHandle.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  });
  registerSvnHandlers();
});

function event() {
  return { sender: { id: 'win-1', send: vi.fn() } };
}

// Per-channel args following the IPC event argument.
const ARGS: Record<string, unknown[]> = {
  'svn:capabilities': [],
  'svn:nativeAuth:list': [['svn-simple']],
  'svn:nativeAuth:remove': [['svn-simple']],
  'svn:cat': ['/wc/f', '5', 'job1'],
  'svn:revertPreview': [['/wc/a'], 'infinity'],
  'svn:status': ['/wc', 'job1'],
  'svn:statusRemote': ['/wc', 'job1'],
  'svn:cancelWorkerJob': ['job1'],
  'svn:workingCopyUpgradeStatus': ['/wc'],
  'svn:upgradeWorkingCopy': ['/wc'],
  'svn:log': ['/wc', 50, 10, 20, false, 'job1', {}],
  'svn:mergeInfo': ['src', 'tgt', 'eligible'],
  'svn:mergeReadiness': ['https://svn/source', '/wc'],
  'svn:revisionImpact': ['/wc', 25, 10],
  'svn:compareBranches': ['https://svn/trunk', 'https://svn/branch'],
  'svn:info': ['/wc'],
  'svn:infoUrl': ['https://svn/r'],
  'svn:getWorkingCopyContext': ['/wc'],
  'svn:diff': ['/wc/f', '5', 'job1'],
  'svn:diffUrls': ['u1', 'u2', 'job1'],
  'svn:diffStreaming': ['/wc/f', '5', 'job1'],
  'svn:update': ['/wc', 'infinity', {}],
  'svn:updateWithProgress': ['id1', '/wc', 'infinity', {}],
  'svn:cancelUpdate': ['id1'],
  'svn:updateItem': ['/wc'],
  'svn:updateToRevision': ['/root', 'https://svn/r', '/wc', 'infinity', false],
  'svn:commit': [['/wc/a'], 'msg'],
  'svn:commitWithProgress': ['op1', ['/wc/a'], 'msg'],
  'svn:cancelOperation': ['op1'],
  'svn:revert': [['/wc/a'], 'infinity'],
  'svn:unversion': [['/wc/a']],
  'svn:exclude': [['/wc/a']],
  'svn:childCommits': ['/wc'],
  'svn:add': [['/wc/a']],
  'svn:delete': [['/wc/a']],
  'svn:cleanup': ['/wc', {}],
  'svn:cleanupPreview': ['/wc'],
  'svn:checkout': ['https://svn/r', '/wc', '3', 'immediates', { authSessionId: 's1' }],
  'svn:checkoutWithProgress': [
    'id1',
    'https://svn/r',
    '/wc',
    '3',
    'immediates',
    { authSessionId: 's1' },
  ],
  'svn:cancelCheckout': ['id1'],
  'svn:export': ['https://svn/r', '/wc', '3'],
  'svn:exportWithProgress': ['op1', 'https://svn/r', '/wc', '3'],
  'svn:import': ['/wc', 'https://svn/r', 'msg'],
  'svn:importWithProgress': ['op1', '/wc', 'https://svn/r', 'msg'],
  'svn:lock': ['/wc/f', 'msg'],
  'svn:unlock': ['/wc/f', true],
  'svn:lockInfo': ['/wc/f'],
  'svn:lockForce': ['/wc/f', 'msg'],
  'svn:unlockForce': ['/wc/f'],
  'svn:lockList': ['/wc'],
  'svn:resolve': ['/wc/f', 'theirs-full'],
  'svn:switch': ['/wc', 'https://svn/r', '3'],
  'svn:copy': ['src', 'dst', 'msg', 's1'],
  'svn:remoteCreateFolder': ['https://svn/parent', 'folder', 'msg', 's1'],
  'svn:remoteDelete': ['https://svn/r', 'msg', 's1'],
  'svn:remoteMove': ['u1', 'u2', 'msg', 's1'],
  'svn:merge': ['src', 'tgt', ['5'], [{ start: 1, end: 2 }], {}],
  'svn:mergeWithProgress': ['op1', 'src', 'tgt', ['5'], [{ start: 1, end: 2 }], {}],
  'svn:relocate': ['from', 'to', '/wc'],
  'svn:changelist:add': [['/wc/a'], 'mine'],
  'svn:changelist:remove': [['/wc/a']],
  'svn:changelist:list': ['/wc'],
  'svn:changelist:delete': ['mine', '/wc'],
  'svn:move': ['src', 'dst'],
  'svn:copyLocal': ['src', 'dst'],
  'svn:shelve:list': ['/wc'],
  'svn:shelve:save': ['name', '/wc', 'msg'],
  'svn:shelve:apply': ['name', '/wc'],
  'svn:shelve:delete': ['name', '/wc'],
  'svn:proplist': ['/wc', {}],
  'svn:propget': ['/wc', 'svn:eol-style', {}],
  'svn:propset': ['/wc', 'svn:eol-style', 'LF'],
  'svn:propdel': ['/wc', 'svn:eol-style'],
  'svn:propsetRemote': ['https://svn/r', 'svn:eol-style', 'LF', 'msg'],
  'svn:propdelRemote': ['https://svn/r', 'svn:eol-style', 'msg'],
  'svn:revpropget': ['/wc', 'svn:date', '5'],
  'svn:revpropset': ['/wc', 'svn:date', '2024', '5'],
  'svn:revpropdel': ['/wc', 'svn:date', '5'],
  'svn:blame': ['/wc/f', 1, 5, 'job1'],
  'svn:list': ['https://svn/r', '3', 'immediates', 's1'],
  'svn:patch:create': [['/wc/a'], '/out.patch'],
  'svn:patch:apply': ['/in.patch', '/wc', false, {}],
  'svn:externals:list': ['/wc'],
  'svn:externals:add': ['/wc', { url: 'https://svn/r', path: 'ext', name: 'ext' }],
  'svn:externals:remove': ['/wc', 'ext'],
  'svn:externals:edit': ['/wc', 'ext', { url: 'https://svn/r', path: 'ext', name: 'ext' }],
  'svn:externals:update': ['/wc', 'ext'],
  'svn:diagnostics': ['/wc'],
  'svn:trustServerCertificate': ['https://svn/r', 'cert text'],
};

describe('svn IPC handlers — registration and invocation', () => {
  it('registers a handler for every channel in the table', () => {
    for (const channel of Object.keys(ARGS)) {
      expect(handlers.has(channel), `missing handler for ${channel}`).toBe(true);
    }
    expect(handlers.size).toBeGreaterThanOrEqual(Object.keys(ARGS).length);
  });

  it('invokes every handler without throwing', async () => {
    for (const channel of Object.keys(ARGS)) {
      const handler = handlers.get(channel)!;
      try {
        await handler(event(), ...ARGS[channel]);
      } catch (error) {
        throw new Error(`handler ${channel} threw: ${(error as Error).message}`);
      }
    }
  });
});

describe('svn IPC handlers — wiring', () => {
  it('svn:capabilities delegates to getSvnCapabilities', async () => {
    await handlers.get('svn:capabilities')!();
    expect(vi.mocked(diag.getSvnCapabilities)).toHaveBeenCalled();
  });

  it('svn:status delegates path and worker job id', async () => {
    await handlers.get('svn:status')!(event(), '/wc', 'job1');
    expect(vi.mocked(wc.getStatus)).toHaveBeenCalledWith('/wc', 'job1');
  });

  it('svn:log delegates the full argument set', async () => {
    await handlers.get('svn:log')!(event(), '/wc', 50, 10, 20, false, 'job1', {});
    expect(vi.mocked(history.getLog)).toHaveBeenCalledWith('/wc', 50, 10, 20, false, 'job1', {});
  });

  it('svn:commit runs the mutation and notifies the renderer', async () => {
    const e = event();
    await handlers.get('svn:commit')!(e, ['/wc/a'], 'msg');
    expect(vi.mocked(commitMod.commit)).toHaveBeenCalledWith(['/wc/a'], 'msg');
    expect(getStatusService).toHaveBeenCalled();
    expect(e.sender.send).toHaveBeenCalledWith('svn:mutation', expect.any(Object));
  });

  it('svn:checkout resolves the auth session before delegating', async () => {
    await handlers.get('svn:checkout')!(event(), 'https://svn/r', '/wc', '3', 'immediates', {
      authSessionId: 's1',
    });
    expect(vi.mocked(auth.resolveAuthSession)).toHaveBeenCalledWith('win-1', 's1', 'https://svn/r');
    expect(vi.mocked(checkoutMod.checkout)).toHaveBeenCalledWith(
      'https://svn/r',
      '/wc',
      '3',
      'immediates',
      expect.objectContaining({ credentials: { sessionId: 'resolved' } })
    );
  });

  it('svn:list resolves the auth session and delegates', async () => {
    await handlers.get('svn:list')!(event(), 'https://svn/r', '3', 'immediates', 's1');
    expect(vi.mocked(meta.listRepository)).toHaveBeenCalledWith(
      'https://svn/r',
      '3',
      'immediates',
      { sessionId: 'resolved' }
    );
  });

  it('svn:relocate and svn:delete retire file watchers after success', async () => {
    await handlers.get('svn:relocate')!(event(), 'from', 'to', '/wc');
    expect(vi.mocked(closeFileWatchersForPath)).toHaveBeenCalledWith('/wc');

    await handlers.get('svn:delete')!(event(), ['/wc/a', '/wc/b']);
    expect(vi.mocked(closeFileWatchersForPath)).toHaveBeenCalledWith('/wc/a');
    expect(vi.mocked(closeFileWatchersForPath)).toHaveBeenCalledWith('/wc/b');
  });
});

describe('svn IPC handlers — branches', () => {
  it('svn:patch:apply calls applyPatch directly on a dry run', async () => {
    await handlers.get('svn:patch:apply')!(event(), '/in.patch', '/wc', true, {});
    expect(vi.mocked(patchMod.applyPatch)).toHaveBeenCalledWith('/in.patch', '/wc', true, {});
  });

  it('svn:exclude wraps a single string path into an array', async () => {
    await handlers.get('svn:exclude')!(event(), '/wc/a');
    expect(vi.mocked(wc.excludeFromWorkingCopy)).toHaveBeenCalledWith(['/wc/a']);
  });

  it('a failing mutation returns a structured failure instead of throwing', async () => {
    vi.mocked(wc.update).mockRejectedValueOnce(new Error('svn: E1'));
    const result = (await handlers.get('svn:update')!(event(), '/wc', 'infinity', {})) as {
      success: boolean;
      svnErrorCode?: string;
    };
    expect(result.success).toBe(false);
    expect(getSvnReadError).toHaveBeenCalled();
  });
});
