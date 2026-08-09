import type { IpcRenderer } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSvnApi } from '../svn';
import type { InvokeIpc } from '../ipc';

const credentials = { username: 'alice', password: 'secret' };
const external = { url: '^/vendor', path: 'vendor', revision: 12 };
const propertyOptions = { revision: '7', depth: 'infinity' as const, inherited: true };

describe('SVN preload IPC contract', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let ipcRenderer: IpcRenderer;
  let api: ReturnType<typeof createSvnApi>;

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue({ success: true, revision: 7 });
    ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as IpcRenderer;
    api = createSvnApi(ipcRenderer, invoke as unknown as InvokeIpc);
  });

  it('exposes an update operation ID before the update settles', async () => {
    const operation = api.updateWithProgress('/wc', vi.fn());
    expect(operation.operationId).toMatch(/^update-/);
    await expect(operation).resolves.toMatchObject({ success: true, revision: 7 });
  });

  it.each([
    ['capabilities', () => api.capabilities(), ['svn:capabilities']],
    [
      'active working-copy mutations',
      () => api.getActiveWorkingCopyMutations(),
      ['svn:getActiveWorkingCopyMutations'],
    ],
    [
      'native auth list',
      () => api.nativeAuth.list(['svn.simple']),
      ['svn:nativeAuth:list', ['svn.simple']],
    ],
    [
      'native auth remove',
      () => api.nativeAuth.remove(['svn.simple']),
      ['svn:nativeAuth:remove', ['svn.simple']],
    ],
    ['cat', () => api.cat('repo/file', '4'), ['svn:cat', 'repo/file', '4', undefined]],
    ['status', () => api.status('/wc'), ['svn:status', '/wc', undefined]],
    ['remote status', () => api.statusRemote('/wc'), ['svn:statusRemote', '/wc', undefined]],
    [
      'upgrade status',
      () => api.workingCopyUpgradeStatus('/wc'),
      ['svn:workingCopyUpgradeStatus', '/wc'],
    ],
    ['upgrade', () => api.upgradeWorkingCopy('/wc'), ['svn:upgradeWorkingCopy', '/wc']],
    [
      'log',
      () => api.log('/wc', 25, 10, 2, true, { stopOnCopy: true }),
      ['svn:log', '/wc', 25, 10, 2, true, undefined, { stopOnCopy: true }],
    ],
    [
      'mergeinfo',
      () => api.mergeInfo('source', 'target', 'eligible'),
      ['svn:mergeInfo', 'source', 'target', 'eligible'],
    ],
    [
      'merge readiness',
      () => api.mergeReadiness('https://repo/branch', '/wc'),
      ['svn:mergeReadiness', 'https://repo/branch', '/wc'],
    ],
    [
      'revision impact',
      () => api.revisionImpact('/wc', 20, 8),
      ['svn:revisionImpact', '/wc', 20, 8],
    ],
    [
      'branch comparison',
      () => api.compareBranches('https://repo/trunk', 'https://repo/branch'),
      ['svn:compareBranches', 'https://repo/trunk', 'https://repo/branch'],
    ],
    ['info', () => api.info('/wc'), ['svn:info', '/wc']],
    ['URL info', () => api.infoUrl('https://repo/trunk'), ['svn:infoUrl', 'https://repo/trunk']],
    [
      'working-copy context',
      () => api.getWorkingCopyContext('/wc/a'),
      ['svn:getWorkingCopyContext', '/wc/a'],
    ],
    ['diff', () => api.diff('/wc/a', '3:4'), ['svn:diff', '/wc/a', '3:4', undefined]],
    ['URL diff', () => api.diffUrls('left', 'right'), ['svn:diffUrls', 'left', 'right', undefined]],
    [
      'streaming diff',
      () => api.diffStreaming('/wc/a', '4'),
      ['svn:diffStreaming', '/wc/a', '4', undefined],
    ],
    [
      'update',
      () => api.update('/wc', 'files', { force: true }),
      ['svn:update', '/wc', 'files', { force: true }],
    ],
    ['cancel update', () => api.cancelUpdate('update-123'), ['svn:cancelUpdate', 'update-123']],
    ['update item', () => api.updateItem('/wc/a'), ['svn:updateItem', '/wc/a']],
    [
      'sparse update',
      () => api.updateToRevision('/wc', 'https://repo/trunk', '/wc/a', 'infinity', true),
      ['svn:updateToRevision', '/wc', 'https://repo/trunk', '/wc/a', 'infinity', true],
    ],
    ['commit', () => api.commit(['/wc/a'], 'message'), ['svn:commit', ['/wc/a'], 'message']],
    [
      'cancel operation',
      () => api.cancelOperation('commit-123'),
      ['svn:cancelOperation', 'commit-123'],
    ],
    ['revert', () => api.revert(['/wc/a'], 'immediates'), ['svn:revert', ['/wc/a'], 'immediates']],
    [
      'revert preview',
      () => api.revertPreview(['/wc/a'], 'files'),
      ['svn:revertPreview', ['/wc/a'], 'files'],
    ],
    ['unversion', () => api.unversion(['/wc/a']), ['svn:unversion', ['/wc/a']]],
    ['exclude', () => api.exclude('/wc/folder'), ['svn:exclude', '/wc/folder']],
    ['child commits', () => api.childCommits('/wc'), ['svn:childCommits', '/wc']],
    ['add', () => api.add(['/wc/a']), ['svn:add', ['/wc/a']]],
    ['delete', () => api.delete(['/wc/a']), ['svn:delete', ['/wc/a']]],
    [
      'cleanup',
      () => api.cleanup('/wc', { breakLocks: true }),
      ['svn:cleanup', '/wc', { breakLocks: true }],
    ],
    ['cleanup preview', () => api.cleanupPreview('/wc'), ['svn:cleanupPreview', '/wc']],
    ['lock', () => api.lock('/wc/a', 'mine'), ['svn:lock', '/wc/a', 'mine']],
    ['unlock', () => api.unlock('/wc/a', true), ['svn:unlock', '/wc/a', true]],
    ['lock info', () => api.lockInfo('/wc/a'), ['svn:lockInfo', '/wc/a']],
    ['force lock', () => api.lockForce('/wc/a', 'mine'), ['svn:lockForce', '/wc/a', 'mine']],
    ['force unlock', () => api.unlockForce('/wc/a'), ['svn:unlockForce', '/wc/a']],
    ['lock list', () => api.lockList('/wc'), ['svn:lockList', '/wc']],
    [
      'checkout',
      () => api.checkout('https://repo/trunk', '/wc', '7', 'empty', { credentials }),
      ['svn:checkout', 'https://repo/trunk', '/wc', '7', 'empty', { credentials }],
    ],
    [
      'cancel checkout',
      () => api.cancelCheckout('checkout-123'),
      ['svn:cancelCheckout', 'checkout-123'],
    ],
    [
      'export',
      () => api.export('https://repo/trunk', '/out', '7'),
      ['svn:export', 'https://repo/trunk', '/out', '7'],
    ],
    [
      'import',
      () => api.import('/src', 'https://repo/trunk', 'import'),
      ['svn:import', '/src', 'https://repo/trunk', 'import'],
    ],
    ['resolve', () => api.resolve('/wc/a', 'working'), ['svn:resolve', '/wc/a', 'working']],
    [
      'switch',
      () => api.switch('/wc', 'https://repo/branch', '8'),
      ['svn:switch', '/wc', 'https://repo/branch', '8'],
    ],
    [
      'remote copy',
      () => api.copy('source', 'destination', 'copy'),
      ['svn:copy', 'source', 'destination', 'copy'],
    ],
    [
      'remote mkdir',
      () => api.remoteCreateFolder('https://repo', 'folder', 'mkdir', credentials),
      ['svn:remoteCreateFolder', 'https://repo', 'folder', 'mkdir', credentials],
    ],
    [
      'remote delete',
      () => api.remoteDelete('https://repo/a', 'delete', credentials),
      ['svn:remoteDelete', 'https://repo/a', 'delete', credentials],
    ],
    [
      'remote move',
      () => api.remoteMove('https://repo/a', 'https://repo/b', 'move', credentials),
      ['svn:remoteMove', 'https://repo/a', 'https://repo/b', 'move', credentials],
    ],
    [
      'merge',
      () => api.merge('source', '/wc', ['7'], [{ start: 2, end: 4 }], { recordOnly: true }),
      ['svn:merge', 'source', '/wc', ['7'], [{ start: 2, end: 4 }], { recordOnly: true }],
    ],
    ['relocate', () => api.relocate('old', 'new', '/wc'), ['svn:relocate', 'old', 'new', '/wc']],
    [
      'changelist add',
      () => api.changelist.add(['/wc/a'], 'review'),
      ['svn:changelist:add', ['/wc/a'], 'review'],
    ],
    [
      'changelist remove',
      () => api.changelist.remove(['/wc/a']),
      ['svn:changelist:remove', ['/wc/a']],
    ],
    ['changelist list', () => api.changelist.list('/wc'), ['svn:changelist:list', '/wc']],
    [
      'changelist delete',
      () => api.changelist.delete('review', '/wc'),
      ['svn:changelist:delete', 'review', '/wc'],
    ],
    ['move', () => api.move('/wc/a', '/wc/b'), ['svn:move', '/wc/a', '/wc/b']],
    ['local copy', () => api.copyLocal('/wc/a', '/wc/b'), ['svn:copyLocal', '/wc/a', '/wc/b']],
    ['shelf list', () => api.shelve.list('/wc'), ['svn:shelve:list', '/wc']],
    [
      'shelf save',
      () => api.shelve.save('work', '/wc', 'note'),
      ['svn:shelve:save', 'work', '/wc', 'note'],
    ],
    ['shelf apply', () => api.shelve.apply('work', '/wc'), ['svn:shelve:apply', 'work', '/wc']],
    ['shelf delete', () => api.shelve.delete('work', '/wc'), ['svn:shelve:delete', 'work', '/wc']],
    [
      'property list',
      () => api.proplist('/wc', propertyOptions),
      ['svn:proplist', '/wc', propertyOptions],
    ],
    [
      'property get',
      () => api.propget('/wc', 'svn:ignore', propertyOptions),
      ['svn:propget', '/wc', 'svn:ignore', propertyOptions],
    ],
    [
      'property set',
      () => api.propset('/wc', 'name', 'value'),
      ['svn:propset', '/wc', 'name', 'value'],
    ],
    ['property delete', () => api.propdel('/wc', 'name'), ['svn:propdel', '/wc', 'name']],
    [
      'remote property set',
      () => api.propsetRemote('url', 'name', 'value', 'message'),
      ['svn:propsetRemote', 'url', 'name', 'value', 'message'],
    ],
    [
      'remote property delete',
      () => api.propdelRemote('url', 'name', 'message'),
      ['svn:propdelRemote', 'url', 'name', 'message'],
    ],
    [
      'revision property get',
      () => api.revpropget('url', 'name', '7'),
      ['svn:revpropget', 'url', 'name', '7'],
    ],
    [
      'revision property set',
      () => api.revpropset('url', 'name', 'value', '7'),
      ['svn:revpropset', 'url', 'name', 'value', '7'],
    ],
    [
      'revision property delete',
      () => api.revpropdel('url', 'name', '7'),
      ['svn:revpropdel', 'url', 'name', '7'],
    ],
    ['blame', () => api.blame('/wc/a', 2, 7), ['svn:blame', '/wc/a', 2, 7, undefined]],
    [
      'list',
      () => api.list('https://repo', '7', 'files', credentials),
      ['svn:list', 'https://repo', '7', 'files', credentials],
    ],
    [
      'patch create',
      () => api.patch.create(['/wc/a'], '/tmp/a.patch'),
      ['svn:patch:create', ['/wc/a'], '/tmp/a.patch'],
    ],
    [
      'patch apply',
      () => api.patch.apply('/tmp/a.patch', '/wc', true, { reverse: true, stripCount: 1 }),
      ['svn:patch:apply', '/tmp/a.patch', '/wc', true, { reverse: true, stripCount: 1 }],
    ],
    ['external list', () => api.externals.list('/wc'), ['svn:externals:list', '/wc']],
    [
      'external add',
      () => api.externals.add('/wc', external),
      ['svn:externals:add', '/wc', external],
    ],
    [
      'external edit',
      () => api.externals.edit('/wc', 'vendor', external),
      ['svn:externals:edit', '/wc', 'vendor', external],
    ],
    [
      'external remove',
      () => api.externals.remove('/wc', 'vendor'),
      ['svn:externals:remove', '/wc', 'vendor'],
    ],
    [
      'external update',
      () => api.externals.update('/wc', 'vendor'),
      ['svn:externals:update', '/wc', 'vendor'],
    ],
    ['diagnostics', () => api.diagnostics('/wc'), ['svn:diagnostics', '/wc']],
    [
      'trust certificate',
      () => api.trustServerCertificate('https://repo', 'unknown CA'),
      ['svn:trustServerCertificate', 'https://repo', 'unknown CA'],
    ],
  ] as const)('passes exact IPC arguments for %s', async (_name, call, expected) => {
    await call();
    expect(invoke).toHaveBeenCalledWith(...expected);
  });

  it.each([
    [
      'update',
      () => api.updateWithProgress('/wc', vi.fn(), 'infinity', { ignoreExternals: true }),
      'svn:updateWithProgress',
      ['/wc', 'infinity', { ignoreExternals: true }],
    ],
    [
      'checkout',
      () => api.checkoutWithProgress('https://repo', '/wc', vi.fn(), '7', 'empty', { credentials }),
      'svn:checkoutWithProgress',
      ['https://repo', '/wc', '7', 'empty', { credentials }],
    ],
    [
      'commit',
      () => api.commitWithProgress(['/wc/a'], 'message', vi.fn()),
      'svn:commitWithProgress',
      [['/wc/a'], 'message'],
    ],
    [
      'export',
      () => api.exportWithProgress('https://repo', '/out', vi.fn(), '7'),
      'svn:exportWithProgress',
      ['https://repo', '/out', '7'],
    ],
    [
      'import',
      () => api.importWithProgress('/src', 'https://repo', 'message', vi.fn()),
      'svn:importWithProgress',
      ['/src', 'https://repo', 'message'],
    ],
    [
      'merge',
      () => api.mergeWithProgress('source', '/wc', vi.fn(), ['7'], undefined, { dryRun: true }),
      'svn:mergeWithProgress',
      ['source', '/wc', ['7'], undefined, { dryRun: true }],
    ],
  ] as const)('adds a stable operation ID for progress %s', async (_name, call, channel, args) => {
    await call();
    expect(invoke).toHaveBeenCalledWith(channel, expect.stringMatching(/^[a-z]+-\d+-/), ...args);
  });

  it('routes mutation notifications and removes only its own listener', () => {
    const callback = vi.fn();
    const unsubscribe = api.onMutation(callback);
    expect(ipcRenderer.on).toHaveBeenCalledWith('svn:mutation', expect.any(Function));

    const handler = vi.mocked(ipcRenderer.on).mock.calls[0][1];
    handler({} as never, { paths: ['/wc/a'] });
    expect(callback).toHaveBeenCalledWith({ paths: ['/wc/a'] });

    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('svn:mutation', handler);
  });

  it('cancels the exact worker job associated with an aborted read', async () => {
    const controller = new AbortController();
    let finishRead: (() => void) | undefined;
    invoke.mockImplementation((channel: string) => {
      if (channel === 'svn:cat') {
        return new Promise((resolve) => {
          finishRead = () => resolve({ path: '/wc/a', content: '', isBinary: false });
        });
      }
      return Promise.resolve({ success: true });
    });

    const read = api.cat('/wc/a', undefined, { signal: controller.signal });
    const workerJobId = invoke.mock.calls[0][3] as string;
    controller.abort();

    expect(invoke).toHaveBeenCalledWith('svn:cancelWorkerJob', workerJobId);
    finishRead?.();
    await read;
  });
});
