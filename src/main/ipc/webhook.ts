import { createHmac } from 'crypto';
import { lookup } from 'dns/promises';
import { ipcMain } from 'electron';
import { request as httpsRequest } from 'https';
import { BlockList, isIP, type LookupFunction } from 'net';
import type { WebhookDeliverRequest, WebhookDeliverResult } from '@shared/types';
import { getAuthCache } from '../auth-cache';
import { redactForLog } from '../utils/redaction';

const DEFAULT_WEBHOOK_TIMEOUT = 10000;
const MAX_WEBHOOK_TIMEOUT = 60000;
const MAX_WEBHOOK_PAYLOAD_BYTES = 256 * 1024;
const BLOCKED_WEBHOOK_ADDRESSES = new BlockList();

BLOCKED_WEBHOOK_ADDRESSES.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('100.64.0.0', 10, 'ipv4');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED_WEBHOOK_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_WEBHOOK_ADDRESSES.addAddress('::1', 'ipv6');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_WEBHOOK_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');

function getWebhookSecretRealm(id: string): string {
  return `webhook:${id}`;
}

function normalizeTimeout(timeout?: number): number {
  if (!Number.isFinite(timeout) || timeout === undefined) {
    return DEFAULT_WEBHOOK_TIMEOUT;
  }

  return Math.min(Math.max(timeout, 1000), MAX_WEBHOOK_TIMEOUT);
}

function isBlockedWebhookAddress(address: string): boolean {
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mappedIpv4) {
    return isBlockedWebhookAddress(mappedIpv4);
  }
  const ipVersion = isIP(address);
  if (ipVersion !== 4 && ipVersion !== 6) {
    return true;
  }

  return BLOCKED_WEBHOOK_ADDRESSES.check(address, ipVersion === 4 ? 'ipv4' : 'ipv6');
}

interface ValidatedWebhookTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

async function validateWebhookUrl(url: string): Promise<ValidatedWebhookTarget> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use https.');
  }
  if (!parsed.hostname) {
    throw new Error('Webhook URL must include a hostname.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not include credentials.');
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Webhook URL must not target local or private network addresses.');
  }

  if (isIP(hostname)) {
    if (isBlockedWebhookAddress(hostname)) {
      throw new Error('Webhook URL must not target local or private network addresses.');
    }
    return { url: parsed, address: hostname, family: isIP(hostname) as 4 | 6 };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Webhook hostname could not be resolved.');
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedWebhookAddress(address))) {
    throw new Error('Webhook URL must not target local or private network addresses.');
  }

  const selected = addresses.find(
    (entry): entry is { address: string; family: 4 | 6 } =>
      entry.family === 4 || entry.family === 6
  );
  if (!selected) {
    throw new Error('Webhook hostname could not be resolved.');
  }

  return { url: parsed, address: selected.address, family: selected.family };
}

function buildSignature(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function postWebhook(
  target: ValidatedWebhookTarget,
  headers: Record<string, string>,
  payload: string,
  timeout: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = ((_: string, options: unknown, callback: (...args: unknown[]) => void) => {
      if (typeof options === 'object' && options !== null && 'all' in options && options.all) {
        callback(null, [{ address: target.address, family: target.family }]);
      } else {
        callback(null, target.address, target.family);
      }
    }) as LookupFunction;

    const request = httpsRequest(
      target.url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
        },
        lookup: pinnedLookup,
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          reject(new Error('Webhook redirects are not allowed.'));
          return;
        }
        resolve(status);
      }
    );

    request.setTimeout(timeout, () => {
      request.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function deliverWebhook(request: WebhookDeliverRequest): Promise<WebhookDeliverResult> {
  const startTime = Date.now();

  try {
    const target = await validateWebhookUrl(request.url);
    const timeout = normalizeTimeout(request.timeout);
    const payload = JSON.stringify(request.payload);
    if (typeof payload !== 'string') {
      throw new Error('Webhook payload must be JSON serializable.');
    }
    if (Buffer.byteLength(payload, 'utf8') > MAX_WEBHOOK_PAYLOAD_BYTES) {
      throw new Error('Webhook payload exceeds 256 KiB.');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-ShellySVN-Event': request.event,
      'X-ShellySVN-Delivery': request.deliveryId,
      'X-ShellySVN-Timestamp': String(request.timestamp),
    };

    const storedSecret = getAuthCache().get(getWebhookSecretRealm(request.webhookId));
    if (storedSecret?.password) {
      headers['X-ShellySVN-Signature-256'] = buildSignature(storedSecret.password, payload);
    }

    const statusCode = await postWebhook(target, headers, payload, timeout);
    return {
      success: statusCode >= 200 && statusCode < 300,
      statusCode,
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `Request timed out after ${normalizeTimeout(request.timeout) / 1000} seconds`
        : String(redactForLog(error instanceof Error ? error.message : String(error)));

    console.warn('Webhook delivery failed:', redactForLog(message));
    return {
      success: false,
      responseTime: Date.now() - startTime,
      error: message,
    };
  }
}

export function registerWebhookHandlers(): void {
  ipcMain.handle('webhook:deliver', (_, request: WebhookDeliverRequest) => deliverWebhook(request));
  ipcMain.handle('webhook:setSecret', async (_, webhookId: string, secret: string) => {
    if (!/^webhook-[A-Za-z0-9_-]+$/.test(webhookId) || typeof secret !== 'string' || secret.length > 16_384) {
      throw new Error('Invalid webhook secret request');
    }
    const cache = getAuthCache();
    await cache.ready();
    cache.set(getWebhookSecretRealm(webhookId), 'webhook', secret);
  });
  ipcMain.handle('webhook:hasSecret', async (_, webhookId: string) => {
    if (!/^webhook-[A-Za-z0-9_-]+$/.test(webhookId)) return false;
    const cache = getAuthCache();
    await cache.ready();
    return cache.has(getWebhookSecretRealm(webhookId));
  });
  ipcMain.handle('webhook:deleteSecret', async (_, webhookId: string) => {
    if (!/^webhook-[A-Za-z0-9_-]+$/.test(webhookId)) throw new Error('Invalid webhook id');
    const cache = getAuthCache();
    await cache.ready();
    cache.delete(getWebhookSecretRealm(webhookId));
  });
}
