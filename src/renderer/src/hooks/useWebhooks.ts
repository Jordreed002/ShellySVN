import { useState, useCallback, useEffect } from 'react'

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  id: string
  name: string
  url: string
  secret?: string
  events: WebhookEvent[]
  enabled: boolean
  repositoryPath?: string
  createdAt: number
  lastTriggered?: number
  lastStatus?: 'success' | 'failed' | 'pending'
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
  | 'merge'

/**
 * Webhook payload
 */
export interface WebhookPayload {
  event: WebhookEvent
  timestamp: number
  repository: {
    path: string
    url?: string
    revision?: number
  }
  data: Record<string, unknown>
  signature?: string
}

/**
 * Webhook delivery log
 */
export interface WebhookDelivery {
  id: string
  webhookId: string
  event: WebhookEvent
  timestamp: number
  status: 'success' | 'failed' | 'pending'
  statusCode?: number
  responseTime?: number
  error?: string
  payload: WebhookPayload
}

const STORAGE_KEY = 'shellysvn-webhooks'
const DELIVERIES_KEY = 'shellysvn-webhook-deliveries'

/**
 * Hook for managing commit notification webhooks
 */
export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  /**
   * Load webhooks from storage
   */
  const loadWebhooks = useCallback(async () => {
    setIsLoading(true)
    try {
      const [storedWebhooks, storedDeliveries] = await Promise.all([
        window.api.store.get<WebhookConfig[]>(STORAGE_KEY),
        window.api.store.get<WebhookDelivery[]>(DELIVERIES_KEY)
      ])
      
      if (storedWebhooks) setWebhooks(storedWebhooks)
      if (storedDeliveries) setDeliveries(storedDeliveries)
    } catch (error) {
      console.error('Failed to load webhooks:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save webhooks to storage
   */
  const saveWebhooks = useCallback(async (newWebhooks: WebhookConfig[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newWebhooks)
    } catch (error) {
      console.error('Failed to save webhooks:', error)
    }
  }, [])
  
  /**
   * Save deliveries to storage
   */
  const saveDeliveries = useCallback(async (newDeliveries: WebhookDelivery[]) => {
    try {
      // Keep only last 100 deliveries
      const trimmed = newDeliveries.slice(-100)
      await window.api.store.set(DELIVERIES_KEY, trimmed)
    } catch (error) {
      console.error('Failed to save deliveries:', error)
    }
  }, [])
  
  /**
   * Add a new webhook
   */
  const addWebhook = useCallback(async (
    name: string,
    url: string,
    events: WebhookEvent[],
    options: {
      secret?: string
      repositoryPath?: string
    } = {}
  ): Promise<WebhookConfig> => {
    const webhook: WebhookConfig = {
      id: `webhook-${Date.now()}`,
      name,
      url,
      secret: options.secret,
      events,
      enabled: true,
      repositoryPath: options.repositoryPath,
      createdAt: Date.now()
    }
    
    const newWebhooks = [...webhooks, webhook]
    setWebhooks(newWebhooks)
    await saveWebhooks(newWebhooks)
    
    return webhook
  }, [webhooks, saveWebhooks])
  
  /**
   * Update a webhook
   */
  const updateWebhook = useCallback(async (
    id: string, 
    updates: Partial<WebhookConfig>
  ): Promise<void> => {
    const newWebhooks = webhooks.map(w => 
      w.id === id ? { ...w, ...updates } : w
    )
    setWebhooks(newWebhooks)
    await saveWebhooks(newWebhooks)
  }, [webhooks, saveWebhooks])
  
  /**
   * Delete a webhook
   */
  const deleteWebhook = useCallback(async (id: string): Promise<void> => {
    const newWebhooks = webhooks.filter(w => w.id !== id)
    setWebhooks(newWebhooks)
    await saveWebhooks(newWebhooks)
    
    // Also remove related deliveries
    const newDeliveries = deliveries.filter(d => d.webhookId !== id)
    setDeliveries(newDeliveries)
    await saveDeliveries(newDeliveries)
  }, [webhooks, deliveries, saveWebhooks, saveDeliveries])
  
  /**
   * Toggle webhook enabled state
   */
  const toggleWebhook = useCallback(async (id: string): Promise<void> => {
    const webhook = webhooks.find(w => w.id === id)
    if (webhook) {
      await updateWebhook(id, { enabled: !webhook.enabled })
    }
  }, [webhooks, updateWebhook])
  
  /**
   * Test a webhook
   */
  const testWebhook = useCallback(async (id: string): Promise<boolean> => {
    const webhook = webhooks.find(w => w.id === id)
    if (!webhook) return false
    
    const payload: WebhookPayload = {
      event: 'commit',
      timestamp: Date.now(),
      repository: {
        path: webhook.repositoryPath || '/test',
        url: 'svn://test/repo',
        revision: 1
      },
      data: {
        test: true,
        message: 'This is a test webhook delivery'
      }
    }
    
    return triggerWebhook(webhook, payload)
  }, [webhooks])
  
  /**
   * Trigger a webhook
   */
  const triggerWebhook = useCallback(async (
    webhook: WebhookConfig, 
    payload: WebhookPayload
  ): Promise<boolean> => {
    if (!webhook.enabled) return false
    
    const delivery: WebhookDelivery = {
      id: `delivery-${Date.now()}`,
      webhookId: webhook.id,
      event: payload.event,
      timestamp: Date.now(),
      status: 'pending',
      payload
    }
    
    // Add to deliveries
    const newDeliveries = [...deliveries, delivery]
    setDeliveries(newDeliveries)
    
    try {
      const startTime = Date.now()
      
      // Generate signature if secret is set
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-ShellySVN-Event': payload.event
      }
      
      if (webhook.secret) {
        // Simple HMAC signature (in production, use proper crypto)
        headers['X-ShellySVN-Signature'] = `sha256=${btoa(webhook.secret + JSON.stringify(payload))}`
      }
      
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })
      
      const responseTime = Date.now() - startTime
      
      // Update delivery status
      const updatedDelivery: WebhookDelivery = {
        ...delivery,
        status: response.ok ? 'success' : 'failed',
        statusCode: response.status,
        responseTime
      }
      
      const updatedDeliveries = newDeliveries.map(d => 
        d.id === delivery.id ? updatedDelivery : d
      )
      setDeliveries(updatedDeliveries)
      await saveDeliveries(updatedDeliveries)
      
      // Update webhook last triggered
      await updateWebhook(webhook.id, {
        lastTriggered: Date.now(),
        lastStatus: response.ok ? 'success' : 'failed'
      })
      
      return response.ok
    } catch (error) {
      // Update delivery as failed
      const updatedDelivery: WebhookDelivery = {
        ...delivery,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
      
      const updatedDeliveries = newDeliveries.map(d => 
        d.id === delivery.id ? updatedDelivery : d
      )
      setDeliveries(updatedDeliveries)
      await saveDeliveries(updatedDeliveries)
      
      await updateWebhook(webhook.id, {
        lastTriggered: Date.now(),
        lastStatus: 'failed'
      })
      
      return false
    }
  }, [deliveries, saveDeliveries, updateWebhook])
  
  /**
   * Trigger webhooks for an event
   */
  const triggerEvent = useCallback(async (
    event: WebhookEvent,
    repository: WebhookPayload['repository'],
    data: Record<string, unknown>
  ): Promise<void> => {
    const matchingWebhooks = webhooks.filter(w => 
      w.enabled && 
      w.events.includes(event) &&
      (!w.repositoryPath || w.repositoryPath === repository.path)
    )
    
    for (const webhook of matchingWebhooks) {
      const payload: WebhookPayload = {
        event,
        timestamp: Date.now(),
        repository,
        data
      }
      
      await triggerWebhook(webhook, payload)
    }
  }, [webhooks, triggerWebhook])
  
  /**
   * Get deliveries for a webhook
   */
  const getDeliveriesForWebhook = useCallback((webhookId: string): WebhookDelivery[] => {
    return deliveries.filter(d => d.webhookId === webhookId)
  }, [deliveries])
  
  /**
   * Clear all deliveries
   */
  const clearDeliveries = useCallback(async (): Promise<void> => {
    setDeliveries([])
    await window.api.store.delete(DELIVERIES_KEY)
  }, [])
  
  // Load on mount
  useEffect(() => {
    loadWebhooks()
  }, [loadWebhooks])
  
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
    clearDeliveries
  }
}

export default useWebhooks
