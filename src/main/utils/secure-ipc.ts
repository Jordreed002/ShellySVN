import { ipcMain, type IpcMainInvokeEvent } from 'electron';

let installed = false;

function sanitizeIpcError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : 'Request failed';
  const safe = raw
    .replace(/(password|token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[redacted]@')
    .slice(0, 1_000);
  return new Error(safe || 'Request failed');
}

/**
 * Installs one boundary around every invoke handler registered afterwards.
 * Tests register handlers without installing this process-level boundary and
 * can continue to call their captured listeners directly.
 */
export function installSecureIpcBoundary(getAuthorizedSenderId: () => number | undefined): void {
  if (installed) return;
  installed = true;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ) => {
    originalHandle(channel, async (event, ...args) => {
      const authorizedSenderId = getAuthorizedSenderId();
      if (authorizedSenderId === undefined || event.sender.id !== authorizedSenderId) {
        throw new Error('Unauthorized IPC sender');
      }
      try {
        return await listener(event, ...args);
      } catch (error) {
        throw sanitizeIpcError(error);
      }
    });
  }) as typeof ipcMain.handle;
}
