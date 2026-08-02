import { ipcMain } from 'electron';
import { getUpdateService } from '../services/update-service';

export function registerUpdaterHandlers(): void {
  const updater = getUpdateService();
  ipcMain.handle('updater:getState', () => updater.getState());
  ipcMain.handle('updater:check', () => updater.check('manual'));
  ipcMain.handle('updater:download', () => updater.download());
  ipcMain.handle('updater:cancelDownload', () => updater.cancelDownload());
  ipcMain.handle('updater:restartAndInstall', () => updater.restartAndInstall());
}
