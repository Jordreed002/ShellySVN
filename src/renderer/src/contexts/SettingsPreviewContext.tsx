import { useCallback, useState, createContext, useContext, type ReactNode } from 'react'
import type { AppSettings } from '@shared/types'

/**
 * Settings Preview Context
 * 
 * Provides live preview of settings changes in the SettingsDialog.
 * When users change settings, the preview is applied immediately.
 * On cancel, the preview reverts to the saved settings.
 * On save, the saved settings are updated and preview syncs.
 */

interface SettingsPreviewContextType {
  /** The settings currently being previewed (may differ from saved) */
  previewSettings: AppSettings | null
  /** Update a preview setting (applies immediately) */
  updatePreviewSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  /** Update a nested preview setting (applies immediately) */
  updateNestedPreviewSetting: <K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => void
  /** Start preview mode with given settings */
  startPreview: (settings: AppSettings) => void
  /** Commit preview (called when settings are saved) */
  commitPreview: () => void
  /** Cancel preview and revert to saved settings */
  cancelPreview: (savedSettings: AppSettings) => void
  /** Whether we're currently in preview mode */
  isPreviewing: boolean
  /** Whether there are unsaved preview changes */
  hasPreviewChanges: boolean
}

const SettingsPreviewContext = createContext<SettingsPreviewContextType | null>(null)

export function useSettingsPreview() {
  const context = useContext(SettingsPreviewContext)
  if (!context) {
    throw new Error('useSettingsPreview must be used within SettingsPreviewProvider')
  }
  return context
}

export function SettingsPreviewProvider({ children }: { children: ReactNode }) {
  const [previewSettings, setPreviewSettings] = useState<AppSettings | null>(null)
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [hasPreviewChanges, setHasPreviewChanges] = useState(false)

  // Apply visual changes immediately
  const applyVisualChanges = useCallback((settings: AppSettings) => {
    const root = document.documentElement
    
    // Apply theme
    const isDark = settings.theme === 'dark' || 
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.remove('light', 'dark')
    root.classList.add(isDark ? 'dark' : 'light')
    
    // Apply accent color
    if (settings.accentColor) {
      const rgb = hexToRgb(settings.accentColor)
      if (rgb) {
        root.style.setProperty('--color-accent-rgb', `${rgb.r} ${rgb.g} ${rgb.b}`)
        
        const hoverColor = adjustColorBrightness(settings.accentColor, 20)
        const hoverRgb = hexToRgb(hoverColor)
        if (hoverRgb) {
          root.style.setProperty('--color-accent-hover-rgb', `${hoverRgb.r} ${hoverRgb.g} ${hoverRgb.b}`)
        }
        
        const mutedColor = adjustColorBrightness(settings.accentColor, -15)
        const mutedRgb = hexToRgb(mutedColor)
        if (mutedRgb) {
          root.style.setProperty('--color-accent-muted-rgb', `${mutedRgb.r} ${mutedRgb.g} ${mutedRgb.b}`)
        }
        
        root.style.setProperty('--color-accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`)
      }
    }
    
    // Apply sidebar width
    if (settings.sidebarWidth) {
      root.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`)
    }
    
    // Apply font size
    root.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
    if (settings.fontSize) {
      root.classList.add(`font-size-${settings.fontSize}`)
    }
    
    // Apply animation speed
    root.classList.remove('animations-none', 'animations-fast', 'animations-normal')
    if (settings.animationSpeed) {
      root.classList.add(`animations-${settings.animationSpeed}`)
    }
  }, [])

  const updatePreviewSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setPreviewSettings(prev => {
      if (!prev) return prev
      const updated = { ...prev, [key]: value }
      
      // Apply visual change immediately
      applyVisualChanges(updated)
      
      // Check if different from original
      if (originalSettings) {
        setHasPreviewChanges(JSON.stringify(updated) !== JSON.stringify(originalSettings))
      }
      
      return updated
    })
  }, [applyVisualChanges, originalSettings])

  const updateNestedPreviewSetting = useCallback(<K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => {
    setPreviewSettings(prev => {
      if (!prev) return prev
      const nestedValue = prev[key] as unknown as Record<string, unknown>
      const updated = {
        ...prev,
        [key]: {
          ...nestedValue,
          [subKey]: value
        }
      }
      
      // Apply visual change immediately
      applyVisualChanges(updated)
      
      // Check if different from original
      if (originalSettings) {
        setHasPreviewChanges(JSON.stringify(updated) !== JSON.stringify(originalSettings))
      }
      
      return updated
    })
  }, [applyVisualChanges, originalSettings])

  const startPreview = useCallback((settings: AppSettings) => {
    setPreviewSettings(settings)
    setOriginalSettings(settings)
    setIsPreviewing(true)
    setHasPreviewChanges(false)
    applyVisualChanges(settings)
  }, [applyVisualChanges])

  const commitPreview = useCallback(() => {
    // Preview is committed - clear preview state
    setIsPreviewing(false)
    setHasPreviewChanges(false)
    // Don't clear previewSettings - let it stay for visual continuity
  }, [])

  const cancelPreview = useCallback((savedSettings: AppSettings) => {
    // Revert to saved settings
    applyVisualChanges(savedSettings)
    setPreviewSettings(savedSettings)
    setIsPreviewing(false)
    setHasPreviewChanges(false)
    setOriginalSettings(null)
  }, [applyVisualChanges])

  return (
    <SettingsPreviewContext.Provider
      value={{
        previewSettings,
        updatePreviewSetting,
        updateNestedPreviewSetting,
        startPreview,
        commitPreview,
        cancelPreview,
        isPreviewing,
        hasPreviewChanges
      }}
    >
      {children}
    </SettingsPreviewContext.Provider>
  )
}

// Helper functions (same as in useVisualSettings)
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.replace('#', '')
  if (cleanHex.length !== 6) return null
  
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)
  
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null
  return { r, g, b }
}

function adjustColorBrightness(hex: string, percent: number): string {
  const cleanHex = hex.replace('#', '')
  
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)
  
  const adjust = (value: number) => {
    const adjusted = value + (255 * percent / 100)
    return Math.min(255, Math.max(0, Math.round(adjusted)))
  }
  
  const newR = adjust(r)
  const newG = adjust(g)
  const newB = adjust(b)
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}
