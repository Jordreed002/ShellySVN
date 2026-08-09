import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

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
export function installSecureIpcBoundary(
  getAuthorizedSenderId: () => number | undefined,
  getTrustedRendererUrl: () => string
): void {
  if (installed) return;
  installed = true;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ) => {
    originalHandle(channel, async (event, ...args) => {
      const authorizedSenderId = getAuthorizedSenderId();
      if (
        authorizedSenderId === undefined ||
        event.sender.id !== authorizedSenderId ||
        event.senderFrame === null ||
        event.senderFrame !== event.sender.mainFrame ||
        !isTrustedRendererUrl(event.senderFrame.url, getTrustedRendererUrl())
      ) {
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

/**
 * Packaged renderers may only run from the exact bundled index file. Development
 * navigation is limited to the origin configured by electron-vite so HMR and
 * client-side routes continue to work without trusting another web origin.
 */
function isTrustedRendererUrl(candidate: string, trustedEntryUrl: string): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const trustedUrl = new URL(trustedEntryUrl);

    if (trustedUrl.protocol === 'file:') {
      return (
        candidateUrl.protocol === 'file:' &&
        candidateUrl.host === trustedUrl.host &&
        candidateUrl.pathname === trustedUrl.pathname
      );
    }

    return (
      (trustedUrl.protocol === 'http:' || trustedUrl.protocol === 'https:') &&
      candidateUrl.origin === trustedUrl.origin
    );
  } catch {
    return false;
  }
}

type GuardedWebContents = Pick<WebContents, 'on' | 'session'>;

/** Install defense-in-depth guards before loading any renderer document. */
export function installRendererSecurityGuards(
  webContents: GuardedWebContents,
  trustedEntryUrl: string
): void {
  webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl, trustedEntryUrl)) {
      event.preventDefault();
      console.warn('[SECURITY] Blocked unexpected renderer navigation.');
    }
  });

  // ShellySVN uses main-process native APIs for notifications, filesystem
  // access, and external URLs. Renderer documents do not need Chromium grants.
  webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  webContents.session.setPermissionCheckHandler(() => false);
}
