// @vitest-environment node

/*
 * macOS app-lifecycle coverage for the main entry point.
 *
 * The definitive macOS lifecycle rule lives in `window-all-closed` at the top
 * level of index.ts: on darwin the app stays alive when its last window closes
 * (the dock icon keeps it running), while Windows/Linux quit. That handler is
 * registered outside `app.whenReady()`, so by keeping whenReady pending we can
 * exercise it without driving the full ready body (IPC registration, window
 * creation, server start, electron-updater). Every local import gets an explicit
 * factory mock so no real main-process module body runs.
 *
 * The `activate` (dock-click window recreation) handler and the macOS window
 * chrome (hidden titleBar, trafficLightPosition) are registered inside the
 * ready body and remain uncovered here — they would need resolving whenReady
 * with fuller window mocks or a small extraction.
 */
import { describe, expect, it, vi } from 'vitest';

const appWhenReady = vi.hoisted(() => vi.fn(() => new Promise<void>(() => {})));
const appOn = vi.hoisted(() => vi.fn());
const appQuit = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    whenReady: appWhenReady,
    on: appOn,
    off: vi.fn(),
    quit: appQuit,
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

import '../index';

const originalPlatform = process.platform;

function lifecycleHandler(event: string): () => void {
  const call = appOn.mock.calls.find((entry) => entry[0] === event);
  if (!call) throw new Error(`Expected app.on('${event}', ...) to be registered`);
  return call[1] as () => void;
}

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    writable: true,
  });
}

describe('index: window-all-closed lifecycle (macOS boundary)', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('stays running on macOS when the last window closes (no quit)', () => {
    setPlatform('darwin');
    appQuit.mockClear();

    lifecycleHandler('window-all-closed')();

    expect(appQuit).not.toHaveBeenCalled();
  });

  it('quits on Windows when the last window closes', () => {
    setPlatform('win32');
    appQuit.mockClear();

    lifecycleHandler('window-all-closed')();

    expect(appQuit).toHaveBeenCalledTimes(1);
  });

  it('quits on Linux when the last window closes', () => {
    setPlatform('linux');
    appQuit.mockClear();

    lifecycleHandler('window-all-closed')();

    expect(appQuit).toHaveBeenCalledTimes(1);
  });
});
