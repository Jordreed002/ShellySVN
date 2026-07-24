import { ipcMain, dialog } from 'electron';
import type { ConfirmDialogOptions, FileFilter, MessageDialogOptions } from '@shared/types';
import { approvePathForIpc } from '../utils/approved-paths';

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return approvePathForIpc(result.filePaths[0]);
  });

  ipcMain.handle('dialog:openFile', async (_, filters?: FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return approvePathForIpc(result.filePaths[0]);
  });

  ipcMain.handle('dialog:saveFile', async (_, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return approvePathForIpc(result.filePath);
  });

  ipcMain.handle('dialog:showMessage', async (_, options: MessageDialogOptions) => {
    await dialog.showMessageBox({
      type: options.type ?? 'info',
      title: options.title ?? 'ShellySVN',
      message: options.message,
      detail: options.detail,
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
    });
  });

  ipcMain.handle('dialog:confirm', async (_, options: ConfirmDialogOptions): Promise<boolean> => {
    const result = await dialog.showMessageBox({
      type: options.type ?? 'warning',
      title: options.title ?? 'Confirm',
      message: options.message,
      detail: options.detail,
      buttons: [options.confirmLabel ?? 'OK', options.cancelLabel ?? 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });

    return result.response === 0;
  });
}
