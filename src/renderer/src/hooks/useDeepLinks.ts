import { useEffect, useCallback, useState } from 'react'

/**
 * Deep link structure
 */
export interface DeepLink {
  action: string
  params: Record<string, string>
  path?: string
  url?: string
}

/**
 * Supported deep link actions
 */
export type DeepLinkAction =
  | 'checkout'
  | 'export'
  | 'open'
  | 'log'
  | 'diff'
  | 'commit'
  | 'update'
  | 'blame'
  | 'info'

/**
 * Hook for handling deep links in the renderer process
 * 
 * Provides access to incoming deep links and allows the app to respond
 * to external URL triggers like shellysvn://checkout?url=...
 */
export function useDeepLinks() {
  const [lastLink, setLastLink] = useState<DeepLink | null>(null)
  const [pendingAction, setPendingAction] = useState<DeepLink | null>(null)
  
  /**
   * Register a handler for deep link actions
   */
  const onAction = useCallback((action: DeepLinkAction, handler: (link: DeepLink) => void) => {
    // Listen for IPC messages from main process
    const unsubscribe = window.api.deepLink.onAction((link) => {
      if (link.action === action) {
        setLastLink(link)
        handler(link)
      }
    })
    
    return unsubscribe
  }, [])
  
  /**
   * Process a pending action and clear it
   */
  const consumePendingAction = useCallback(() => {
    const action = pendingAction
    setPendingAction(null)
    return action
  }, [pendingAction])
  
  /**
   * Clear the pending action without processing
   */
  const clearPendingAction = useCallback(() => {
    setPendingAction(null)
  }, [])
  
  /**
   * Open a shellysvn:// URL
   */
  const openDeepLink = useCallback(async (url: string): Promise<boolean> => {
    if (!url.startsWith('shellysvn://')) {
      console.warn('Invalid deep link URL:', url)
      return false
    }
    
    // Use the main process to handle the URL
    try {
      const result = await window.api.app.openExternal(url)
      return result !== undefined
    } catch {
      return false
    }
  }, [])
  
  return {
    lastLink,
    pendingAction,
    onAction,
    consumePendingAction,
    clearPendingAction,
    openDeepLink
  }
}

/**
 * Hook for generating shellysvn:// deep link URLs
 */
export function useDeepLinkGenerator() {
  const generateCheckoutUrl = useCallback((svnUrl: string, localPath?: string) => {
    const params = new URLSearchParams({ url: svnUrl })
    if (localPath) params.set('path', localPath)
    return `shellysvn://checkout?${params.toString()}`
  }, [])
  
  const generateOpenUrl = useCallback((path: string) => {
    return `shellysvn://open?path=${encodeURIComponent(path)}`
  }, [])
  
  const generateLogUrl = useCallback((path: string, revision?: string) => {
    const params = new URLSearchParams({ path })
    if (revision) params.set('revision', revision)
    return `shellysvn://log?${params.toString()}`
  }, [])
  
  const generateDiffUrl = useCallback((path: string, revision?: string) => {
    const params = new URLSearchParams({ path })
    if (revision) params.set('revision', revision)
    return `shellysvn://diff?${params.toString()}`
  }, [])
  
  const generateCommitUrl = useCallback((path: string) => {
    return `shellysvn://commit?path=${encodeURIComponent(path)}`
  }, [])
  
  const generateUpdateUrl = useCallback((path: string) => {
    return `shellysvn://update?path=${encodeURIComponent(path)}`
  }, [])
  
  const generateBlameUrl = useCallback((path: string) => {
    return `shellysvn://blame?path=${encodeURIComponent(path)}`
  }, [])
  
  const generateInfoUrl = useCallback((path: string) => {
    return `shellysvn://info?path=${encodeURIComponent(path)}`
  }, [])
  
  return {
    generateCheckoutUrl,
    generateOpenUrl,
    generateLogUrl,
    generateDiffUrl,
    generateCommitUrl,
    generateUpdateUrl,
    generateBlameUrl,
    generateInfoUrl
  }
}

/**
 * Component that listens for deep links and renders UI accordingly
 */
export function DeepLinkHandler({ 
  onCheckout, 
  onOpen, 
  onLog, 
  onDiff, 
  onCommit, 
  onUpdate,
  onBlame,
  onInfo 
}: {
  onCheckout?: (url: string, path?: string) => void
  onOpen?: (path: string) => void
  onLog?: (path: string, revision?: string) => void
  onDiff?: (path: string, revision?: string) => void
  onCommit?: (path: string) => void
  onUpdate?: (path: string) => void
  onBlame?: (path: string) => void
  onInfo?: (path: string) => void
}) {
  const { onAction } = useDeepLinks()
  
  useEffect(() => {
    const cleanup: (() => void)[] = []
    
    if (onCheckout) {
      cleanup.push(onAction('checkout', (link) => {
        onCheckout(link.params.url, link.params.path)
      }))
    }
    
    if (onOpen) {
      cleanup.push(onAction('open', (link) => {
        onOpen(link.params.path)
      }))
    }
    
    if (onLog) {
      cleanup.push(onAction('log', (link) => {
        onLog(link.params.path, link.params.revision)
      }))
    }
    
    if (onDiff) {
      cleanup.push(onAction('diff', (link) => {
        onDiff(link.params.path, link.params.revision)
      }))
    }
    
    if (onCommit) {
      cleanup.push(onAction('commit', (link) => {
        onCommit(link.params.path)
      }))
    }
    
    if (onUpdate) {
      cleanup.push(onAction('update', (link) => {
        onUpdate(link.params.path)
      }))
    }
    
    if (onBlame) {
      cleanup.push(onAction('blame', (link) => {
        onBlame(link.params.path)
      }))
    }
    
    if (onInfo) {
      cleanup.push(onAction('info', (link) => {
        onInfo(link.params.path)
      }))
    }
    
    return () => {
      cleanup.forEach(fn => fn())
    }
  }, [onAction, onCheckout, onOpen, onLog, onDiff, onCommit, onUpdate, onBlame, onInfo])
  
  return null
}

export default useDeepLinks
