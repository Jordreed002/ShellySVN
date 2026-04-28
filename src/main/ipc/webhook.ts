import { createHmac } from 'crypto';
import { ipcMain } from 'electron';
import type { WebhookDeliverRequest, WebhookDeliverResult } from '@shared/types';
import { getAuthCache } from '../auth-cache';
import { redactForLog } from '../utils/redaction';

const DEFAULT_WEBHOOK_TIMEOUT = 10000;
const MAX_WEBHOOK_TIMEOUT = 60000;

function getWebhookSecretRealm(id: string): string {
  return `webhook:${id}`;
}

function normalizeTimeout(timeout?: number): number {
  if (!Number.isFinite(timeout) || timeout === undefined) {
    return DEFAULT_WEBHOOK_TIMEOUT;
  }

  return Math.min(Math.max(timeout, 1000), MAX_WEBHOOK_TIMEOUT);
}

function validateWebhookUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Webhook URL must use http or https.');
  }
  if (!parsed.hostname) {
    throw new Error('Webhook URL must include a hostname.');
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
    const url = validateWebhookUrl(request.url);
    const timeout = normalizeTimeout(request.timeout);
    const payload = JSON.stringify(request.payload);
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
