import { useState, useEffect, useCallback } from 'react'

const MAX_HISTORY_SIZE = 50
const STORAGE_KEY = 'shellysvn:commit-message-history'

export interface CommitMessageEntry {
  message: string
  timestamp: number
  path?: string
}

/**
 * Hook for managing commit message history
 */
export function useCommitMessageHistory() {
  const [history, setHistory] = useState<CommitMessageEntry[]>([])
  
  // Load history from storage
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await window.api.store.get<CommitMessageEntry[]>(STORAGE_KEY)
        if (stored && Array.isArray(stored)) {
          setHistory(stored)
        }
      } catch (err) {
        console.error('Failed to load commit message history:', err)
      }
    }
    loadHistory()
  }, [])
  
  // Save history to storage
  const saveHistory = useCallback(async (newHistory: CommitMessageEntry[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newHistory)
    } catch (err) {
      console.error('Failed to save commit message history:', err)
    }
  }, [])
  
  // Add a new commit message to history
  const addMessage = useCallback(async (message: string, path?: string) => {
    if (!message.trim()) return
    
    const entry: CommitMessageEntry = {
      message: message.trim(),
      timestamp: Date.now(),
      path
    }
    
    setHistory(prev => {
      // Remove duplicates (same message)
      const filtered = prev.filter(h => h.message !== message.trim())
      // Add new entry at the beginning
      const newHistory = [entry, ...filtered].slice(0, MAX_HISTORY_SIZE)
      saveHistory(newHistory)
      return newHistory
    })
  }, [saveHistory])
  
  // Remove a specific message from history
  const removeMessage = useCallback(async (timestamp: number) => {
    setHistory(prev => {
      const newHistory = prev.filter(h => h.timestamp !== timestamp)
      saveHistory(newHistory)
      return newHistory
    })
  }, [saveHistory])
  
  // Clear all history
  const clearHistory = useCallback(async () => {
    setHistory([])
    await window.api.store.delete(STORAGE_KEY)
  }, [])
  
  // Get recent messages (for autocomplete)
  const getRecentMessages = useCallback((limit = 10) => {
    return history.slice(0, limit)
  }, [history])
  
  // Search messages
  const searchMessages = useCallback((query: string) => {
    if (!query.trim()) return history
    const lowerQuery = query.toLowerCase()
    return history.filter(h => 
      h.message.toLowerCase().includes(lowerQuery)
    )
  }, [history])
  
  return {
    history,
    addMessage,
    removeMessage,
    clearHistory,
    getRecentMessages,
    searchMessages
  }
}

// ============================================
// Commit Templates
// ============================================

export interface CommitTemplate {
  id: string
  name: string
  template: string
  category?: string
}

const DEFAULT_TEMPLATES: CommitTemplate[] = [
  {
    id: 'feature',
    name: 'New Feature',
    template: 'feat: [description]\n\n- What: \n- Why: \n- How: ',
    category: 'type'
  },
  {
    id: 'bugfix',
    name: 'Bug Fix',
    template: 'fix: [description]\n\n- Issue: \n- Root cause: \n- Solution: ',
    category: 'type'
  },
  {
    id: 'refactor',
    name: 'Refactoring',
    template: 'refactor: [description]\n\n- Before: \n- After: \n- Why: ',
    category: 'type'
  },
  {
    id: 'docs',
    name: 'Documentation',
    template: 'docs: [description]\n\n- Updated: \n- Added: ',
    category: 'type'
  },
  {
    id: 'test',
    name: 'Tests',
    template: 'test: [description]\n\n- Added: \n- Modified: ',
    category: 'type'
  },
  {
    id: 'release',
    name: 'Release',
    template: 'release: v[version]\n\nChanges:\n- ',
    category: 'type'
  }
]

const TEMPLATES_KEY = 'shellysvn:commit-templates'

/**
 * Hook for managing commit templates
 */
export function useCommitTemplates() {
  const [templates, setTemplates] = useState<CommitTemplate[]>(DEFAULT_TEMPLATES)
  
  // Load custom templates from storage
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const stored = await window.api.store.get<CommitTemplate[]>(TEMPLATES_KEY)
        if (stored && Array.isArray(stored) && stored.length > 0) {
          // Merge custom templates with defaults
          setTemplates([...DEFAULT_TEMPLATES, ...stored.filter(t => 
            !DEFAULT_TEMPLATES.some(d => d.id === t.id)
          )])
        }
      } catch (err) {
        console.error('Failed to load commit templates:', err)
      }
    }
    loadTemplates()
  }, [])
  
  // Add a custom template
  const addTemplate = useCallback(async (template: Omit<CommitTemplate, 'id'>) => {
    const newTemplate: CommitTemplate = {
      ...template,
      id: `custom-${Date.now()}`
    }
    
    setTemplates(prev => {
      const newTemplates = [...prev, newTemplate]
      // Save only custom templates (not defaults)
      window.api.store.set(TEMPLATES_KEY, newTemplates.filter(t => t.id.startsWith('custom-')))
      return newTemplates
    })
    
    return newTemplate
  }, [])
  
  // Remove a custom template
  const removeTemplate = useCallback(async (id: string) => {
    if (id.startsWith('custom-')) {
      setTemplates(prev => {
        const newTemplates = prev.filter(t => t.id !== id)
        window.api.store.set(TEMPLATES_KEY, newTemplates.filter(t => t.id.startsWith('custom-')))
        return newTemplates
      })
    }
  }, [])
  
  // Apply a template (returns the template string)
  const applyTemplate = useCallback((templateId: string) => {
    const template = templates.find(t => t.id === templateId)
    return template?.template || ''
  }, [templates])
  
  return {
    templates,
    addTemplate,
    removeTemplate,
    applyTemplate
  }
}
