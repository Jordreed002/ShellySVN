import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockIpcMainHandle = vi.hoisted(() => vi.fn());
const mockDnsLookup = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

vi.mock('dns/promises', () => ({
  default: {
    lookup: mockDnsLookup,
  },
  lookup: mockDnsLookup,
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
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      })
    );

    registerWebhookHandlers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the delivery handler', () => {
    expect(handlers.has('webhook:deliver')).toBe(true);
  });

  it('rejects non-https webhook URLs before fetching', async () => {
    const handler = handlers.get('webhook:deliver');

    const result = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-1',
      url: 'http://example.com/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
    });

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook URL must use https.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects localhost and private network webhook targets before fetching', async () => {
    const handler = handlers.get('webhook:deliver');

    const localhost = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-1',
      url: 'https://localhost/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
    });

    const privateIpv4 = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-2',
      url: 'https://192.168.1.10/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
    });

    const ipv6Loopback = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-3',
      url: 'https://[::1]/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
    });

    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    const privateDns = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-4',
      url: 'https://internal.example.test/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
    });

    for (const result of [localhost, privateIpv4, ipv6Loopback, privateDns]) {
      expect(result).toMatchObject({
        success: false,
        error: 'Webhook URL must not target local or private network addresses.',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads before fetching', async () => {
    const handler = handlers.get('webhook:deliver');

    const result = await handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-1',
      url: 'https://example.com/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { data: 'x'.repeat(256 * 1024) },
    });

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook payload exceeds 256 KiB.',
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

  it('reports timeouts without losing configured timeout behavior', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce((_, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }) as Promise<Response>
    );
    const handler = handlers.get('webhook:deliver');

    const resultPromise = handler!({}, {
      webhookId: 'webhook-1',
      deliveryId: 'delivery-1',
      url: 'https://example.com/hook',
      event: 'commit',
      timestamp: 1704067200000,
      payload: { event: 'commit' },
      timeout: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      error: 'Request timed out after 1 seconds',
    });
    vi.useRealTimers();
  });
});
