// @vitest-environment node

/*
 * Windows coverage for the main entry point's packaged-binary resolution.
 * getPackagedBinaryPaths builds the bundled shelly-engine / svn launcher paths
 * with a `.exe` suffix on win32 and no suffix elsewhere. It reads
 * process.resourcesPath + process.platform only, so by stubbing resourcesPath
 * and forcing the platform we can pin both branches without driving the full
 * ready body. Every local import gets an explicit factory mock (mirroring
 * index.macos.test.ts) so no real main-process module body runs.
 */
import { describe, expect, it, afterEach } from 'vitest';

const appWhenReady = vi.hoisted(() => vi.fn(() => new Promise<void>(() => {})));
const appOn = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    whenReady: appWhenReady,
    on: appOn,
    off: vi.fn(),
    quit: vi.fn(),
    getPath: vi.fn(() => '/tmp/shelly-test'),
    getVersion: vi.fn(() => '1.0.0-test'),
    isPackaged: false,
  },
  BrowserWindow: Object.assign(vi.fn(), { getAllWindows: vi.fn(() => []) }),
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false, prod: false },
}));

vi.mock('../ipc/svn', () => ({ registerSvnHandlers: vi.fn() }));
vi.mock('../ipc/dialog', () => ({ registerDialogHandlers: vi.fn() }));
vi.mock('../ipc/app', () => ({ registerAppHandlers: vi.fn() }));
vi.mock('../ipc/store', () => ({ registerStoreHandlers: vi.fn() }));
vi.mock('../ipc/fs', () => ({ closeAllFileWatchers: vi.fn(), registerFsHandlers: vi.fn() }));
vi.mock('../ipc/auth', () => ({ registerAuthHandlers: vi.fn() }));
vi.mock('../ipc/external', () => ({ registerExternalHandlers: vi.fn() }));
vi.mock('../ipc/monitor', () => ({ registerMonitorHandlers: vi.fn(), stopMonitoring: vi.fn() }));
vi.mock('../shell/ShellIntegration', () => ({ registerShellIntegrationHandlers: vi.fn() }));
vi.mock('../services/protocol-handler', () => ({
  setupProtocolHandler: vi.fn(),
  registerDeepLinkHandler: vi.fn(),
}));
vi.mock('../ipc/notification', () => ({ registerNotificationHandlers: vi.fn() }));
vi.mock('../ipc/webhook', () => ({ registerWebhookHandlers: vi.fn() }));
vi.mock('../ipc/svn-cache', () => ({ registerSvnCacheHandlers: vi.fn() }));
vi.mock('../ipc/updater', () => ({ registerUpdaterHandlers: vi.fn() }));
vi.mock('../utils/external-url', () => ({ openValidatedExternalUrl: vi.fn() }));
vi.mock('../workers/WorkerPool', () => ({ shutdownSharedWorkerPool: vi.fn() }));
vi.mock('../services/local-status-server', () => ({
  startLocalStatusServer: vi.fn(),
  stopLocalStatusServer: vi.fn(),
}));
vi.mock('../utils/approved-paths', () => ({ bootstrapApprovedPaths: vi.fn() }));
vi.mock('../utils/safe-renderer-send', () => ({ sendToRenderer: vi.fn() }));
vi.mock('../services/update-service', () => ({
  getUpdateService: vi.fn(() => ({ initialize: vi.fn(), dispose: vi.fn() })),
}));
vi.mock('../services/auth-session-manager', () => ({ clearAuthSessions: vi.fn() }));
vi.mock('../utils/secure-ipc', () => ({ installSecureIpcBoundary: vi.fn() }));
vi.mock('../services/app-lifecycle', () => ({
  ensureSingleInstanceLock: vi.fn(() => true),
  initializeAppLifecycle: vi.fn(() => Promise.resolve()),
  persistInterruptedWorkingCopyMutations: vi.fn(),
  registerAppLifecycleIpcHandlers: vi.fn(),
  registerPowerMonitorHandlers: vi.fn(),
}));

import { getPackagedBinaryPaths } from '../index';

const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    writable: true,
  });
}

function setResourcesPath(path: string): void {
  Object.defineProperty(process, 'resourcesPath', { value: path, configurable: true });
}

describe('getPackagedBinaryPaths — Windows .exe resolution', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('appends .exe to the bundled launchers on Windows', () => {
    setPlatform('win32');
    setResourcesPath('/fake/resources');

    const paths = getPackagedBinaryPaths();

    expect(paths.engine.endsWith('shelly-engine.exe')).toBe(true);
    expect(paths.svn.endsWith('svn.exe')).toBe(true);
    // Both live under <resources>/binaries (svn under a nested svn dir).
    expect(paths.engine).toContain('binaries');
    expect(paths.svn).toContain('binaries');
  });

  it('uses extension-less launcher names on POSIX (platform boundary)', () => {
    setPlatform('darwin');
    setResourcesPath('/fake/resources');

    const paths = getPackagedBinaryPaths();

    expect(paths.engine.endsWith('shelly-engine')).toBe(true);
    expect(paths.svn.endsWith('svn')).toBe(true);
    expect(paths.engine.endsWith('.exe')).toBe(false);
    expect(paths.svn.endsWith('.exe')).toBe(false);
  });
});
