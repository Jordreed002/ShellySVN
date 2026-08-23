import { createHmac } from 'crypto';
import { ipcMain } from 'electron';
import { request as httpsRequest } from 'https';
import type { WebhookDeliverRequest, WebhookDeliverResult } from '@shared/types';
import { getAuthCache } from '../auth-cache';
import { redactForLog } from '../utils/redaction';
import {
  createPinnedLookup,
  validateOutboundUrl,
  type SafeOutboundTarget,
} from '../utils/ssrf-guard';

const DEFAULT_WEBHOOK_TIMEOUT = 10000;
const MAX_WEBHOOK_TIMEOUT = 60000;
const MAX_WEBHOOK_PAYLOAD_BYTES = 256 * 1024;
const WEBHOOK_ALLOWED_PORTS = [443, 8443];

function getWebhookSecretRealm(id: string): string {
  return `webhook:${id}`;
}

function normalizeTimeout(timeout?: number): number {
  if (!Number.isFinite(timeout) || timeout === undefined) {
    return DEFAULT_WEBHOOK_TIMEOUT;
  }

  return Math.min(Math.max(timeout, 1000), MAX_WEBHOOK_TIMEOUT);
}

/*
 * SSRF validation is delegated to the shared guard (see
 * ../utils/ssrf-guard for the full threat model). Webhooks additionally
 * restrict the scheme to https and the port to 443/8443.
 */
function validateWebhookUrl(url: string): Promise<SafeOutboundTarget> {
  return validateOutboundUrl(url, {
    label: 'Webhook URL',
    allowedSchemes: ['https:'],
    allowedPorts: WEBHOOK_ALLOWED_PORTS,
  });
}

function buildSignature(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

/*
 * DNS-rebinding approach: the hostname is resolved inside deliverWebhook, at
 * request time, and every answer is validated then. The request is pinned to
 * the validated address via a custom `lookup`, so the connection path never
 * consults the resolver again — a rebinding between check and connect is
 * impossible. Redirects are refused outright, which removes the only other
 * path where a different host could be contacted without re-validation.
 */
function postWebhook(
  target: SafeOutboundTarget,
  headers: Record<string, string>,
  payload: string,
  timeout: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      target.url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
        },
        lookup: createPinnedLookup(target.address, target.family),
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
    if (
      !/^webhook-[A-Za-z0-9_-]+$/.test(webhookId) ||
      typeof secret !== 'string' ||
      secret.length > 16_384
    ) {
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
