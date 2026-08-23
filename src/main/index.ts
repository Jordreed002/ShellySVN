import { app, BrowserWindow, dialog, ipcMain, type MessageBoxOptions } from 'electron';
import { spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { registerSvnHandlers } from './ipc/svn';
import { registerDialogHandlers } from './ipc/dialog';
import { registerAppHandlers } from './ipc/app';
import { registerStoreHandlers } from './ipc/store';
import { closeAllFileWatchers, registerFsHandlers } from './ipc/fs';
import { registerAuthHandlers } from './ipc/auth';
import { registerExternalHandlers } from './ipc/external';
import { registerMonitorHandlers, stopMonitoring } from './ipc/monitor';
import { registerShellIntegrationHandlers } from './shell/ShellIntegration';
import { setupProtocolHandler, registerDeepLinkHandler } from './services/protocol-handler';
import { registerNotificationHandlers } from './ipc/notification';
import { registerWebhookHandlers } from './ipc/webhook';
import { registerSvnCacheHandlers } from './ipc/svn-cache';
import { registerUpdaterHandlers } from './ipc/updater';
import { registerAiHandlers } from './ipc/ai';
import { openValidatedExternalUrl } from './utils/external-url';
import { shutdownSharedWorkerPool } from './workers/WorkerPool';
import { startLocalStatusServer, stopLocalStatusServer } from './services/local-status-server';
import { bootstrapApprovedPaths } from './utils/approved-paths';
import { sendToRenderer } from './utils/safe-renderer-send';
import { getUpdateService } from './services/update-service';
import { clearAuthSessions } from './services/auth-session-manager';
import { installRendererSecurityGuards, installSecureIpcBoundary } from './utils/secure-ipc';
import {
  beginWorkingCopyMutationShutdown,
  hasActiveWorkingCopyMutations,
  waitForWorkingCopyMutations,
} from './services/svn-mutation-queue';
import {
  ensureSingleInstanceLock,
  initializeAppLifecycle,
  persistInterruptedWorkingCopyMutations,
  registerAppLifecycleIpcHandlers,
  registerPowerMonitorHandlers,
} from './services/app-lifecycle';
import { terminateAllSvnProcesses } from './services/svn-runner';
import {
  cancelAllSvnProgressOperations,
  hasActiveSvnProgressOperations,
} from './services/svn-progress';
import { cancelAllUpdates } from './services/svn-working-copy';
import { cancelAllAiCommitMessages } from './services/ai-commit-message';

let mainWindow: BrowserWindow | null = null;
let shutdownPromise: Promise<void> | null = null;
let quitApproved = false;
let quitPromptOpen = false;
const isSmokeTest = process.argv.includes('--smoke-test');
const MIN_PACKAGED_BINARY_SIZE_BYTES = 1024;

// Acquire the OS-level single-instance lock before anything else so a second
// launch hands off to this instance (focus + deep-link relay) instead of
// racing it for working-copy mutations. Electron treats a repeated request
// from the same process as granted, so the protocol handler's own lock use
// on Windows/Linux stays compatible.
const gotSingleInstanceLock = ensureSingleInstanceLock({
  getMainWindow: () => mainWindow,
});
if (!gotSingleInstanceLock) {
  app.quit();
}

function getTrustedRendererUrl(): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return process.env['ELECTRON_RENDERER_URL'];
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString();
}

export function getPackagedBinaryPaths(): { engine: string; svn: string } {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const binariesPath = join(process.resourcesPath, 'binaries');

  return {
    engine: join(binariesPath, `shelly-engine${extension}`),
    svn: join(binariesPath, 'svn', `svn${extension}`),
  };
}

function verifyPackagedExecutable(filePath: string, args: string[], label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`);
  }
  if (stats.size < MIN_PACKAGED_BINARY_SIZE_BYTES) {
    throw new Error(`${label} is too small (${stats.size} bytes): ${filePath}`);
  }

  const result = spawnSync(filePath, args, {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${label} failed to execute: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} version check failed with exit ${result.status}: ${output}`);
  }
}

function runSmokeTest(): number {
  const rendererPath = join(__dirname, '../renderer/index.html');
  if (!is.dev && !existsSync(rendererPath)) {
    throw new Error(`Missing packaged renderer entry: ${rendererPath}`);
  }

  if (app.isPackaged) {
    const binaries = getPackagedBinaryPaths();
    verifyPackagedExecutable(binaries.engine, ['--version'], 'packaged logic engine');
    verifyPackagedExecutable(binaries.svn, ['--version', '--quiet'], 'packaged SVN client');
  }

  console.log(`[smoke-test] ShellySVN ${app.getVersion()} main process initialized successfully.`);
  return 0;
}

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // `titleBarOverlay` creates Windows' native caption strip even alongside a
    // frameless option, so omit the native title-bar options entirely there.
    // The renderer already supplies themed controls for the frameless window.
    ...(process.platform === 'win32'
      ? { frame: false }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { height: 32 },
          trafficLightPosition: { x: 15, y: 10 },
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openValidatedExternalUrl(details.url).catch((error) => {
      console.error('[SECURITY] Failed to open external URL:', error);
    });
    return { action: 'deny' };
  });

  installRendererSecurityGuards(mainWindow.webContents, getTrustedRendererUrl());

  // HMR for renderer base on electron-vite cli
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function shutdownApplicationServices(): Promise<void> {
  stopMonitoring();
  clearAuthSessions();
  shutdownPromise ??= Promise.all([
    closeAllFileWatchers(),
    stopLocalStatusServer(),
    shutdownSharedWorkerPool(),
    cancelAllAiCommitMessages(),
    // Safety net for any spawned SVN child no cancel path owned: SIGTERM,
    // then a bounded SIGKILL escalation.
    terminateAllSvnProcesses(),
  ]).then(() => undefined);
  getUpdateService().dispose();
  return shutdownPromise;
}

