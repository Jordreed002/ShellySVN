import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J4 — Background working-copy monitoring.
 *
 * The monitor IPC layer keeps an in-memory map of watched working copies and
 * refreshes their change state on a timer. Because it holds module-singleton
 * state, each test re-imports the module (vi.resetModules) for a clean map, and
 * the electron/approved-path/svn deps are mocked so no real svn process runs.
 */
const { handlers, mocks } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  mocks: {
    runSvnText: vi.fn(),
    assertPathApprovedForIpc: vi.fn(),
    parseSvnInfoSummaryXml: vi.fn(),
    parseSvnStatusEntriesXml: vi.fn(),
    closeFileWatchersForPath: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));
vi.mock('../../utils/approved-paths', () => ({
  assertPathApprovedForIpc: mocks.assertPathApprovedForIpc,
}));
vi.mock('../../services/svn-executor', () => ({ runSvnText: mocks.runSvnText }));
vi.mock('../../utils/svn-xml', () => ({
  parseSvnInfoSummaryXml: mocks.parseSvnInfoSummaryXml,
  parseSvnStatusEntriesXml: mocks.parseSvnStatusEntriesXml,
}));
vi.mock('../fs', () => ({ closeFileWatchersForPath: mocks.closeFileWatchersForPath }));

let registerMonitorHandlers: () => void;
let stopMonitoring: () => void;

beforeEach(async () => {
  handlers.clear();
  vi.clearAllMocks();
  mocks.assertPathApprovedForIpc.mockImplementation((p: string) => p);
  mocks.runSvnText.mockResolvedValue('xml');
  mocks.parseSvnInfoSummaryXml.mockReturnValue(null);
  mocks.parseSvnStatusEntriesXml.mockReturnValue([]);
  mocks.closeFileWatchersForPath.mockResolvedValue(undefined);

  // Fresh module => fresh in-memory monitor map + monitoring flag each test.
  vi.resetModules();
  const mod = await import('../monitor');
  registerMonitorHandlers = mod.registerMonitorHandlers;
  stopMonitoring = mod.stopMonitoring;
  registerMonitorHandlers();
});

afterEach(() => stopMonitoring());

function call(channel: string, ...args: unknown[]) {
  return handlers.get(channel)!({}, ...args);
}

describe('monitor IPC handlers', () => {
  it('starts with no monitored working copies', async () => {
    await expect(call('monitor:getWorkingCopies')).resolves.toEqual([]);
  });

  it('adds a working copy once svn info resolves', async () => {
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'https://svn/repo', revision: 5 });

    await expect(call('monitor:addWorkingCopy', '/wc')).resolves.toEqual({ success: true });

    const copies = (await call('monitor:getWorkingCopies')) as Array<{ path: string; url: string }>;
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ path: '/wc', url: 'https://svn/repo', isMonitored: true });
  });

  it('refuses to add a path that is not a working copy', async () => {
    mocks.parseSvnInfoSummaryXml.mockReturnValue(null);
    await expect(call('monitor:addWorkingCopy', '/not-a-wc')).resolves.toEqual({
      success: false,
      error: 'The selected path is not an SVN working copy.',
    });
  });

  it('reports a failure when the path is not approved', async () => {
    mocks.assertPathApprovedForIpc.mockImplementation(() => {
      throw new Error('path not approved');
    });
    await expect(call('monitor:addWorkingCopy', '/forbidden')).resolves.toEqual({
      success: false,
      error: 'path not approved',
    });
  });

  it('removes a monitored copy and reports removal', async () => {
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'u', revision: 1 });
    await call('monitor:addWorkingCopy', '/wc');

    await expect(call('monitor:removeWorkingCopy', '/wc')).resolves.toEqual({
      success: true,
      removed: true,
    });
    await expect(call('monitor:removeWorkingCopy', '/wc')).resolves.toEqual({
      success: true,
      removed: false,
    });
  });

  it('closes file watchers rooted at the copy being removed', async () => {
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'u', revision: 1 });
    await call('monitor:addWorkingCopy', '/wc');

    await expect(call('monitor:removeWorkingCopy', '/wc')).resolves.toEqual({
      success: true,
      removed: true,
    });

    expect(mocks.closeFileWatchersForPath).toHaveBeenCalledWith('/wc');
    await expect(call('monitor:getWorkingCopies')).resolves.toEqual([]);
  });

  it('still removes a monitored copy when watcher teardown fails', async () => {
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'u', revision: 1 });
    await call('monitor:addWorkingCopy', '/wc');
    mocks.closeFileWatchersForPath.mockRejectedValue(new Error('watcher teardown failed'));

    await expect(call('monitor:removeWorkingCopy', '/wc')).resolves.toEqual({
      success: true,
      removed: true,
    });
  });

  it('refreshes status and surfaces whether there are changes', async () => {
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'u', revision: 1 });
    await call('monitor:addWorkingCopy', '/wc');

    mocks.parseSvnStatusEntriesXml.mockReturnValue([{ path: '/wc/a.ts' }]);
    const refreshed = (await call('monitor:refreshStatus', '/wc')) as {
      hasChanges: boolean;
      lastChecked: number;
    } | null;
    expect(refreshed?.hasChanges).toBe(true);
    expect(refreshed?.lastChecked).toBeTypeOf('number');
  });

  it('returns null when refreshing an unknown working copy', async () => {
    await expect(call('monitor:refreshStatus', '/unknown')).resolves.toBeNull();
  });

  it('returns the last-known info when a status refresh fails', async () => {
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'u', revision: 1 });
    await call('monitor:addWorkingCopy', '/wc');

    mocks.runSvnText.mockRejectedValue(new Error('svn crashed'));
    const refreshed = await call('monitor:refreshStatus', '/wc');
    expect(refreshed).not.toBeNull();
  });

  it('starts and stops monitoring idempotently', async () => {
    await expect(call('monitor:startMonitoring')).resolves.toEqual({ success: true });
    // A second start is a no-op but still reports success.
    await expect(call('monitor:startMonitoring')).resolves.toEqual({ success: true });
    await expect(call('monitor:stopMonitoring')).resolves.toEqual({ success: true });
  });
});

