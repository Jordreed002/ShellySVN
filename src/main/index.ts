import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerSvnHandlers } from './ipc/svn'
import { registerDialogHandlers } from './ipc/dialog'
import { registerAppHandlers } from './ipc/app'
import { registerStoreHandlers } from './ipc/store'
import { registerFsHandlers } from './ipc/fs'
import { registerAuthHandlers } from './ipc/auth'
import { registerExternalHandlers } from './ipc/external'
import { registerMonitorHandlers } from './ipc/monitor'
import { registerShellIntegrationHandlers } from './shell/ShellIntegration'
import { 
  setupProtocolHandler, 
  registerDeepLinkHandler 
} from './services/protocol-handler'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Quit when all windows are closed, except on macOS
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.shellysvn')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers
  registerSvnHandlers()
  registerDialogHandlers()
  registerAppHandlers()
  registerStoreHandlers()
  registerFsHandlers()
  registerAuthHandlers()
  registerExternalHandlers()
  registerMonitorHandlers()
  registerShellIntegrationHandlers()

  // Setup deep link protocol handler
  setupProtocolHandler()

  // Wire deep links to renderer
  const deepLinkActions = ['checkout', 'export', 'open', 'log', 'diff', 'commit', 'update', 'blame', 'info'] as const
  deepLinkActions.forEach(action => {
    registerDeepLinkHandler(action, (link) => {
      mainWindow?.webContents.send('deep-link', link)
    })
  })

  createWindow()

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle certificate errors (for self-signed SVN servers)
// SECURITY: We log certificate errors but do NOT automatically accept them.
// SVN certificate handling is done at the SVN command level with --trust-server-cert-failures
// which requires explicit user consent through the UI.
app.on('certificate-error', (_event, _webContents, url, error, _certificate, callback) => {
  // SECURITY: Log certificate error without exposing sensitive certificate details
  // Only log the URL (truncated) and error type for audit purposes
  const safeUrl = url.length > 100 ? url.substring(0, 100) + '...' : url
  console.warn(`[SECURITY] Certificate error for ${safeUrl}: ${error}`)
  
  // Block the certificate - do not automatically accept
  // This ensures HTTPS connections in the app (like webhook calls) are secure
  // SVN-specific certificate handling is done via SVN command options
  callback(false)
})
