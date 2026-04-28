import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIpcMainHandle = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

const mockGet = vi.hoisted(() => vi.fn());

vi.mock('../../auth-cache', () => ({
  getAuthCache: () => ({
    get: mockGet,
  }),
}));

import { registerWebhookHandlers } from '../webhook';

describe('Webhook IPC Handlers', () => {
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockIpcMainHandle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    );
    mockGet.mockReturnValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      })
    );

    registerWebhookHandlers();
  });

  it('registers the delivery handler', () => {
    expect(handlers.has('webhook:deliver')).toBe(true);
  });

  it('rejects non-http webhook URLs before fetching', async () => {
    const handler = handlers.get('webhook:deliver');

    const result = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-1',
      url: 'file:///tmp/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
    });

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook URL must use http or https.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('adds a SHA-256 signature when a webhook secret exists', async () => {
    mockGet.mockReturnValue({ username: 'webhook', password: 'top-secret' });
    const handler = handlers.get('webhook:deliver');

    const result = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-1',
      url: 'https://example.com/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit', data: { revision: 42 } },
      timeout: 5000,
    });

    expect(result).toMatchObject({ success: true, statusCode: 204 });
    expect(mockGet).toHaveBeenCalledWith('webhook:webhook-1');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-ShellySVN-Signature-256':
            'sha256=b19251019377ca6808a212c0d5e7186d7eab7173fe0a4f53ad67652f56ff3dc6',
          'X-ShellySVN-Delivery': 'delivery-1',
          'X-ShellySVN-Event': 'commit',
        }),
      })
    );
  });

  it('returns failed status details for non-2xx responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    const handler = handlers.get('webhook:deliver');

    const result = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-1',
      url: 'https://example.com/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 500,
    });
  });
});
