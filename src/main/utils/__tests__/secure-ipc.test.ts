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
const { installSecureIpcBoundary } = await import('../secure-ipc');

/**
 * The secure IPC boundary is the process-level guard that (a) only lets the
 * authorized renderer invoke handlers and (b) scrubs secrets out of any error
 * that escapes a handler. Both properties are security-critical.
 */
describe('installSecureIpcBoundary', () => {
  // A mutable holder so tests can flip the authorized sender without
  // re-installing (install is idempotent / once-only).
  let authorizedSender: number | undefined = 7;
  installSecureIpcBoundary(() => authorizedSender);

  it('invokes the listener and returns its value for an authorized sender', async () => {
    const listener = vi.fn(async (_e: unknown, x: unknown) => `got:${x as string}`);
    ipcMain.handle('authorized', listener);

    const result = await handlers.get('authorized')!({ sender: { id: 7 } }, 'hello');

    expect(result).toBe('got:hello');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects IPC from a sender whose id is not authorized', async () => {
    ipcMain.handle('wrong-sender', vi.fn());
    await expect(handlers.get('wrong-sender')!({ sender: { id: 999 } })).rejects.toThrow(
      'Unauthorized IPC sender'
    );
  });

  it('rejects IPC when no authorized sender id is configured', async () => {
    authorizedSender = undefined;
    try {
      ipcMain.handle('no-config', vi.fn());
      await expect(handlers.get('no-config')!({ sender: { id: 7 } })).rejects.toThrow(
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

    await expect(handlers.get('leaky')!({ sender: { id: 7 } })).rejects.toThrow(
      'auth failed password=[redacted] token=[redacted]'
    );
  });

  it('coerces non-Error throws into a generic message', async () => {
    const listener = vi.fn(() => {
      throw 'a plain string, not an Error';
    });
    ipcMain.handle('non-error', listener);

    await expect(handlers.get('non-error')!({ sender: { id: 7 } })).rejects.toThrow(
      'Request failed'
    );
  });

  it('is idempotent — a second install does not re-wrap or change behavior', async () => {
    // Re-install with a different getter; because install is once-only, the
    // existing boundary (authorizedSender === 7) must still govern.
    installSecureIpcBoundary(() => 12345);

    const listener = vi.fn(() => 'ok');
    ipcMain.handle('idempotent', listener);

    await expect(handlers.get('idempotent')!({ sender: { id: 7 } })).resolves.toBe('ok');
    await expect(handlers.get('idempotent')!({ sender: { id: 12345 } })).rejects.toThrow(
      'Unauthorized IPC sender'
    );
  });
});
