import { app, BrowserWindow } from 'electron';
import { spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { registerSvnHandlers } from './ipc/svn';
import { registerDialogHandlers } from './ipc/dialog';
import { registerAppHandlers } from './ipc/app';
import { registerStoreHandlers } from './ipc/store';
import { registerFsHandlers } from './ipc/fs';
import { registerAuthHandlers } from './ipc/auth';
import { registerExternalHandlers } from './ipc/external';
import { registerMonitorHandlers } from './ipc/monitor';
import { registerShellIntegrationHandlers } from './shell/ShellIntegration';
import { setupProtocolHandler, registerDeepLinkHandler } from './services/protocol-handler';
import { registerNotificationHandlers } from './ipc/notification';
import { registerWebhookHandlers } from './ipc/webhook';
import { openValidatedExternalUrl } from './utils/external-url';

let mainWindow: BrowserWindow | null = null;
const isSmokeTest = process.argv.includes('--smoke-test');
const MIN_PACKAGED_BINARY_SIZE_BYTES = 1024;

function getPackagedBinaryPaths(): { engine: string; svn: string } {
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

  console.log('[smoke-test] ShellySVN main process initialized successfully.');
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
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 32 },
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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

  // HMR for renderer base on electron-vite cli
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Quit when all windows are closed, except on macOS
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.shellysvn');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Register IPC handlers
  registerSvnHandlers();
  registerDialogHandlers();
  registerAppHandlers();
  registerStoreHandlers();
  registerFsHandlers();
  registerAuthHandlers();
  registerExternalHandlers();
  registerMonitorHandlers();
  registerShellIntegrationHandlers();
  registerNotificationHandlers();
  registerWebhookHandlers();

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
      mainWindow?.webContents.send('deep-link', link);
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

  createWindow();

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
