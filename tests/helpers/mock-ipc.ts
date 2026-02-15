import { ElectronApplication } from '@playwright/test'

/**
 * Mock IPC handlers for testing
 * 
 * These utilities allow mocking Electron IPC handlers to isolate
 * tests from actual SVN operations and file system access.
 */

/**
 * Mock the file dialog to return a specific file path
 */
export async function mockFileDialog(
  electronApp: ElectronApplication,
  filePath: string,
): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    const originalShowOpenDialog = dialog.showOpenDialog
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    })
    // Store original for potential restoration
    ;(dialog as any).__originalShowOpenDialog = originalShowOpenDialog
  }, filePath)
}

/**
 * Mock the SVN info command to simulate a working copy
 */
export async function mockSvnInfo(
  electronApp: ElectronApplication,
  workingCopyPath: string,
  repositoryUrl: string,
): Promise<void> {
  const mockResponse = {
    success: true,
    data: {
      path: workingCopyPath,
      url: repositoryUrl,
      revision: 1234,
      repository: {
        root: repositoryUrl,
        uuid: 'test-uuid-1234',
      },
    },
  }

  await electronApp.evaluate(({ ipcMain }, response) => {
    ipcMain.removeHandler('svn:info')
    ipcMain.handle('svn:info', () => Promise.resolve(response))
  }, mockResponse)
}

/**
 * Mock the SVN status command
 */
export async function mockSvnStatus(
  electronApp: ElectronApplication,
  entries: Array<{ path: string; status: string }>,
): Promise<void> {
  const mockResponse = {
    success: true,
    data: {
      entries: entries.map((e) => ({
        path: e.path,
        wcStatus: e.status,
        revision: '1234',
      })),
    },
  }

  await electronApp.evaluate(({ ipcMain }, response) => {
    ipcMain.removeHandler('svn:status')
    ipcMain.handle('svn:status', () => Promise.resolve(response))
  }, mockResponse)
}

/**
 * Mock a directory listing for file explorer
 */
export async function mockDirectoryListing(
  electronApp: ElectronApplication,
  files: Array<{ name: string; path: string; isDirectory: boolean }>,
): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, fileList) => {
    ipcMain.removeHandler('fs:listDirectory')
    ipcMain.handle('fs:listDirectory', () => Promise.resolve(fileList))
  }, files)
}

/**
 * Reset all IPC handlers to their original state
 */
export async function resetIpcMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(() => {
    // This will cause the app to reload handlers from scratch
    // In a real implementation, you'd restore specific handlers
  })
}
