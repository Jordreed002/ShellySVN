// @vitest-environment node
/**
 * Coverage for src/main/ipc/svn.ts (was 0%; 86 ipcMain.handle delegations).
 * Every service module is mocked; the handlers are captured through
 * ipcMain.handle and invoked with a per-channel argument table so each
 * delegation arrow runs, plus targeted wiring/branch assertions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ipcHandle = vi.hoisted(() => vi.fn());
const rendererSend = vi.hoisted(() => vi.fn());
const getAllWindows = vi.hoisted(() =>
  vi.fn(() => [{ webContents: { isDestroyed: () => false, send: rendererSend } }])
);

vi.mock('electron', () => ({
  ipcMain: { handle: ipcHandle },
  BrowserWindow: { getAllWindows },
}));

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
  breakLock: vi.fn(),
  forceLock: vi.fn(),
  forceUnlock: vi.fn(),
  getLockInfo: vi.fn(),
  getLockRecord: vi.fn(),
  listLocks: vi.fn(),
  lock: vi.fn(),
  setLockComment: vi.fn(),
  stealLock: vi.fn(),
  unlock: vi.fn(),
}));
vi.mock('../../services/svn-switch-relocate', () => ({
  validateSwitchOrRelocate: vi.fn(),
}));
vi.mock('../../services/svn-revprop', () => ({
  editRevprop: vi.fn(),
  getRevprop: vi.fn(),
}));
vi.mock('../../services/pristine-analyzer', () => ({
  analyzePristineStore: vi.fn(),
}));
vi.mock('../../services/secret-scanner', () => ({
  scanFilesForSecrets: vi.fn(),
}));
vi.mock('../../services/wc-relink-detector', () => ({
  applyRelinkProposal: vi.fn().mockResolvedValue({ success: true }),
  detectWorkingCopyRelinks: vi.fn().mockResolvedValue({
    proposals: [],
    unmatchedMissingPaths: [],
    presentPaths: [],
    checkedCandidateCount: 0,
    cancelled: false,
    errors: [],
  }),
}));
const settingsManagerMock = vi.hoisted(() => ({
  ready: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn(() => ({ recentRepositories: ['/recent/wc'] })),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../settings-manager', () => ({
  getSettingsManager: vi.fn(() => settingsManagerMock),
}));
vi.mock('../../utils/approved-paths', () => ({
  approvePathForIpc: vi.fn((path: string) => path),
  assertPathApprovedForIpc: vi.fn((path: string) => path),
}));
vi.mock('../monitor', () => ({
  getMonitoredWorkingCopies: vi.fn(() => [
    { path: '/monitored/wc', url: 'https://svn/r', revision: 1, hasChanges: false, lastChecked: 0, isMonitored: true },
  ]),
  renameMonitoredWorkingCopy: vi.fn(() => true),
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
  getRepositoryLayout: vi.fn(),
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
  rejectServerCertificate: vi.fn(),
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
vi.mock('../../services/svn-working-copy-repair', () => ({
  repairWorkingCopy: vi.fn(),
}));
vi.mock('../../workers/WorkerPool', () => ({
  getSharedWorkerPool: vi.fn(() => ({ cancel: vi.fn(() => true) })),
}));
vi.mock('../../utils/svn-errors', () => ({
  getSvnReadError: vi.fn(() => ({
    error: 'err',
    errorCode: 'E1',
    commandError: { category: 'command' },
  })),
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
import * as locks from '../../services/svn-locks';
import * as switchRelocate from '../../services/svn-switch-relocate';
import * as revprop from '../../services/svn-revprop';
import * as pristine from '../../services/pristine-analyzer';
import * as secrets from '../../services/secret-scanner';
import * as relink from '../../services/wc-relink-detector';
import { getStatusService } from '../../services/status-service';
import { getSvnReadError } from '../../utils/svn-errors';
import { assertPathApprovedForIpc } from '../../utils/approved-paths';
import { getMonitoredWorkingCopies, renameMonitoredWorkingCopy } from '../monitor';
import { closeFileWatchersForPath } from '../fs';
import * as patchMod from '../../services/svn-patch';
import * as repoOps from '../../services/svn-repository-ops';

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
  'svn:repairWorkingCopy': [{ workingCopyPath: '/wc', restoreFiles: [], completeDirs: [], excludeDirs: [] }],
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
  'svn:lockRecord': ['/wc/f'],
  'svn:stealLock': ['/wc/f', 'msg', { confirmed: true, confirmedOwner: 'bob' }],
  'svn:breakLock': ['/wc/f', { confirmed: true, confirmedOwner: 'bob' }],
  'svn:setLockComment': ['/wc/f', 'note', { confirmed: true, confirmedOwner: 'bob' }],
  'svn:resolve': ['/wc/f', 'theirs-full'],
  'svn:switch': ['/wc', 'https://svn/r', '3'],
  'svn:validateSwitchOrRelocate': [
    { workingCopyPath: '/wc', targetUrl: 'https://svn/r', kind: 'switch' },
  ],
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
  'svn:getRevprop': ['https://svn/r', '5', 'svn:log'],
  'svn:editRevprop': [
    'https://svn/r',
    '5',
    'svn:log',
    'new',
    { confirmed: true, acknowledgedServerLogging: true },
  ],
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
  'svn:getRepositoryLayout': ['https://svn/r', 's1'],
  'svn:analyzePristine': ['/wc', { computeWorkingCopySize: true }],
  'svn:scanSecrets': [['/wc/a', '/wc/b'], { maxFindingsPerFile: 10 }],
  'svn:detectWcRelinks': [],
  'svn:applyWcRelink': [
    { oldPath: '/old/wc', newPath: '/new/wc', matchedOn: 'uuid', confidence: 'high' },
  ],
  'svn:trustServerCertificate': ['https://svn/r', 'cert text'],
  'svn:rejectServerCertificate': ['https://svn/r', 'cert text'],
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

  it('broadcasts svn:mutationFailed with the failure detail on a thrown error', async () => {
    vi.mocked(commitMod.commit).mockRejectedValueOnce(
      new Error('svn: E215004: Unable to connect to repository')
    );
    const e = event();
    await handlers.get('svn:commit')!(e, ['/wc/a'], 'msg');
    expect(rendererSend).toHaveBeenCalledWith(
      'svn:mutationFailed',
      expect.objectContaining({
        localPaths: ['/wc/a'],
        message: 'err',
        errorCode: 'E1',
        category: 'command',
      })
    );
    expect(e.sender.send).not.toHaveBeenCalledWith('svn:mutation', expect.anything());
  });

  it('broadcasts svn:mutationFailed for result-style failures', async () => {
    vi.mocked(commitMod.commit).mockResolvedValueOnce({
      success: false,
      error: 'svn: E155015: Aborting commit: remains in conflict',
    } as Awaited<ReturnType<typeof commitMod.commit>>);
    const e = event();
    await handlers.get('svn:commit')!(e, ['/wc/a'], 'msg');
    expect(rendererSend).toHaveBeenCalledWith(
      'svn:mutationFailed',
      expect.objectContaining({
        localPaths: ['/wc/a'],
        message: 'svn: E155015: Aborting commit: remains in conflict',
      })
    );
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

describe('svn IPC handlers — Phase 2 channel wiring', () => {
  it('svn:validateSwitchOrRelocate passes the input through', async () => {
    const input = { workingCopyPath: '/wc', targetUrl: 'https://svn/r', kind: 'switch' as const };
    await handlers.get('svn:validateSwitchOrRelocate')!(event(), input);
    expect(vi.mocked(switchRelocate.validateSwitchOrRelocate)).toHaveBeenCalledWith(input);
  });

  it('svn:lockRecord delegates to getLockRecord', async () => {
    await handlers.get('svn:lockRecord')!(event(), '/wc/f');
    expect(vi.mocked(locks.getLockRecord)).toHaveBeenCalledWith('/wc/f');
  });

  it('svn:stealLock passes path, comment and confirmation through', async () => {
    const e = event();
    const confirmation = { confirmed: true, confirmedOwner: 'bob' };
    await handlers.get('svn:stealLock')!(e, '/wc/f', 'note', confirmation);
    expect(vi.mocked(locks.stealLock)).toHaveBeenCalledWith('/wc/f', 'note', confirmation);
    expect(e.sender.send).toHaveBeenCalledWith('svn:mutation', expect.any(Object));
  });

  it('svn:breakLock and svn:setLockComment pass confirmation payloads through', async () => {
    const confirmation = { confirmed: true, confirmedOwner: 'bob' };
    await handlers.get('svn:breakLock')!(event(), '/wc/f', confirmation);
    expect(vi.mocked(locks.breakLock)).toHaveBeenCalledWith('/wc/f', confirmation);

    await handlers.get('svn:setLockComment')!(event(), '/wc/f', 'note', confirmation);
    expect(vi.mocked(locks.setLockComment)).toHaveBeenCalledWith('/wc/f', 'note', confirmation);
  });

  it('svn:getRevprop validates the revision before delegating', async () => {
    await handlers.get('svn:getRevprop')!(event(), 'https://svn/r', '5', 'svn:log');
    expect(vi.mocked(revprop.getRevprop)).toHaveBeenCalledWith('https://svn/r', '5', 'svn:log');

    await expect(
      handlers.get('svn:getRevprop')!(event(), 'https://svn/r', '12.5', 'svn:log')
    ).rejects.toThrow(/revprop revision/);
    expect(vi.mocked(revprop.getRevprop)).toHaveBeenCalledTimes(1);
  });

  it('svn:editRevprop forwards the confirmation payload', async () => {
    const confirmation = { confirmed: true, acknowledgedServerLogging: true };
    await handlers.get('svn:editRevprop')!(
      event(),
      'https://svn/r',
      '5',
      'svn:log',
      'new',
      confirmation
    );
    expect(vi.mocked(revprop.editRevprop)).toHaveBeenCalledWith(
      'https://svn/r',
      '5',
      'svn:log',
      'new',
      confirmation
    );
  });

  it('svn:getRepositoryLayout resolves the auth session before delegating', async () => {
    await handlers.get('svn:getRepositoryLayout')!(event(), 'https://svn/r', 's1');
    expect(vi.mocked(auth.resolveAuthSession)).toHaveBeenCalledWith('win-1', 's1', 'https://svn/r');
    expect(vi.mocked(meta.getRepositoryLayout)).toHaveBeenCalledWith('https://svn/r', {
      sessionId: 'resolved',
    });
  });

  it('svn:analyzePristine asserts path approval and forwards options', async () => {
    await handlers.get('svn:analyzePristine')!(event(), '/wc', {
      computeWorkingCopySize: true,
    });
    expect(vi.mocked(assertPathApprovedForIpc)).toHaveBeenCalledWith(
      '/wc',
      'Pristine analysis'
    );
    expect(vi.mocked(pristine.analyzePristineStore)).toHaveBeenCalledWith('/wc', {
      computeWorkingCopySize: true,
    });
  });

  it('svn:scanSecrets approves every renderer-supplied path', async () => {
    await handlers.get('svn:scanSecrets')!(event(), ['/wc/a', '/wc/b'], {
      maxFindingsPerFile: 10,
    });
    expect(vi.mocked(assertPathApprovedForIpc)).toHaveBeenCalledWith('/wc/a', 'Secret scan');
    expect(vi.mocked(assertPathApprovedForIpc)).toHaveBeenCalledWith('/wc/b', 'Secret scan');
    expect(vi.mocked(secrets.scanFilesForSecrets)).toHaveBeenCalledWith(['/wc/a', '/wc/b'], {
      maxFindingsPerFile: 10,
    });
  });

  it('svn:detectWcRelinks merges monitor entries with recent path settings', async () => {
    await handlers.get('svn:detectWcRelinks')!();
    expect(vi.mocked(getMonitoredWorkingCopies)).toHaveBeenCalled();
    expect(settingsManagerMock.getSettings).toHaveBeenCalled();
    const entries = vi.mocked(relink.detectWorkingCopyRelinks).mock.calls[0][0];
    expect(entries).toEqual([
      { path: '/monitored/wc', url: 'https://svn/r' },
      { path: '/recent/wc' },
    ]);
  });

  it('svn:applyWcRelink rewrites the registries and retires old watchers', async () => {
    vi.mocked(relink.applyRelinkProposal).mockImplementationOnce(
      async (_proposal, updateRegistry) => {
        await updateRegistry('/old/wc', '/new/wc');
        return { success: true };
      }
    );

    const result = await handlers.get('svn:applyWcRelink')!(event(), {
      oldPath: '/old/wc',
      newPath: '/new/wc',
      matchedOn: 'uuid',
      confidence: 'high',
    });

    expect(result).toEqual({ success: true });
    expect(vi.mocked(renameMonitoredWorkingCopy)).toHaveBeenCalledWith('/old/wc', '/new/wc');
    expect(settingsManagerMock.updateSettings).toHaveBeenCalledWith({
      recentRepositories: ['/recent/wc', '/new/wc'],
    });
    expect(vi.mocked(closeFileWatchersForPath)).toHaveBeenCalledWith('/old/wc');
  });

  it('svn:rejectServerCertificate delegates to the diagnostics service', async () => {
    await handlers.get('svn:rejectServerCertificate')!(event(), 'https://svn/r', 'cert text');
    expect(vi.mocked(diag.rejectServerCertificate)).toHaveBeenCalledWith(
      'https://svn/r',
      'cert text'
    );
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

describe('svn IPC handlers — locale-independent revision validation', () => {
  it('svn:switch canonicalizes keyword revisions before delegating', async () => {
    await handlers.get('svn:switch')!(event(), '/wc', 'https://svn/r', ' head ');
    expect(vi.mocked(repoOps.switchWorkingCopy)).toHaveBeenCalledWith(
      '/wc',
      'https://svn/r',
      'HEAD'
    );
  });

  it('svn:switch rejects coercible-but-invalid revisions before spawning svn', async () => {
    await expect(
      handlers.get('svn:switch')!(event(), '/wc', 'https://svn/r', '1e3')
    ).rejects.toThrow(/not a valid SVN revision/);
    expect(vi.mocked(repoOps.switchWorkingCopy)).not.toHaveBeenCalled();
  });

  it('svn:checkout rejects non-ASCII digit revisions Number() would coerce', async () => {
    await expect(
      handlers.get('svn:checkout')!(event(), 'https://svn/r', '/wc', '１２３')
    ).rejects.toThrow(/not a valid SVN revision/);
    expect(vi.mocked(checkoutMod.checkout)).not.toHaveBeenCalled();
  });

  it('svn:log rejects fractional revision bounds', async () => {
    await expect(
      handlers.get('svn:log')!(event(), '/wc', 50, 1.5, 20)
    ).rejects.toThrow(/log start revision/);
    expect(vi.mocked(history.getLog)).not.toHaveBeenCalled();
  });

  it('svn:diff accepts change syntax (reversed revisions) for the -c slot', async () => {
    await handlers.get('svn:diff')!(event(), '/wc/f', '-7', 'job1');
    expect(vi.mocked(history.getDiff)).toHaveBeenCalledWith('/wc/f', '-7', 'job1');
  });

  it('svn:diff rejects malformed change revisions', async () => {
    await expect(
      handlers.get('svn:diff')!(event(), '/wc/f', '1:2:3')
    ).rejects.toThrow(/not a valid change/);
  });

  it('svn:merge reports the offending change-list index', async () => {
    await expect(
      handlers.get('svn:merge')!(event(), 'src', 'tgt', ['5', 'oops'], undefined, {})
    ).rejects.toThrow(/merge revisions\[1\]/);
    expect(vi.mocked(repoOps.mergeRepositoryRange)).not.toHaveBeenCalled();
  });

  it('svn:update sanitizes the revision inside update options', async () => {
    await handlers.get('svn:update')!(event(), '/wc', 'infinity', { revision: ' 42 ' });
    expect(vi.mocked(wc.update)).toHaveBeenCalledWith('/wc', 'infinity', { revision: '42' });
    await expect(
      handlers.get('svn:update')!(event(), '/wc', 'infinity', { revision: '0x10' })
    ).rejects.toThrow(/update revision/);
  });

  it('svn:revpropget validates the revision before the service call', async () => {
    await expect(
      handlers.get('svn:revpropget')!(event(), '/wc', 'svn:date', '12.5')
    ).rejects.toThrow(/revprop revision/);
    expect(vi.mocked(meta.revpropget)).not.toHaveBeenCalled();
  });
});
