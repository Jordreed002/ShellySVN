import { ipcMain } from 'electron';
import { notificationService, NotificationOptions } from '../services/NotificationService';

export function registerNotificationHandlers(): void {
  ipcMain.handle('notification:show', async (_, options: NotificationOptions) => {
    return notificationService.show(options);
  });
}