// Quit when all windows are closed, except on macOS
app.whenReady().then(async () => {
  // A second instance holds the lock: this process is quitting quietly and
  // must not register handlers or create windows.
  if (!gotSingleInstanceLock) return;
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.shellysvn');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  installSecureIpcBoundary(() => mainWindow?.webContents.id, getTrustedRendererUrl);

  // Register IPC handlers
  registerSvnHandlers();
  registerDialogHandlers();
  registerAppHandlers();
  registerStoreHandlers();
  registerSvnCacheHandlers();
  registerFsHandlers();
  registerAuthHandlers();
  registerExternalHandlers();
  registerMonitorHandlers();
  registerShellIntegrationHandlers();
  registerNotificationHandlers();
  registerWebhookHandlers();
  registerUpdaterHandlers();
  registerAiHandlers(ipcMain);
  registerAppLifecycleIpcHandlers();
  startLocalStatusServer(app.getPath('userData')).catch((error) => {
    console.error('[StatusService] Failed to start local status server:', error);
  });

  // Setup deep link protocol handler
  setupProtocolHandler();

  // Wire deep links to renderer
  const deepLinkActions = [
    'checkout',
    'export',
    'open',
    'log',
    'diff',
    'commit',
    'update',
    'blame',
    'info',
  ] as const;
  deepLinkActions.forEach((action) => {
    registerDeepLinkHandler(action, (link) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        sendToRenderer(mainWindow.webContents, 'deep-link', link);
      }
    });
  });

  if (isSmokeTest) {
    try {
      process.exitCode = runSmokeTest();
    } catch (error) {
      console.error(`[smoke-test] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    app.quit();
    return;
  }

  // Restore approvals before creating the renderer. Otherwise the Files route
  // can race startup, receive a false denial for a persisted path, and cache
  // that failed query for the rest of the session.
  try {
    await bootstrapApprovedPaths();
  } catch (error) {
    console.error('[approved-paths] Bootstrap failed:', error);
  }

  createWindow();
  registerPowerMonitorHandlers();
  void initializeAppLifecycle();
  void getUpdateService().initialize(shutdownApplicationServices);

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (quitApproved) {
    void shutdownApplicationServices();
    return;
  }
  if (!hasActiveWorkingCopyMutations() && !hasActiveSvnProgressOperations()) {
    void shutdownApplicationServices();
    return;
  }
  event.preventDefault();
  if (quitPromptOpen) return;
  quitPromptOpen = true;
  const quitDialogOptions: MessageBoxOptions = {
    type: 'warning',
    title: 'SVN operation in progress',
    message: 'One or more working copies are being changed.',
    detail: 'Keep ShellySVN open until the operations finish, or cancel them before quitting.',
    buttons: ['Keep App Open', 'Cancel Operations and Quit'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const prompt = mainWindow
    ? dialog.showMessageBox(mainWindow, quitDialogOptions)
    : dialog.showMessageBox(quitDialogOptions);
  void prompt
    .then(async ({ response }) => {
      if (response !== 1) return;
      // Journal the in-flight mutations before cancelling them so the next
      // launch can offer recovery for exactly those working copies.
      persistInterruptedWorkingCopyMutations('quit-cancelled-operations');
      beginWorkingCopyMutationShutdown();
      cancelAllUpdates();
      cancelAllSvnProgressOperations();
      await waitForWorkingCopyMutations();
      await shutdownApplicationServices();
      quitApproved = true;
      app.quit();
    })
    .finally(() => {
      quitPromptOpen = false;
    });
});

// Handle certificate errors (for self-signed SVN servers)
// SECURITY: We log certificate errors but do NOT automatically accept them.
// SVN certificate handling is done at the SVN command level with --trust-server-cert-failures
// which requires explicit user consent through the UI.
app.on('certificate-error', (_event, _webContents, url, error, _certificate, callback) => {
  // SECURITY: Log certificate error without exposing sensitive certificate details
  // Only log the URL (truncated) and error type for audit purposes
  const safeUrl = url.length > 100 ? url.substring(0, 100) + '...' : url;
  console.warn(`[SECURITY] Certificate error for ${safeUrl}: ${error}`);

  // Block the certificate - do not automatically accept
  // This ensures HTTPS connections in the app (like webhook calls) are secure
  // SVN-specific certificate handling is done via SVN command options
  callback(false);
});
