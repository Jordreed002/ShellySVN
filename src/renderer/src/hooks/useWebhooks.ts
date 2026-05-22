import { useState, useCallback, useEffect } from 'react';

/**
 * Default timeout for webhook requests (10 seconds)
 */
const DEFAULT_WEBHOOK_TIMEOUT = 10000;

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  secret?: string;
  events: WebhookEvent[];
  enabled: boolean;
  repositoryPath?: string;
  createdAt: number;
  lastTriggered?: number;
  lastStatus?: 'success' | 'failed' | 'pending';
  timeout?: number; // Timeout in milliseconds (default: 10000)
}

/**
 * Webhook event types
 */
export type WebhookEvent =
  | 'commit'
  | 'update'
  | 'conflict'
  | 'lock'
  | 'unlock'
  | 'branch'
  | 'tag'
  | 'merge';

/**
 * Webhook payload
 */
export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: number;
  repository: {
    path: string;
    url?: string;
    revision?: number;
  };
  data: Record<string, unknown>;
  signature?: string;
}

/**
 * Webhook delivery log
 */
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  timestamp: number;
  status: 'success' | 'failed' | 'pending';
  statusCode?: number;
  responseTime?: number;
  error?: string;
  payload: WebhookPayload;
}

const STORAGE_KEY = 'shellysvn-webhooks';
const DELIVERIES_KEY = 'shellysvn-webhook-deliveries';

function getWebhookSecretRealm(id: string): string {
  return `webhook:${id}`;
}