describe('monitor registry helpers (item 60 relink support)', () => {
  async function freshMonitor() {
    // The outer beforeEach already imported a fresh module; grab our own
    // instance so the helpers under test come from the same module state.
    vi.resetModules();
    const mod = await import('../monitor');
    mod.registerMonitorHandlers();
    return mod;
  }

  it('snapshots monitored working copies without an IPC round-trip', async () => {
    const monitor = await freshMonitor();
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'https://svn/repo', revision: 5 });
    await call('monitor:addWorkingCopy', '/wc');

    expect(monitor.getMonitoredWorkingCopies()).toEqual([
      expect.objectContaining({ path: '/wc', url: 'https://svn/repo', isMonitored: true }),
    ]);
  });

  it('rekeys a monitored working copy when its folder moved (relink apply)', async () => {
    const monitor = await freshMonitor();
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'https://svn/repo', revision: 5 });
    await call('monitor:addWorkingCopy', '/old/wc');

    expect(monitor.renameMonitoredWorkingCopy('/old/wc', '/new/wc')).toBe(true);

    const copies = (await call('monitor:getWorkingCopies')) as Array<{
      path: string;
      url: string;
    }>;
    expect(copies).toEqual([
      expect.objectContaining({ path: '/new/wc', url: 'https://svn/repo' }),
    ]);
    // The old key is gone — no duplicate entries after a relink.
    await expect(call('monitor:removeWorkingCopy', '/old/wc')).resolves.toMatchObject({
      removed: false,
    });
    expect(monitor.getMonitoredWorkingCopies()).toHaveLength(1);
  });

  it('refuses renames for unknown, empty, or identical paths', async () => {
    const monitor = await freshMonitor();
    mocks.parseSvnInfoSummaryXml.mockReturnValue({ url: 'https://svn/repo', revision: 1 });
    await call('monitor:addWorkingCopy', '/wc');

    expect(monitor.renameMonitoredWorkingCopy('/missing', '/elsewhere')).toBe(false);
    expect(monitor.renameMonitoredWorkingCopy('', '/elsewhere')).toBe(false);
    expect(monitor.renameMonitoredWorkingCopy('/wc', '/wc')).toBe(false);
    expect(monitor.getMonitoredWorkingCopies()).toHaveLength(1);
  });
});
