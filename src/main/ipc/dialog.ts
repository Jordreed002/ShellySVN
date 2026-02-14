import { ipcMain, dialog } from 'electron'
import type { FileFilter } from '@shared/types'

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:openFile', async (_, filters?: FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters
    })
    
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName
    })
    
    if (result.canceled || !result.filePath) {
      return null
    }
    
    return result.filePath
  })
}
