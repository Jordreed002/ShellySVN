import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Workspace panel configuration
 */
export interface PanelConfig {
  id: string
  type: 'sidebar' | 'filelist' | 'details' | 'log' | 'diff' | 'custom'
  visible: boolean
  width: number
  height?: number
  position: 'left' | 'right' | 'top' | 'bottom' | 'center'
  order: number
}

/**
 * Workspace layout configuration
 */
export interface WorkspaceLayout {
  id: string
  name: string
  description?: string
  panels: PanelConfig[]
  sidebarWidth: number
  detailsHeight: number
  isDefault?: boolean
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'shellysvn-workspace-layouts'

const DEFAULT_LAYOUT: WorkspaceLayout = {
  id: 'default',
  name: 'Default Layout',
  panels: [
    { id: 'sidebar', type: 'sidebar', visible: true, width: 250, position: 'left', order: 0 },
    { id: 'filelist', type: 'filelist', visible: true, width: 400, position: 'center', order: 1 },
    { id: 'details', type: 'details', visible: true, width: 400, position: 'right', order: 2 },
    { id: 'log', type: 'log', visible: false, width: 600, position: 'bottom', order: 3 }
  ],
  sidebarWidth: 250,
  detailsHeight: 200,
  isDefault: true,
  createdAt: Date.now(),
  updatedAt: Date.now()
}

/**
 * Hook for managing workspace layouts
 */
export function useWorkspaceLayouts() {
  const [layouts, setLayouts] = useState<WorkspaceLayout[]>([DEFAULT_LAYOUT])
  const [activeLayout, setActiveLayout] = useState<WorkspaceLayout>(DEFAULT_LAYOUT)
  const [isLoading, setIsLoading] = useState(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  /**
   * Load layouts from storage
   */
  const loadLayouts = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = await window.api.store.get<WorkspaceLayout[]>(STORAGE_KEY)
      if (stored && stored.length > 0) {
        setLayouts(stored)
        const defaultLayout = stored.find(l => l.isDefault) || stored[0]
        setActiveLayout(defaultLayout)
      }
    } catch (error) {
      console.error('Failed to load workspace layouts:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save layouts with debounce
   */
  const saveLayouts = useCallback(async (newLayouts: WorkspaceLayout[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await window.api.store.set(STORAGE_KEY, newLayouts)
      } catch (error) {
        console.error('Failed to save workspace layouts:', error)
      }
    }, 500)
  }, [])
  
  /**
   * Create new layout
   */
  const createLayout = useCallback(async (name: string, description?: string): Promise<WorkspaceLayout> => {
    const now = Date.now()
    const layout: WorkspaceLayout = {
      id: `layout-${now}`,
      name,
      description,
      panels: [...activeLayout.panels],
      sidebarWidth: activeLayout.sidebarWidth,
      detailsHeight: activeLayout.detailsHeight,
      createdAt: now,
      updatedAt: now
    }
    
    const newLayouts = [...layouts, layout]
    setLayouts(newLayouts)
    await saveLayouts(newLayouts)
    
    return layout
  }, [activeLayout, layouts, saveLayouts])
  
  /**
   * Update layout
   */
  const updateLayout = useCallback(async (id: string, updates: Partial<WorkspaceLayout>): Promise<void> => {
    const newLayouts = layouts.map(l => 
      l.id === id 
        ? { ...l, ...updates, updatedAt: Date.now() }
        : l
    )
    setLayouts(newLayouts)
    await saveLayouts(newLayouts)
    
    if (activeLayout.id === id) {
      setActiveLayout(newLayouts.find(l => l.id === id) || activeLayout)
    }
  }, [layouts, activeLayout, saveLayouts])
  
  /**
   * Delete layout
   */
  const deleteLayout = useCallback(async (id: string): Promise<void> => {
    if (id === 'default') return // Can't delete default layout
    
    const newLayouts = layouts.filter(l => l.id !== id)
    setLayouts(newLayouts)
    await saveLayouts(newLayouts)
    
    if (activeLayout.id === id) {
      setActiveLayout(newLayouts.find(l => l.isDefault) || newLayouts[0])
    }
  }, [layouts, activeLayout, saveLayouts])
  
  /**
   * Switch to a different layout
   */
  const switchLayout = useCallback((id: string): void => {
    const layout = layouts.find(l => l.id === id)
    if (layout) {
      setActiveLayout(layout)
    }
  }, [layouts])
  
  /**
   * Set as default layout
   */
  const setAsDefault = useCallback(async (id: string): Promise<void> => {
    const newLayouts = layouts.map(l => ({
      ...l,
      isDefault: l.id === id
    }))
    setLayouts(newLayouts)
    await saveLayouts(newLayouts)
  }, [layouts, saveLayouts])
  
  /**
   * Update panel configuration
   */
  const updatePanel = useCallback(async (panelId: string, updates: Partial<PanelConfig>): Promise<void> => {
    const newPanels = activeLayout.panels.map(p =>
      p.id === panelId ? { ...p, ...updates } : p
    )
    
    await updateLayout(activeLayout.id, { panels: newPanels })
  }, [activeLayout, updateLayout])
  
  /**
   * Toggle panel visibility
   */
  const togglePanel = useCallback(async (panelId: string): Promise<void> => {
    const panel = activeLayout.panels.find(p => p.id === panelId)
    if (panel) {
      await updatePanel(panelId, { visible: !panel.visible })
    }
  }, [activeLayout, updatePanel])
  
  /**
   * Reset to default layout
   */
  const resetToDefault = useCallback(async (): Promise<void> => {
    const defaultLayout = layouts.find(l => l.isDefault)
    if (defaultLayout) {
      setActiveLayout(defaultLayout)
    }
  }, [layouts])
  
  /**
   * Duplicate layout
   */
  const duplicateLayout = useCallback(async (id: string): Promise<WorkspaceLayout> => {
    const source = layouts.find(l => l.id === id)
    if (!source) throw new Error('Layout not found')
    
    const now = Date.now()
    const duplicate: WorkspaceLayout = {
      ...source,
      id: `layout-${now}`,
      name: `${source.name} (Copy)`,
      isDefault: false,
      createdAt: now,
      updatedAt: now
    }
    
    const newLayouts = [...layouts, duplicate]
    setLayouts(newLayouts)
    await saveLayouts(newLayouts)
    
    return duplicate
  }, [layouts, saveLayouts])
  
  // Load on mount
  useEffect(() => {
    loadLayouts()
  }, [loadLayouts])
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])
  
  return {
    layouts,
    activeLayout,
    isLoading,
    createLayout,
    updateLayout,
    deleteLayout,
    switchLayout,
    setAsDefault,
    updatePanel,
    togglePanel,
    resetToDefault,
    duplicateLayout
  }
}

export default useWorkspaceLayouts
