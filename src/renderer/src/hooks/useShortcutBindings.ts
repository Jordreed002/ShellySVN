import { useState, useCallback, useEffect } from 'react'

/**
 * Customizable shortcut binding
 */
export interface ShortcutBinding {
  id: string
  name: string
  description?: string
  category: string
  defaultKey: string
  currentKey: string
  enabled: boolean
}

/**
 * Shortcut category
 */
export interface ShortcutCategory {
  id: string
  name: string
  description?: string
}

const STORAGE_KEY = 'shellysvn-shortcut-bindings'

const CATEGORIES: ShortcutCategory[] = [
  { id: 'navigation', name: 'Navigation' },
  { id: 'file-operations', name: 'File Operations' },
  { id: 'svn-operations', name: 'SVN Operations' },
  { id: 'view', name: 'View' },
  { id: 'general', name: 'General' }
]

/**
 * Default shortcut bindings
 */
const DEFAULT_BINDINGS: ShortcutBinding[] = [
  { id: 'open-repo', name: 'Open Repository', category: 'general', defaultKey: 'Ctrl+O', currentKey: 'Ctrl+O', enabled: true },
  { id: 'refresh', name: 'Refresh', category: 'navigation', defaultKey: 'F5', currentKey: 'F5', enabled: true },
  { id: 'go-up', name: 'Go to Parent Folder', category: 'navigation', defaultKey: 'Backspace', currentKey: 'Backspace', enabled: true },
  { id: 'select-all', name: 'Select All', category: 'file-operations', defaultKey: 'Ctrl+A', currentKey: 'Ctrl+A', enabled: true },
  { id: 'copy-path', name: 'Copy Path', category: 'file-operations', defaultKey: 'Ctrl+Shift+C', currentKey: 'Ctrl+Shift+C', enabled: true },
  { id: 'delete', name: 'Delete', category: 'file-operations', defaultKey: 'Delete', currentKey: 'Delete', enabled: true },
  { id: 'commit', name: 'Commit', category: 'svn-operations', defaultKey: 'Ctrl+K', currentKey: 'Ctrl+K', enabled: true },
  { id: 'update', name: 'Update', category: 'svn-operations', defaultKey: 'Ctrl+U', currentKey: 'Ctrl+U', enabled: true },
  { id: 'revert', name: 'Revert', category: 'svn-operations', defaultKey: 'Ctrl+R', currentKey: 'Ctrl+R', enabled: true },
  { id: 'diff', name: 'Diff', category: 'svn-operations', defaultKey: 'Ctrl+D', currentKey: 'Ctrl+D', enabled: true },
  { id: 'log', name: 'Show Log', category: 'svn-operations', defaultKey: 'Ctrl+L', currentKey: 'Ctrl+L', enabled: true },
  { id: 'toggle-sidebar', name: 'Toggle Sidebar', category: 'view', defaultKey: 'Ctrl+B', currentKey: 'Ctrl+B', enabled: true },
  { id: 'toggle-details', name: 'Toggle Details Panel', category: 'view', defaultKey: 'Ctrl+Shift+D', currentKey: 'Ctrl+Shift+D', enabled: true },
  { id: 'command-palette', name: 'Command Palette', category: 'general', defaultKey: 'Ctrl+Shift+P', currentKey: 'Ctrl+Shift+P', enabled: true },
  { id: 'settings', name: 'Open Settings', category: 'general', defaultKey: 'Ctrl+,', currentKey: 'Ctrl+,', enabled: true },
  { id: 'search', name: 'Search Files', category: 'navigation', defaultKey: 'Ctrl+F', currentKey: 'Ctrl+F', enabled: true }
]

/**
 * Hook for managing customizable keyboard shortcut bindings
 */
