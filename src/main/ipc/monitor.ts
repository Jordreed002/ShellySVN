import { ipcMain } from 'electron';
import type { WorkingCopyInfo } from '@shared/types';
import { MONITOR_REFRESH_INTERVAL_MS } from '@shared/constants';
import { parseSvnInfoSummaryXml, parseSvnStatusEntriesXml } from '../utils/svn-xml';
import { runSvnText } from '../services/svn-executor';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { withSvnTargets } from '../utils/svn-targets';
import { closeFileWatchersForPath } from './fs';

// In-memory storage for monitored working copies
let monitoredWorkingCopies: Map<string, WorkingCopyInfo> = new Map();
let monitorTimer: NodeJS.Timeout | null = null;
let monitoring = false;

async function runMonitorCycle(): Promise<void> {
  if (!monitoring) return;
  for (const [path, info] of monitoredWorkingCopies) {
    if (!monitoring) return;
    if (info.isMonitored) {
      try {
        const status = await getSvnStatus(path);
        info.hasChanges = status.entries.length > 0;
        info.lastChecked = Date.now();
        monitoredWorkingCopies.set(path, info);
      } catch {
        // Background failures are retried on the next serialized cycle.
      }
    }
  }
  if (!monitoring) return;
  monitorTimer = setTimeout(() => void runMonitorCycle(), MONITOR_REFRESH_INTERVAL_MS);
  monitorTimer.unref();
}

export function stopMonitoring(): void {
  monitoring = false;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = null;
}

export function registerMonitorHandlers(): void {
  // Get all monitored working copies
  ipcMain.handle('monitor:getWorkingCopies', async (): Promise<WorkingCopyInfo[]> => {
    return Array.from(monitoredWorkingCopies.values());
  });

  // Add a working copy to monitor
  ipcMain.handle(
    'monitor:addWorkingCopy',
    async (_, path: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const approvedPath = assertPathApprovedForIpc(path, 'Working-copy monitoring');
        // Get info about the working copy
        const info = await getSvnInfo(approvedPath);
        if (!info) {
          return { success: false, error: 'The selected path is not an SVN working copy.' };
        }
        monitoredWorkingCopies.set(approvedPath, {
          path: approvedPath,
          url: info.url,
          revision: info.revision,
          hasChanges: false,
          lastChecked: Date.now(),
          isMonitored: true,
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Remove a working copy from monitor
  ipcMain.handle(
    'monitor:removeWorkingCopy',
    async (_, path: string): Promise<{ success: boolean; removed: boolean }> => {
      const approvedPath = assertPathApprovedForIpc(path, 'Working-copy monitoring');
      try {
        // Retire file watchers rooted at the removed copy so they cannot keep
        // firing against a working copy the user just removed.
        await closeFileWatchersForPath(approvedPath);
      } catch {
        // Watcher teardown must never block monitor removal.
      }
      return { success: true, removed: monitoredWorkingCopies.delete(approvedPath) };
    }
  );

  // Refresh status of a working copy
  ipcMain.handle(
    'monitor:refreshStatus',
    async (_, path: string): Promise<WorkingCopyInfo | null> => {
      const approvedPath = assertPathApprovedForIpc(path, 'Working-copy monitoring');
      const info = monitoredWorkingCopies.get(approvedPath);
      if (!info) return null;

      try {
        const status = await getSvnStatus(approvedPath);
        info.hasChanges = status.entries.length > 0;
        info.lastChecked = Date.now();
        monitoredWorkingCopies.set(approvedPath, info);
        return info;
      } catch {
        return info;
      }
    }
  );

  // Start monitoring (periodic refresh)
  ipcMain.handle('monitor:startMonitoring', async () => {
    if (monitoring) return { success: true };
    monitoring = true;
    monitorTimer = setTimeout(() => void runMonitorCycle(), MONITOR_REFRESH_INTERVAL_MS);
    monitorTimer.unref();
    return { success: true };
  });

  // Stop monitoring
  ipcMain.handle('monitor:stopMonitoring', async () => {
    stopMonitoring();
    return { success: true };
  });
}

// Helper to get SVN info
async function getSvnInfo(path: string): Promise<{ url: string; revision: number } | null> {
  try {
    const stdout = await runSvnText(withSvnTargets(['info', '--xml'], [path]), { cwd: path });
    return parseSvnInfoSummaryXml(stdout);
  } catch {
    return null;
  }
}

// Helper to get SVN status
async function getSvnStatus(path: string): Promise<{ entries: { path: string }[] }> {
  try {
    const stdout = await runSvnText(withSvnTargets(['status', '--xml'], [path]), { cwd: path });
    return { entries: parseSvnStatusEntriesXml(stdout).map((entry) => ({ path: entry.path })) };
  } catch {
    return { entries: [] };
  }
}