function stripWebhookSecret(webhook: WebhookConfig): WebhookConfig {
  const { secret: _secret, ...safeWebhook } = webhook;
  return safeWebhook;
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Hook for managing commit notification webhooks
 */
export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Load webhooks from storage
   */
  const loadWebhooks = useCallback(async () => {
    setIsLoading(true);
    try {
      const [storedWebhooks, storedDeliveries] = await Promise.all([
        window.api.store.get<WebhookConfig[]>(STORAGE_KEY),
        window.api.store.get<WebhookDelivery[]>(DELIVERIES_KEY),
      ]);

      if (storedWebhooks) {
        const migratedWebhooks = await Promise.all(
          storedWebhooks.map(async (webhook) => {
            if (webhook.secret) {
              await window.api.auth.set(getWebhookSecretRealm(webhook.id), 'webhook', webhook.secret);
            }
            return stripWebhookSecret(webhook);
          })
        );

        setWebhooks(migratedWebhooks);
        if (storedWebhooks.some((webhook) => webhook.secret)) {
          await saveWebhooks(migratedWebhooks);
        }
      }
      if (storedDeliveries) setDeliveries(storedDeliveries);
    } catch (error) {
      console.error('Failed to load webhooks:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Save webhooks to storage
   */
  const saveWebhooks = useCallback(async (newWebhooks: WebhookConfig[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newWebhooks);
    } catch (error) {
      console.error('Failed to save webhooks:', error);
    }
  }, []);

  /**
   * Save deliveries to storage
   */
  const saveDeliveries = useCallback(async (newDeliveries: WebhookDelivery[]) => {
    try {
      // Keep only last 100 deliveries
      const trimmed = newDeliveries.slice(-100);
      await window.api.store.set(DELIVERIES_KEY, trimmed);
    } catch (error) {
      console.error('Failed to save deliveries:', error);
    }
  }, []);

  /**
   * Add a new webhook
   */
  const addWebhook = useCallback(
    async (
      name: string,
      url: string,
      events: WebhookEvent[],
      options: {
        secret?: string;
        repositoryPath?: string;
      } = {}
    ): Promise<WebhookConfig> => {
      const webhook: WebhookConfig = {
        id: `webhook-${Date.now()}`,
        name,
        url,
        events,
        enabled: true,
        repositoryPath: options.repositoryPath,
        createdAt: Date.now(),
      };

      if (!isValidWebhookUrl(url)) {
        throw new Error('Webhook URL must use https.');
      }

      if (options.secret) {
        await window.api.auth.set(getWebhookSecretRealm(webhook.id), 'webhook', options.secret);
      }

      const newWebhooks = [...webhooks, stripWebhookSecret(webhook)];
      setWebhooks(newWebhooks);
      await saveWebhooks(newWebhooks);

      return stripWebhookSecret(webhook);
    },
    [webhooks, saveWebhooks]
  );

  /**
   * Update a webhook
   */
  const updateWebhook = useCallback(
    async (id: string, updates: Partial<WebhookConfig>): Promise<void> => {
      if (updates.url && !isValidWebhookUrl(updates.url)) {
        throw new Error('Webhook URL must use https.');
      }

      if (updates.secret !== undefined) {
        if (updates.secret) {
          await window.api.auth.set(getWebhookSecretRealm(id), 'webhook', updates.secret);
        } else {
          await window.api.auth.delete(getWebhookSecretRealm(id));
        }
      }

      const { secret: _secret, ...safeUpdates } = updates;
      const newWebhooks = webhooks.map((w) =>
        w.id === id ? stripWebhookSecret({ ...w, ...safeUpdates }) : w
      );
      setWebhooks(newWebhooks);
      await saveWebhooks(newWebhooks);
    },
    [webhooks, saveWebhooks]
  );

  /**
   * Delete a webhook
   */
  const deleteWebhook = useCallback(
    async (id: string): Promise<void> => {
      const newWebhooks = webhooks.filter((w) => w.id !== id);
      setWebhooks(newWebhooks);
      await saveWebhooks(newWebhooks);
      await window.api.auth.delete(getWebhookSecretRealm(id));

      // Also remove related deliveries
      const newDeliveries = deliveries.filter((d) => d.webhookId !== id);
      setDeliveries(newDeliveries);
      await saveDeliveries(newDeliveries);
    },
    [webhooks, deliveries, saveWebhooks, saveDeliveries]
  );

  /**
   * Toggle webhook enabled state
   */
  const toggleWebhook = useCallback(
    async (id: string): Promise<void> => {
      const webhook = webhooks.find((w) => w.id === id);
      if (webhook) {
        await updateWebhook(id, { enabled: !webhook.enabled });
      }
    },
    [webhooks, updateWebhook]
  );

  /**
   * Test a webhook
   */
  const testWebhook = useCallback(
    async (id: string): Promise<boolean> => {
      const webhook = webhooks.find((w) => w.id === id);
      if (!webhook) return false;

      const payload: WebhookPayload = {
        event: 'commit',
        timestamp: Date.now(),
        repository: {
          path: webhook.repositoryPath || '/test',
          url: 'svn://test/repo',
          revision: 1,
        },
        data: {
          test: true,
          message: 'This is a test webhook delivery',
        },
      };

      return triggerWebhook(webhook, payload);
    },
    [webhooks]
  );

  /**
   * Trigger a webhook
   */
  const triggerWebhook = useCallback(
    async (webhook: WebhookConfig, payload: WebhookPayload): Promise<boolean> => {
      if (!webhook.enabled) return false;

      const delivery: WebhookDelivery = {
        id: `delivery-${Date.now()}`,
        webhookId: webhook.id,
        event: payload.event,
        timestamp: Date.now(),
        status: 'pending',
        payload,
      };

      // Add to deliveries
      const newDeliveries = [...deliveries, delivery];
      setDeliveries(newDeliveries);

      try {
        if (!isValidWebhookUrl(webhook.url)) {
          throw new Error('Webhook URL must use https.');
        }

        const result = await window.api.webhook.deliver({
          webhookId: webhook.id,
          deliveryId: delivery.id,
          url: webhook.url,
          event: payload.event,
          timestamp: payload.timestamp,
          payload,
          timeout: webhook.timeout || DEFAULT_WEBHOOK_TIMEOUT,
        });

        // Update delivery status
        const updatedDelivery: WebhookDelivery = {
          ...delivery,
          status: result.success ? 'success' : 'failed',
          statusCode: result.statusCode,
          responseTime: result.responseTime,
          error: result.error,
        };

        const updatedDeliveries = newDeliveries.map((d) =>
          d.id === delivery.id ? updatedDelivery : d
        );
        setDeliveries(updatedDeliveries);
        await saveDeliveries(updatedDeliveries);

        // Update webhook last triggered
        await updateWebhook(webhook.id, {
          lastTriggered: Date.now(),
          lastStatus: result.success ? 'success' : 'failed',
        });

        return result.success;
      } catch (error) {
        // Update delivery as failed
        const updatedDelivery: WebhookDelivery = {
          ...delivery,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };

        const updatedDeliveries = newDeliveries.map((d) =>
          d.id === delivery.id ? updatedDelivery : d
        );
        setDeliveries(updatedDeliveries);
        await saveDeliveries(updatedDeliveries);

        await updateWebhook(webhook.id, {
          lastTriggered: Date.now(),
          lastStatus: 'failed',
        });

        return false;
      }
    },
    [deliveries, saveDeliveries, updateWebhook]
  );

  /**
   * Trigger webhooks for an event (parallel delivery)
   */
  const triggerEvent = useCallback(
    async (
      event: WebhookEvent,
      repository: WebhookPayload['repository'],
      data: Record<string, unknown>
    ): Promise<void> => {
      const matchingWebhooks = webhooks.filter(
        (w) =>
          w.enabled &&
          w.events.includes(event) &&
          (!w.repositoryPath || w.repositoryPath === repository.path)
      );

      if (matchingWebhooks.length === 0) return;

      // Create all payloads
      const payloads = matchingWebhooks.map((webhook) => ({
        webhook,
        payload: {
          event,
          timestamp: Date.now(),
          repository,
          data,
        } as WebhookPayload,
      }));

      // Deliver all webhooks in parallel for better performance
      const results = await Promise.allSettled(
        payloads.map(({ webhook, payload }) => triggerWebhook(webhook, payload))
      );

      // Log any failures for debugging
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(
            `Webhook delivery failed for ${matchingWebhooks[index].name}:`,
            result.reason
          );
        }
      });
    },
    [webhooks, triggerWebhook]
  );

  /**
   * Get deliveries for a webhook
   */
  const getDeliveriesForWebhook = useCallback(
    (webhookId: string): WebhookDelivery[] => {
      return deliveries.filter((d) => d.webhookId === webhookId);
    },
    [deliveries]
  );

  /**
   * Clear all deliveries
   */
  const clearDeliveries = useCallback(async (): Promise<void> => {
    setDeliveries([]);
    await window.api.store.delete(DELIVERIES_KEY);
  }, []);

  // Load on mount
  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  return {
    webhooks,
    deliveries,
    isLoading,
    addWebhook,
    updateWebhook,
    deleteWebhook,
    toggleWebhook,
    testWebhook,
    triggerEvent,
    getDeliveriesForWebhook,
    clearDeliveries,
  };
}

export default useWebhooks;
