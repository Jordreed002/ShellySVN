// @vitest-environment node

/*
 * Unit coverage for the app-lifecycle service (beta backlog items #22, #23,
 * #25): single-instance handoff, the suspend/resume connectivity gate, and
 * the startup signals for stale `.svn/lock` files and interrupted mutations.
 * Electron (app/BrowserWindow/ipcMain/powerMonitor) and the sibling SVN
 * services are mocked; stale-lock detection/removal runs against the real
 * svn-working-copy-health module on temp directories.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  return {
    lockFn: vi.fn(() => true) as (() => boolean) | undefined,
    appOn: vi.fn(),
    appQuit: vi.fn(),
    getPath: vi.fn(() => '/tmp/shelly-lifecycle-test'),
    getAllWindows: vi.fn(() => [] as Array<unknown>),
    ipcHandle: vi.fn(),
    powerMonitorOn: vi.fn(),
    powerMonitorAvailable: true,
    processDeepLink: vi.fn(),
    beginSvnNetworkSuspend: vi.fn(() => 0),
    endSvnNetworkSuspend: vi.fn(),
    // Stateful stand-ins for the executor gate so resume flows are observable.
    networkSuspended: false,
    suspendedUrls: [] as string[],
    readInterrupted: vi.fn(() => [] as Array<unknown>),
    clearInterrupted: vi.fn(),
    runSerializedWorkingCopyMutation: vi.fn(async (_key: string, task: () => Promise<unknown>) =>
      task()
    ),
    recentRepositories: [] as string[],
  };
});

vi.mock('electron', () => ({
  app: {
    get requestSingleInstanceLock() {
      return state.lockFn;
    },
    on: state.appOn,
    quit: state.appQuit,
    getPath: state.getPath,
    whenReady: vi.fn(() => new Promise<void>(() => {})),
  },
  BrowserWindow: { getAllWindows: state.getAllWindows },
  ipcMain: { handle: state.ipcHandle },
  get powerMonitor() {
    return state.powerMonitorAvailable ? { on: state.powerMonitorOn, off: vi.fn() } : undefined;
  },
}));

vi.mock('../services/protocol-handler', () => ({
  processDeepLink: state.processDeepLink,
}));

vi.mock('../services/svn-executor', () => ({
  runSvnText: vi.fn(),
  beginSvnNetworkSuspend: (...args: unknown[]) => {
    state.networkSuspended = true;
    return state.beginSvnNetworkSuspend(...args);
  },
  endSvnNetworkSuspend: (...args: unknown[]) => {
    state.networkSuspended = false;
    state.suspendedUrls = [];
    return state.endSvnNetworkSuspend(...args);
  },
  isSvnNetworkSuspended: () => state.networkSuspended,
  getSuspendedSvnNetworkUrls: () => state.suspendedUrls,
}));

vi.mock('../services/svn-mutation-queue', () => ({
  getMutationInterruptionJournalPath: vi.fn((userDataPath: string) =>
    join(userDataPath, 'svn-mutation-journal.json')
  ),
  markActiveWorkingCopyMutationsInterrupted: vi.fn(() => 0),
  readInterruptedWorkingCopyMutations: state.readInterrupted,
  clearInterruptedWorkingCopyMutations: state.clearInterrupted,
  // The interrupted-mutation recovery executor (item #31) serializes its steps
  // through the real mutation queue; stand it in so tests observe the task.
  runSerializedWorkingCopyMutation: state.runSerializedWorkingCopyMutation,
}));

vi.mock('../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: vi.fn(async () => undefined),
    getSettings: () => ({ recentRepositories: state.recentRepositories }),
  }),
}));

import {
  ensureSingleInstanceLock,
  extractDeepLinkArgv,
  getInterruptedMutationRecoveryPlans,
  handleSystemResume,
  handleSystemSuspend,
  initializeAppLifecycle,
  registerAppLifecycleIpcHandlers,
  registerPowerMonitorHandlers,
  resetAppLifecycleForTests,
} from '../services/app-lifecycle';
import { clearApprovedPathsForTests, approvePathForIpc } from '../utils/approved-paths';

const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function createWindowMock() {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
}

function secondInstanceHandlers(): Array<(event: unknown, argv: string[]) => void> {
  return state.appOn.mock.calls
    .filter((call) => call[0] === 'second-instance')
    .map((call) => call[1] as (event: unknown, argv: string[]) => void);
}

function ipcHandler(channel: string): (...args: unknown[]) => unknown {
  const call = state.ipcHandle.mock.calls.find((entry) => entry[0] === channel);
  if (!call) throw new Error(`Expected ipcMain.handle('${channel}', ...) registration`);
  return call[1] as (...args: unknown[]) => unknown;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAppLifecycleForTests();
  state.lockFn = vi.fn(() => true);
  state.readInterrupted.mockImplementation(() => []);
  state.networkSuspended = false;
  state.suspendedUrls = [];
  state.recentRepositories = [];
  state.powerMonitorAvailable = true;
});

afterEach(() => {
  setPlatform(originalPlatform);
  clearApprovedPathsForTests();
});

describe('ensureSingleInstanceLock (item #22)', () => {
  it('returns false without registering handoff when another instance holds the lock', () => {
    state.lockFn = vi.fn(() => false);

    const gotLock = ensureSingleInstanceLock({ getMainWindow: () => null });

    expect(gotLock).toBe(false);
    expect(state.appOn).not.toHaveBeenCalled();
  });

  it('focuses and restores the main window when a second instance launches', () => {
    const window = createWindowMock();
    window.isMinimized.mockReturnValue(true);
    const gotLock = ensureSingleInstanceLock({ getMainWindow: () => window as never });
    expect(gotLock).toBe(true);

    const [handler] = secondInstanceHandlers();
    expect(handler).toBeDefined();
    handler(undefined, ['/usr/bin/shellysvn']);

    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('ignores a destroyed window instead of throwing', () => {
    const window = createWindowMock();
    window.isDestroyed.mockReturnValue(true);
    ensureSingleInstanceLock({ getMainWindow: () => window as never });

    const [handler] = secondInstanceHandlers();
    expect(() => handler(undefined, [])).not.toThrow();
    expect(window.focus).not.toHaveBeenCalled();
  });

  it('forwards shellysvn:// argv to the protocol handler on macOS only', () => {
    const window = createWindowMock();
    const deepLink = 'shellysvn://open?path=/tmp/wc';
    const argv = ['/usr/bin/shellysvn', deepLink, '--flag'];

    setPlatform('darwin');
    ensureSingleInstanceLock({ getMainWindow: () => window as never });
    secondInstanceHandlers()[0](undefined, argv);
    expect(state.processDeepLink).toHaveBeenCalledWith(deepLink);

    state.processDeepLink.mockClear();
    setPlatform('win32');
    ensureSingleInstanceLock({ getMainWindow: () => window as never });
    secondInstanceHandlers().at(-1)?.(undefined, argv);
    // Windows/Linux deep links are relayed by the protocol handler's own
    // second-instance listener; a second relay would duplicate them.
    expect(state.processDeepLink).not.toHaveBeenCalled();
  });

  it('extracts only deep-link arguments from a raw argv', () => {
    expect(extractDeepLinkArgv(['a', 'shellysvn://checkout?url=x', 'b'])).toEqual([
      'shellysvn://checkout?url=x',
    ]);
    expect(extractDeepLinkArgv(['https://example.com'])).toEqual([]);
  });

  it('treats a missing lock API as the sole instance (test harnesses)', () => {
    state.lockFn = undefined;
    const gotLock = ensureSingleInstanceLock({ getMainWindow: () => null });
    expect(gotLock).toBe(true);
  });
});

describe('power monitor suspend/resume gate (item #25)', () => {
  it('registers suspend and resume handlers once', () => {
    registerPowerMonitorHandlers();
    registerPowerMonitorHandlers();

    const events = state.powerMonitorOn.mock.calls.map((call) => call[0]);
    expect(events).toEqual(['suspend', 'resume']);
  });

  it('does not throw when powerMonitor is unavailable', () => {
    state.powerMonitorAvailable = false;
    expect(() => registerPowerMonitorHandlers()).not.toThrow();
  });

  it('closes the network gate on suspend via the powerMonitor handler', async () => {
    registerPowerMonitorHandlers();
    const suspendHandler = state.powerMonitorOn.mock.calls.find(
      (call) => call[0] === 'suspend'
    )?.[1] as () => void;

    suspendHandler();
    await Promise.resolve();

    expect(state.beginSvnNetworkSuspend).toHaveBeenCalledTimes(1);
    expect(state.networkSuspended).toBe(true);
  });

  it('releases the gate after a successful connectivity probe on resume', async () => {
    state.networkSuspended = true;
    state.suspendedUrls = ['https://svn.example.com/repo/trunk'];
    const probe = vi.fn(async () => true);

    await handleSystemResume({ probe, backoffMs: 1 });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(['https://svn.example.com/repo/trunk']);
    expect(state.endSvnNetworkSuspend).toHaveBeenCalledTimes(1);
  });

  it('retries the probe with backoff before releasing the gate', async () => {
    state.networkSuspended = true;
    const probe = vi
      .fn(async () => false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await handleSystemResume({ probe, backoffMs: 1 });

    expect(probe).toHaveBeenCalledTimes(2);
    expect(state.endSvnNetworkSuspend).toHaveBeenCalledTimes(1);
  });

  it('opens the gate after a bounded budget even if connectivity stays unverified', async () => {
    state.networkSuspended = true;
    const probe = vi.fn(async () => false);

    await handleSystemResume({ probe, maxTotalMs: 0, backoffMs: 1 });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(state.endSvnNetworkSuspend).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the gate is already open', async () => {
    const probe = vi.fn(async () => true);
    await handleSystemResume({ probe });
    expect(probe).not.toHaveBeenCalled();
    expect(state.endSvnNetworkSuspend).not.toHaveBeenCalled();
  });

  it('suspend/resume handlers drive the mocked executor gate end to end', async () => {
    registerPowerMonitorHandlers();
    const resumeHandler = state.powerMonitorOn.mock.calls.find(
      (call) => call[0] === 'resume'
    )?.[1] as () => void;

    state.suspendedUrls = [];
    await handleSystemSuspend();
    expect(state.networkSuspended).toBe(true);

    resumeHandler();
    await vi.waitFor(() => expect(state.endSvnNetworkSuspend).toHaveBeenCalledTimes(1));
    expect(state.networkSuspended).toBe(false);
  });
});

describe('startup signals and IPC surface (items #23/#24)', () => {
  let userDataPath: string;

  beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'shelly-lifecycle-'));
    state.getPath.mockReturnValue(userDataPath);
  });

  afterEach(async () => {
    await rm(userDataPath, { recursive: true, force: true });
  });

  function rendererWindow() {
    const send = vi.fn();
    state.getAllWindows.mockReturnValue([{ webContents: { isDestroyed: () => false, send } }]);
    return send;
  }

  async function createWorkingCopy(lockKind: 'file' | 'directory' | 'none') {
    const root = await mkdtemp(join(tmpdir(), 'shelly-wc-'));
    await mkdir(join(root, '.svn'), { recursive: true });
    if (lockKind !== 'none') {
      if (lockKind === 'file') {
        await writeFile(join(root, '.svn', 'lock'), '', { mode: 0o600 });
      } else {
        await mkdir(join(root, '.svn', 'lock'), { recursive: true });
      }
    }
    return root;
  }

  it('broadcasts interrupted mutations from the previous session journal', async () => {
    const send = rendererWindow();
    const record = {
      workingCopyPath: '/tmp/wc',
      interruptedAt: '2026-01-01T00:00:00.000Z',
      reason: 'quit-cancelled-operations',
    };
    state.readInterrupted.mockReturnValue([record]);

    await initializeAppLifecycle();

    expect(send).toHaveBeenCalledWith(
      'lifecycle:interruptedWorkingCopyMutations',
      expect.arrayContaining([record])
    );
  });

  it('does not broadcast an interruption event when the journal is empty', async () => {
    const send = rendererWindow();
    state.readInterrupted.mockReturnValue([]);

    await initializeAppLifecycle();

    const channels = send.mock.calls.map((call) => call[0]);
    expect(channels).not.toContain('lifecycle:interruptedWorkingCopyMutations');
  });

  it('detects a stale .svn/lock file on recently opened working copies and signals the renderer', async () => {
    const send = rendererWindow();
    const lockedRoot = await createWorkingCopy('file');
    const cleanRoot = await createWorkingCopy('none');
    const directoryLockRoot = await createWorkingCopy('directory');
    state.recentRepositories = [
      'https://svn.example.com/repo', // URLs are skipped
      join(lockedRoot, 'nested', 'deeper'), // resolved up to the WC root
      cleanRoot,
      directoryLockRoot, // directory-shaped locks are out of scope
    ];
    await mkdir(join(lockedRoot, 'nested', 'deeper'), { recursive: true });

    await initializeAppLifecycle();

    const staleEvents = send.mock.calls.filter(
      (call) => call[0] === 'lifecycle:staleWorkingCopyLock'
    );
    expect(staleEvents).toHaveLength(1);
    expect(staleEvents[0][1]).toMatchObject({
      workingCopyPath: expect.stringContaining('shelly-wc-'),
      lockPath: expect.stringContaining(join('.svn', 'lock')),
    });
    expect(staleEvents[0][1].lockPath.startsWith(lockedRoot)).toBe(true);

    await Promise.all([
      rm(lockedRoot, { recursive: true, force: true }),
      rm(cleanRoot, { recursive: true, force: true }),
      rm(directoryLockRoot, { recursive: true, force: true }),
    ]);
  });

  it('runs the startup checks only once', async () => {
    rendererWindow();
    await initializeAppLifecycle();
    await initializeAppLifecycle();
    expect(state.readInterrupted).toHaveBeenCalledTimes(1);
  });

  it('survives a journal read failure', async () => {
    rendererWindow();
    state.readInterrupted.mockImplementation(() => {
      throw new Error('disk error');
    });
    await expect(initializeAppLifecycle()).resolves.toBeUndefined();
  });

  it('registers the lifecycle IPC channels', () => {
    registerAppLifecycleIpcHandlers();
    registerAppLifecycleIpcHandlers();

    const channels = state.ipcHandle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        'lifecycle:getStaleWorkingCopyLocks',
        'lifecycle:removeStaleWorkingCopyLock',
        'lifecycle:getInterruptedWorkingCopyMutations',
        'lifecycle:clearInterruptedWorkingCopyMutations',
      ])
    );
  });

  it('removes a stale .svn/lock file only for an approved working copy, on explicit request', async () => {
    const root = await createWorkingCopy('file');
    approvePathForIpc(root, 'directory');
    registerAppLifecycleIpcHandlers();
    const handler = ipcHandler('lifecycle:removeStaleWorkingCopyLock');

    const approved = (await handler(undefined, root)) as { success: boolean; error?: string };
    expect(approved.success).toBe(true);

    const unapproved = (await handler(undefined, '/definitely/not/approved/wc')) as {
      success: boolean;
      error?: string;
    };
    expect(unapproved.success).toBe(false);
    expect(unapproved.error).toMatch(/only allowed inside a folder selected/i);

    const missing = (await handler(undefined, root)) as { success: boolean; error?: string };
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/no stale/i);

    await rm(root, { recursive: true, force: true });
  });

  it('rejects malformed cleanup requests', async () => {
    registerAppLifecycleIpcHandlers();
    const handler = ipcHandler('lifecycle:removeStaleWorkingCopyLock');

    const invalid = (await handler(undefined, '   ')) as { success: boolean };
    expect(invalid.success).toBe(false);
  });

  it('clears the interruption journal on renderer acknowledgement', async () => {
    registerAppLifecycleIpcHandlers();
    state.readInterrupted.mockReturnValue([
      {
        workingCopyPath: '/tmp/wc',
        interruptedAt: '2026-01-01T00:00:00.000Z',
        reason: 'shutdown',
      },
    ]);
    await initializeAppLifecycle();

    const clear = ipcHandler('lifecycle:clearInterruptedWorkingCopyMutations');
    const result = (await clear()) as { success: boolean };
    expect(result.success).toBe(true);
    expect(state.clearInterrupted).toHaveBeenCalledWith(
      join(userDataPath, 'svn-mutation-journal.json')
    );

    const remaining = ipcHandler('lifecycle:getInterruptedWorkingCopyMutations')() as unknown[];
    expect(remaining).toEqual([]);
  });

  it('composes interrupted mutations with current-state detection into recovery plans (item #31)', async () => {
    const send = rendererWindow();
    const root = await createWorkingCopy('file');
    state.readInterrupted.mockReturnValue([
      {
        workingCopyPath: root,
        interruptedAt: '2026-01-01T00:00:00.000Z',
        reason: 'shutdown',
      },
    ]);

    await initializeAppLifecycle();

    const planEvents = send.mock.calls.filter(
      (call) => call[0] === 'lifecycle:interruptedMutationRecoveryPlan'
    );
    expect(planEvents).toHaveLength(1);
    const plan = planEvents[0][1];
    expect(plan).toMatchObject({
      workingCopyPath: root,
      source: 'journal+detection',
      rationale: expect.stringContaining('shutdown'),
    });
    expect(plan.evidence.map((item: { kind: string }) => item.kind)).toEqual(['stale-admin-lock']);
    // Lock-only evidence: cleanup + verify, no inferred retry step.
    expect(plan.steps.map((step: { kind: string }) => step.kind)).toEqual([
      'svn-cleanup',
      'verify-status',
    ]);
    expect(getInterruptedMutationRecoveryPlans()).toEqual([plan]);

    await rm(root, { recursive: true, force: true });
  });

  it('does not propose a recovery plan when the journal has no current-state corroboration', async () => {
    const send = rendererWindow();
    const root = await createWorkingCopy('none');
    state.readInterrupted.mockReturnValue([
      {
        workingCopyPath: root,
        interruptedAt: '2026-01-01T00:00:00.000Z',
        reason: 'shutdown',
      },
    ]);

    await initializeAppLifecycle();

    const channels = send.mock.calls.map((call) => call[0]);
    expect(channels).not.toContain('lifecycle:interruptedMutationRecoveryPlan');
    expect(getInterruptedMutationRecoveryPlans()).toEqual([]);

    await rm(root, { recursive: true, force: true });
  });

  it('registers the recovery-plan IPC channels and executes a plan only on explicit request', async () => {
    registerAppLifecycleIpcHandlers();
    const root = await createWorkingCopy('file');
    approvePathForIpc(root, 'directory');
    state.readInterrupted.mockReturnValue([
      {
        workingCopyPath: root,
        interruptedAt: '2026-01-01T00:00:00.000Z',
        reason: 'shutdown',
      },
    ]);
    await initializeAppLifecycle();
    expect(getInterruptedMutationRecoveryPlans()).toHaveLength(1);

    const channels = state.ipcHandle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        'lifecycle:getInterruptedMutationRecoveryPlans',
        'lifecycle:executeInterruptedMutationRecoveryPlan',
      ])
    );

    const getPlans = ipcHandler('lifecycle:getInterruptedMutationRecoveryPlans');
    expect((getPlans() as unknown[]).length).toBe(1);

    const execute = ipcHandler('lifecycle:executeInterruptedMutationRecoveryPlan');
    const executed = (await execute(undefined, root)) as {
      success: boolean;
      steps: Array<{ kind: string; success: boolean }>;
    };
    expect(executed.success).toBe(true);
    expect(executed.steps.map((step) => step.kind)).toEqual(['svn-cleanup', 'verify-status']);

    const unknown = (await execute(undefined, '/not/in/journal')) as {
      success: boolean;
      error?: string;
    };
    expect(unknown.success).toBe(false);
    expect(unknown.error).toMatch(/no interrupted-mutation recovery plan/i);

    const malformed = (await execute(undefined, '  ')) as { success: boolean };
    expect(malformed.success).toBe(false);

    await rm(root, { recursive: true, force: true });
  });
});