export function useShortcutBindings() {
  const [bindings, setBindings] = useState<ShortcutBinding[]>(DEFAULT_BINDINGS)
  const [isRecording, setIsRecording] = useState<string | null>(null)
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  
  /**
   * Load bindings from storage
   */
  const loadBindings = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = await window.api.store.get<ShortcutBinding[]>(STORAGE_KEY)
      if (stored) {
        // Merge with defaults to ensure all shortcuts exist
        const merged = DEFAULT_BINDINGS.map(defaultBinding => {
          const storedBinding = stored.find(s => s.id === defaultBinding.id)
          return storedBinding ? { ...defaultBinding, ...storedBinding } : defaultBinding
        })
        setBindings(merged)
      }
    } catch (error) {
      console.error('Failed to load shortcut bindings:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save bindings to storage
   */
  const saveBindings = useCallback(async (newBindings: ShortcutBinding[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newBindings)
    } catch (error) {
      console.error('Failed to save shortcut bindings:', error)
    }
  }, [])
  
  /**
   * Update a binding's key
   */
  const updateBinding = useCallback(async (id: string, newKey: string): Promise<boolean> => {
    // Check for conflicts
    const conflict = bindings.find(b => b.id !== id && b.currentKey === newKey && b.enabled)
    if (conflict) {
      setConflictWarning(`Key "${newKey}" is already bound to "${conflict.name}"`)
      return false
    }
    
    const newBindings = bindings.map(b => 
      b.id === id ? { ...b, currentKey: newKey } : b
    )
    
    setBindings(newBindings)
    setConflictWarning(null)
    await saveBindings(newBindings)
    
    return true
  }, [bindings, saveBindings])
  
  /**
   * Enable/disable a binding
   */
  const setBindingEnabled = useCallback(async (id: string, enabled: boolean): Promise<void> => {
    const newBindings = bindings.map(b => 
      b.id === id ? { ...b, enabled } : b
    )
    
    setBindings(newBindings)
    await saveBindings(newBindings)
  }, [bindings, saveBindings])
  
  /**
   * Reset a binding to default
   */
  const resetBinding = useCallback(async (id: string): Promise<void> => {
    const binding = bindings.find(b => b.id === id)
    if (binding) {
      await updateBinding(id, binding.defaultKey)
    }
  }, [bindings, updateBinding])
  
  /**
   * Reset all bindings to defaults
   */
  const resetAllBindings = useCallback(async (): Promise<void> => {
    const reset = DEFAULT_BINDINGS.map(b => ({ ...b, currentKey: b.defaultKey }))
    setBindings(reset)
    await saveBindings(reset)
  }, [saveBindings])
  
  /**
   * Get bindings by category
   */
  const getByCategory = useCallback((categoryId: string): ShortcutBinding[] => {
    return bindings.filter(b => b.category === categoryId)
  }, [bindings])
  
  /**
   * Export bindings as JSON
   */
  const exportBindings = useCallback((): string => {
    const record: Record<string, { key: string; enabled: boolean }> = {}
    for (const b of bindings) {
      record[b.id] = { key: b.currentKey, enabled: b.enabled }
    }
    return JSON.stringify(record, null, 2)
  }, [bindings])
  
  /**
   * Import bindings from JSON
   */
  const importBindings = useCallback(async (json: string): Promise<void> => {
    try {
      const imported = JSON.parse(json) as Record<string, { key: string; enabled: boolean }>
      const newBindings = bindings.map(b => {
        const importedBinding = imported[b.id]
        if (importedBinding) {
          return { ...b, currentKey: importedBinding.key, enabled: importedBinding.enabled }
        }
        return b
      })
      
      setBindings(newBindings)
      await saveBindings(newBindings)
    } catch (error) {
      throw new Error('Invalid bindings format')
    }
  }, [bindings, saveBindings])
  
  /**
   * Start recording a new key
   */
  const startRecording = useCallback((id: string) => {
    setIsRecording(id)
    setConflictWarning(null)
  }, [])
  
  /**
   * Stop recording
   */
  const stopRecording = useCallback(() => {
    setIsRecording(null)
  }, [])
  
  // Load on mount
  useEffect(() => {
    loadBindings()
  }, [loadBindings])
  
  return {
    bindings,
    categories: CATEGORIES,
    isLoading,
    isRecording,
    conflictWarning,
    updateBinding,
    setBindingEnabled,
    resetBinding,
    resetAllBindings,
    getByCategory,
    exportBindings,
    importBindings,
    startRecording,
    stopRecording,
    clearConflictWarning: () => setConflictWarning(null)
  }
}

export default useShortcutBindings
