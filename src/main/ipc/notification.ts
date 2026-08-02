import { ipcMain } from 'electron';
import { notificationService, NotificationOptions } from '../services/NotificationService';

export function registerNotificationHandlers(): void {
  ipcMain.handle('notification:show', async (_, options: NotificationOptions) => {
    if (
      !options ||
      typeof options.title !== 'string' ||
      typeof options.body !== 'string' ||
      !['success', 'warning', 'error', 'info'].includes(options.type) ||
      options.title.length > 200 ||
      options.body.length > 2_000
    ) {
      throw new Error('Invalid notification');
    }
    return notificationService.show(options);
  });
}
