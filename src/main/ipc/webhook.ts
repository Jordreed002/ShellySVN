import { createHmac } from 'crypto';
import { lookup } from 'dns/promises';
import { ipcMain } from 'electron';
import { BlockList, isIP } from 'net';
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
  const ipVersion = isIP(address);
  if (ipVersion !== 4 && ipVersion !== 6) {
    return true;
  }

  return BLOCKED_WEBHOOK_ADDRESSES.check(address, ipVersion === 4 ? 'ipv4' : 'ipv6');
}

async function validateWebhookUrl(url: string): Promise<URL> {
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

  const hostname = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Webhook URL must not target local or private network addresses.');
  }

  if (isIP(hostname)) {
    if (isBlockedWebhookAddress(hostname)) {
      throw new Error('Webhook URL must not target local or private network addresses.');
    }
    return parsed;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Webhook hostname could not be resolved.');
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedWebhookAddress(address))) {
    throw new Error('Webhook URL must not target local or private network addresses.');
  }

  return parsed;
}

function buildSignature(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

async function deliverWebhook(
  request: WebhookDeliverRequest
): Promise<WebhookDeliverResult> {
  const startTime = Date.now();

  try {
    const url = await validateWebhookUrl(request.url);
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });

      return {
        success: response.ok,
        statusCode: response.status,
        responseTime: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeoutId);
    }
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
  ipcMain.handle('webhook:deliver', (_, request: WebhookDeliverRequest) =>
    deliverWebhook(request)
  );
}
