import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockIpcMainHandle = vi.hoisted(() => vi.fn());
const mockDnsLookup = vi.hoisted(() => vi.fn());
const mockHttpsRequest = vi.hoisted(() => vi.fn());

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

vi.mock('https', () => ({
  default: { request: mockHttpsRequest },
  request: mockHttpsRequest,
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
  let responseStatus = 204;
  let requestTimeoutHandler: (() => void) | undefined;

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
    responseStatus = 204;
    requestTimeoutHandler = undefined;
    mockHttpsRequest.mockImplementation(
      (
        _url: URL,
        _options: unknown,
        onResponse: (response: { statusCode: number; resume: () => void }) => void
      ) => {
        let errorHandler: ((error: Error) => void) | undefined;
        return {
          setTimeout: vi.fn((_timeout: number, handler: () => void) => {
            requestTimeoutHandler = handler;
          }),
          on: vi.fn((event: string, handler: (error: Error) => void) => {
            if (event === 'error') errorHandler = handler;
          }),
          destroy: vi.fn((error: Error) => errorHandler?.(error)),
          end: vi.fn(() => {
            queueMicrotask(() => onResponse({ statusCode: responseStatus, resume: vi.fn() }));
          }),
        };
      }
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

    const result = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'http://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
      }
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook URL must use https.',
    });
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('rejects localhost and private network webhook targets before fetching', async () => {
    const handler = handlers.get('webhook:deliver');

    const localhost = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://localhost/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
      }
    );

    const privateIpv4 = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-2',
        url: 'https://192.168.1.10/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
      }
    );

    const ipv6Loopback = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-3',
        url: 'https://[::1]/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
      }
    );

    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    const privateDns = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-4',
        url: 'https://internal.example.test/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
      }
    );

    for (const result of [localhost, privateIpv4, ipv6Loopback, privateDns]) {
      expect(result).toMatchObject({
        success: false,
        error: 'Webhook URL must not target local or private network addresses.',
      });
    }
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads before fetching', async () => {
    const handler = handlers.get('webhook:deliver');

    const result = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { data: 'x'.repeat(256 * 1024) },
      }
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook payload exceeds 256 KiB.',
    });
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('adds a SHA-256 signature when a webhook secret exists', async () => {
    mockGet.mockReturnValue({ username: 'webhook', password: 'top-secret' });
    const handler = handlers.get('webhook:deliver');

    const result = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit', data: { revision: 42 } },
        timeout: 5000,
      }
    );

    expect(result).toMatchObject({ success: true, statusCode: 204 });
    expect(mockGet).toHaveBeenCalledWith('webhook:webhook-1');
    expect(mockHttpsRequest).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://example.com/hook' }),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-ShellySVN-Signature-256':
            'sha256=b19251019377ca6808a212c0d5e7186d7eab7173fe0a4f53ad67652f56ff3dc6',
          'X-ShellySVN-Delivery': 'delivery-1',
          'X-ShellySVN-Event': 'commit',
        }),
      }),
      expect.any(Function)
    );
  });

  it('returns failed status details for non-2xx responses', async () => {
    responseStatus = 500;
    const handler = handlers.get('webhook:deliver');

    const result = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
      }
    );

    expect(result).toMatchObject({
      success: false,
      statusCode: 500,
    });
  });

  it('reports timeouts without losing configured timeout behavior', async () => {
    mockHttpsRequest.mockImplementationOnce(() => {
      let errorHandler: ((error: Error) => void) | undefined;
      return {
        setTimeout: (_timeout: number, handler: () => void) => {
          requestTimeoutHandler = handler;
        },
        on: (event: string, handler: (error: Error) => void) => {
          if (event === 'error') errorHandler = handler;
        },
        destroy: (error: Error) => errorHandler?.(error),
        end: vi.fn(),
      };
    });
    const handler = handlers.get('webhook:deliver');

    const resultPromise = handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
        timeout: 1000,
      }
    );

    await vi.waitFor(() => expect(requestTimeoutHandler).toBeTypeOf('function'));
    requestTimeoutHandler!();

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      error: 'Request timed out after 1 seconds',
    });
  });

  it('rejects redirects without connecting to the redirect target', async () => {
    responseStatus = 302;
    const handler = handlers.get('webhook:deliver');

    const result = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: { event: 'commit' },
      }
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook redirects are not allowed.',
    });
    expect(mockDnsLookup).toHaveBeenCalledTimes(1);
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
  });

  it('pins the request to the public address that passed validation', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '2001:4860:4860::8888', family: 6 }]);
    const handler = handlers.get('webhook:deliver');

    await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: {},
      }
    );

    const options = mockHttpsRequest.mock.calls[0][1] as {
      lookup: (
        hostname: string,
        options: { all: boolean },
        callback: (...args: unknown[]) => void
      ) => void;
    };
    const callback = vi.fn();
    options.lookup('example.com', { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, '2001:4860:4860::8888', 6);
  });

  it('rejects mixed public/private DNS answers and IPv4-mapped private addresses', async () => {
    const handler = handlers.get('webhook:deliver');
    mockDnsLookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);

    const mixed = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-1',
        url: 'https://example.com/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: {},
      }
    );
    const mapped = await handler!(
      {},
      {
        webhookId: 'webhook-1',
        deliveryId: 'delivery-2',
        url: 'https://[::ffff:127.0.0.1]/hook',
        event: 'commit',
        timestamp: 1704067200000,
        payload: {},
      }
    );

    expect(mixed).toMatchObject({ success: false });
    expect(mapped).toMatchObject({ success: false });
  });
});
