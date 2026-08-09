import { describe, expect, it, vi } from 'vitest';

// Capture every handler registered through (the wrapped) ipcMain.handle so we
// can invoke the boundary's wrapper directly. vi.hoisted keeps this map alive
// before vi.mock is evaluated.
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
  },
}));

const { ipcMain } = await import('electron');
const { installRendererSecurityGuards, installSecureIpcBoundary } = await import('../secure-ipc');

function ipcEvent(senderId: number, url = 'file:///app/renderer/index.html') {
  const mainFrame = { url };
  return { sender: { id: senderId, mainFrame }, senderFrame: mainFrame };
}

/**
 * The secure IPC boundary is the process-level guard that (a) only lets the
 * authorized renderer invoke handlers and (b) scrubs secrets out of any error
 * that escapes a handler. Both properties are security-critical.
 */
describe('installSecureIpcBoundary', () => {
  // A mutable holder so tests can flip the authorized sender without
  // re-installing (install is idempotent / once-only).
  let authorizedSender: number | undefined = 7;
  let trustedEntry = 'file:///app/renderer/index.html';
  installSecureIpcBoundary(
    () => authorizedSender,
    () => trustedEntry
  );

  it('invokes the listener and returns its value for an authorized sender', async () => {
    const listener = vi.fn(async (_e: unknown, x: unknown) => `got:${x as string}`);
    ipcMain.handle('authorized', listener);

    const result = await handlers.get('authorized')!(ipcEvent(7), 'hello');

    expect(result).toBe('got:hello');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects IPC from a sender whose id is not authorized', async () => {
    ipcMain.handle('wrong-sender', vi.fn());
    await expect(handlers.get('wrong-sender')!(ipcEvent(999))).rejects.toThrow(
      'Unauthorized IPC sender'
    );
  });

  it('rejects IPC when no authorized sender id is configured', async () => {
    authorizedSender = undefined;
    try {
      ipcMain.handle('no-config', vi.fn());
      await expect(handlers.get('no-config')!(ipcEvent(7))).rejects.toThrow(
        'Unauthorized IPC sender'
      );
    } finally {
      authorizedSender = 7;
    }
  });

  it('scrubs secrets out of errors thrown by a listener', async () => {
    const listener = vi.fn(() => {
      throw new Error('auth failed password=hunter2 token=abc');
    });
    ipcMain.handle('leaky', listener);

    await expect(handlers.get('leaky')!(ipcEvent(7))).rejects.toThrow(
      'auth failed password=[redacted] token=[redacted]'
    );
  });

  it('coerces non-Error throws into a generic message', async () => {
    const listener = vi.fn(() => {
      throw 'a plain string, not an Error';
    });
    ipcMain.handle('non-error', listener);

    await expect(handlers.get('non-error')!(ipcEvent(7))).rejects.toThrow('Request failed');
  });

  it('is idempotent — a second install does not re-wrap or change behavior', async () => {
    // Re-install with a different getter; because install is once-only, the
    // existing boundary (authorizedSender === 7) must still govern.
    installSecureIpcBoundary(
      () => 12345,
      () => 'https://untrusted.example'
    );

    const listener = vi.fn(() => 'ok');
    ipcMain.handle('idempotent', listener);

    await expect(handlers.get('idempotent')!(ipcEvent(7))).resolves.toBe('ok');
    await expect(handlers.get('idempotent')!(ipcEvent(12345))).rejects.toThrow(
      'Unauthorized IPC sender'
    );
  });

  it('rejects an authorized webContents after its main frame navigates away', async () => {
    ipcMain.handle('remote-document', vi.fn());

    await expect(
      handlers.get('remote-document')!(ipcEvent(7, 'https://attacker.example/'))
    ).rejects.toThrow('Unauthorized IPC sender');
  });

  it('rejects IPC sent from a subframe', async () => {
    ipcMain.handle('subframe', vi.fn());
    const mainFrame = { url: trustedEntry };
    const subframe = { url: trustedEntry };

    await expect(
      handlers.get('subframe')!({ sender: { id: 7, mainFrame }, senderFrame: subframe })
    ).rejects.toThrow('Unauthorized IPC sender');
  });
});

describe('installRendererSecurityGuards', () => {
  it('blocks untrusted navigation and denies Chromium permissions by default', () => {
    let navigationHandler:
      | ((event: { preventDefault: () => void }, targetUrl: string) => void)
      | undefined;
    let permissionRequestHandler:
      | ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void)
      | undefined;
    let permissionCheckHandler: (() => boolean) | undefined;
    const webContents = {
      on: vi.fn((event: string, handler: typeof navigationHandler) => {
        if (event === 'will-navigate') navigationHandler = handler;
      }),
      session: {
        setPermissionRequestHandler: vi.fn((handler: typeof permissionRequestHandler) => {
          permissionRequestHandler = handler;
        }),
        setPermissionCheckHandler: vi.fn((handler: typeof permissionCheckHandler) => {
          permissionCheckHandler = handler;
        }),
      },
    };

    installRendererSecurityGuards(
      webContents as Parameters<typeof installRendererSecurityGuards>[0],
      'file:///app/renderer/index.html'
    );

    const preventDefault = vi.fn();
    navigationHandler?.({ preventDefault }, 'https://attacker.example/');
    expect(preventDefault).toHaveBeenCalledOnce();

    const permissionResult = vi.fn();
    permissionRequestHandler?.(null, 'media', permissionResult);
    expect(permissionResult).toHaveBeenCalledWith(false);
    expect(permissionCheckHandler?.()).toBe(false);
  });

  it('does not cancel navigation within the trusted development origin', () => {
    let navigationHandler:
      | ((event: { preventDefault: () => void }, targetUrl: string) => void)
      | undefined;
    const webContents = {
      on: vi.fn((event: string, handler: typeof navigationHandler) => {
        if (event === 'will-navigate') navigationHandler = handler;
      }),
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    };
    installRendererSecurityGuards(
      webContents as Parameters<typeof installRendererSecurityGuards>[0],
      'http://localhost:5173/'
    );

    const preventDefault = vi.fn();
    navigationHandler?.({ preventDefault }, 'http://localhost:5173/settings');
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
