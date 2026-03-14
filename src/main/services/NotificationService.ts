import { Notification } from 'electron';
import { getSettingsManager } from '../settings-manager';

export interface NotificationOptions {
  title: string;
  body: string;
  type: 'success' | 'warning' | 'error' | 'info';
  silent?: boolean;
}

export class NotificationService {
  private static instance: NotificationService;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  canShowNotifications(): boolean {
    if (!Notification.isSupported()) return false;
    const settings = getSettingsManager().getSettings();
    return settings.notifications?.enableSystemNotifications ?? true;
  }

  show(options: NotificationOptions): boolean {
    if (!this.canShowNotifications()) return false;

    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: options.silent ?? false,
    });

    notification.show();
    return true;
  }

  showCommitSuccess(revision: number, fileCount?: number): void {
    this.show({
      title: 'SVN Commit Complete',
      body: fileCount
        ? `Committed revision r${revision} (${fileCount} files)`
        : `Committed revision r${revision}`,
      type: 'success',
    });
  }

  showUpdateSuccess(revision: number, updatedFiles?: number): void {
    this.show({
      title: 'SVN Update Complete',
      body: updatedFiles
        ? `Updated to revision r${revision} (${updatedFiles} files)`
        : `Updated to revision r${revision}`,
      type: 'success',
    });
  }

  showConflictWarning(conflictedFiles: number): void {
    this.show({
      title: 'Conflicts Detected',
      body: `${conflictedFiles} file(s) have conflicts that need resolution`,
      type: 'warning',
    });
  }

  showError(operation: string, error: string): void {
    this.show({
      title: `${operation} Failed`,
      body: error,
      type: 'error',
    });
  }
}

export const notificationService = NotificationService.getInstance();
