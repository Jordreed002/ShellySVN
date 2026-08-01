import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J14 — App lifecycle. `notification:show` is an IPC entry point fed by the
 * renderer, so it must validate its input before touching the OS notification
 * service — a bad payload should never reach the user as a malformed toast.
 */
const { capture, notificationService } = vi.hoisted(() => ({
  capture: { handler: null as null | ((_e: unknown, options: unknown) => Promise<unknown>) },
  notificationService: { show: vi.fn() },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (_channel: string, fn: (e: unknown, options: unknown) => Promise<unknown>) => {
      capture.handler = fn;
    },
  },
}));

vi.mock('../../services/NotificationService', () => ({ notificationService }));

import { registerNotificationHandlers } from '../notification';

const VALID = { title: 'Done', body: 'Commit succeeded', type: 'success' as const };

beforeEach(() => {
  capture.handler = null;
  notificationService.show.mockReset();
  notificationService.show.mockResolvedValue({ ok: true });
  registerNotificationHandlers();
});

function show(options: unknown) {
  return capture.handler!({}, options);
}

describe('notification:show handler', () => {
  it('delegates a valid notification to the notification service', async () => {
    await expect(show(VALID)).resolves.toEqual({ ok: true });
    expect(notificationService.show).toHaveBeenCalledWith(VALID);
  });

  it.each(['success', 'warning', 'error', 'info'] as const)(
    'accepts the %s type and rejects an unknown one',
    async (validType) => {
      await expect(show({ ...VALID, type: 'invalid' })).rejects.toThrow('Invalid notification');
      await expect(show({ ...VALID, type: validType })).resolves.toEqual({ ok: true });
    }
  );

  it('rejects a missing or non-string title', async () => {
    await expect(show({ body: 'b', type: 'info' })).rejects.toThrow('Invalid notification');
    await expect(show({ ...VALID, title: 42 })).rejects.toThrow('Invalid notification');
  });

  it('rejects a missing or non-string body', async () => {
    await expect(show({ title: 't', type: 'info' })).rejects.toThrow('Invalid notification');
  });

  it('rejects oversized payloads', async () => {
    await expect(show({ ...VALID, title: 'x'.repeat(201) })).rejects.toThrow('Invalid notification');
    await expect(show({ ...VALID, body: 'x'.repeat(2001) })).rejects.toThrow('Invalid notification');
  });

  it('accepts payloads at exactly the length limits', async () => {
    await expect(show({ ...VALID, title: 'x'.repeat(200) })).resolves.toEqual({ ok: true });
    await expect(show({ ...VALID, body: 'x'.repeat(2000) })).resolves.toEqual({ ok: true });
  });
});
