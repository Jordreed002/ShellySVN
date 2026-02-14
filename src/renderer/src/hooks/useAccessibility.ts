import { useState, useEffect, useCallback } from 'react'

/**
 * Accessibility settings structure
 */
export interface AccessibilitySettings {
  /** Enable high contrast mode */
  highContrast: boolean
  /** Enable reduced motion */
  reducedMotion: boolean
  /** Font size multiplier (1.0 = normal) */
  fontSizeMultiplier: number
  /** Enable screen reader announcements */
  screenReaderAnnouncements: boolean
  /** Focus indicator style */
  focusIndicatorStyle: 'default' | 'thick' | 'high-contrast'
  /** Enable keyboard navigation enhancements */
  enhancedKeyboardNav: boolean
  /** Enable color blind mode */
  colorBlindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
  /** Reduce animations */
  reduceAnimations: boolean
}

const STORAGE_KEY = 'shellysvn-accessibility-settings'

const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  reducedMotion: false,
  fontSizeMultiplier: 1.0,
  screenReaderAnnouncements: true,
  focusIndicatorStyle: 'default',
  enhancedKeyboardNav: true,
  colorBlindMode: 'none',
  reduceAnimations: false
}

/**
 * Hook for managing accessibility settings
 */
export function useAccessibility() {
  const [settings, setSettings] = useState<AccessibilitySettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  
  /**
   * Load settings from storage and system preferences
   */
  const loadSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      // Load stored settings
      const stored = await window.api.store.get<AccessibilitySettings>(STORAGE_KEY)
      
      // Check system preferences
      const systemPrefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const systemPrefersHighContrast = window.matchMedia('(prefers-contrast: more)').matches
      
      const merged: AccessibilitySettings = {
        ...DEFAULT_SETTINGS,
        ...stored,
        // Use system preference as fallback
        reducedMotion: stored?.reducedMotion ?? systemPrefersReducedMotion,
        highContrast: stored?.highContrast ?? systemPrefersHighContrast
      }
      
      setSettings(merged)
      applySettings(merged)
    } catch (error) {
      console.error('Failed to load accessibility settings:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save settings to storage
   */
  const saveSettings = useCallback(async (newSettings: AccessibilitySettings) => {
    try {
      await window.api.store.set(STORAGE_KEY, newSettings)
    } catch (error) {
      console.error('Failed to save accessibility settings:', error)
    }
  }, [])
  
  /**
   * Update a single setting
   */
  const updateSetting = useCallback(async <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    applySettings(newSettings)
    await saveSettings(newSettings)
  }, [settings, saveSettings])
  
  /**
   * Toggle high contrast mode
   */
  const toggleHighContrast = useCallback(() => {
    updateSetting('highContrast', !settings.highContrast)
  }, [settings.highContrast, updateSetting])
  
  /**
   * Toggle reduced motion
   */
  const toggleReducedMotion = useCallback(() => {
    updateSetting('reducedMotion', !settings.reducedMotion)
  }, [settings.reducedMotion, updateSetting])
  
  /**
   * Increase font size
   */
  const increaseFontSize = useCallback(() => {
    const newSize = Math.min(settings.fontSizeMultiplier + 0.1, 2.0)
    updateSetting('fontSizeMultiplier', newSize)
  }, [settings.fontSizeMultiplier, updateSetting])
  
  /**
   * Decrease font size
   */
  const decreaseFontSize = useCallback(() => {
    const newSize = Math.max(settings.fontSizeMultiplier - 0.1, 0.8)
    updateSetting('fontSizeMultiplier', newSize)
  }, [settings.fontSizeMultiplier, updateSetting])
  
  /**
   * Reset to defaults
   */
  const resetToDefaults = useCallback(async () => {
    setSettings(DEFAULT_SETTINGS)
    applySettings(DEFAULT_SETTINGS)
    await saveSettings(DEFAULT_SETTINGS)
  }, [saveSettings])
  
  /**
   * Announce message for screen readers
   */
  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (!settings.screenReaderAnnouncements) return
    
    const announcer = document.getElementById('sr-announcer')
    if (announcer) {
      announcer.setAttribute('aria-live', priority)
      announcer.textContent = message
      
      // Clear after announcement
      setTimeout(() => {
        announcer.textContent = ''
      }, 1000)
    }
  }, [settings.screenReaderAnnouncements])
  
  // Apply settings to document
  const applySettings = (s: AccessibilitySettings) => {
    const root = document.documentElement
    
    // High contrast
    root.classList.toggle('high-contrast', s.highContrast)
    
    // Reduced motion
    root.classList.toggle('reduced-motion', s.reducedMotion || s.reduceAnimations)
    
    // Font size
    root.style.fontSize = `${s.fontSizeMultiplier * 16}px`
    
    // Focus indicator style
    root.dataset.focusStyle = s.focusIndicatorStyle
    
    // Color blind mode
    root.dataset.colorBlindMode = s.colorBlindMode
  }
  
  // Listen for system preference changes
  useEffect(() => {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const highContrastQuery = window.matchMedia('(prefers-contrast: more)')
    
    const handleReducedMotionChange = (e: MediaQueryListEvent) => {
      if (!settings.reducedMotion) {
        // Only auto-update if user hasn't explicitly set a preference
        const stored = localStorage.getItem(STORAGE_KEY)
        if (!stored) {
          updateSetting('reducedMotion', e.matches)
        }
      }
    }
    
    const handleHighContrastChange = (e: MediaQueryListEvent) => {
      if (!settings.highContrast) {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (!stored) {
          updateSetting('highContrast', e.matches)
        }
      }
    }
    
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange)
    highContrastQuery.addEventListener('change', handleHighContrastChange)
    
    return () => {
      reducedMotionQuery.removeEventListener('change', handleReducedMotionChange)
      highContrastQuery.removeEventListener('change', handleHighContrastChange)
    }
  }, [settings, updateSetting])
  
  // Load on mount
  useEffect(() => {
    loadSettings()
  }, [loadSettings])
  
  return {
    settings,
    isLoading,
    updateSetting,
    toggleHighContrast,
    toggleReducedMotion,
    increaseFontSize,
    decreaseFontSize,
    resetToDefaults,
    announce
  }
}

/**
 * Create screen reader announcer element
 */
export function createAnnouncer(): HTMLElement {
  const announcer = document.createElement('div')
  announcer.id = 'sr-announcer'
  announcer.setAttribute('role', 'status')
  announcer.setAttribute('aria-live', 'polite')
  announcer.setAttribute('aria-atomic', 'true')
  announcer.className = 'sr-only'
  announcer.style.cssText = `
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  `
  return announcer
}

/**
 * Accessibility CSS classes to add to the document
 */
export const accessibilityStyles = `
/* High Contrast Mode */
.high-contrast {
  --text-primary: #000000;
  --text-secondary: #333333;
  --background: #ffffff;
  --border: #000000;
}

.high-contrast .status-modified { color: #0000cc; }
.high-contrast .status-added { color: #006600; }
.high-contrast .status-deleted { color: #cc0000; }
.high-contrast .status-conflicted { color: #cc00cc; }

/* Reduced Motion */
.reduced-motion,
.reduced-motion * {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}

/* Focus Indicators */
[data-focus-style="thick"] *:focus {
  outline: 3px solid #0078d4 !important;
  outline-offset: 2px !important;
}

[data-focus-style="high-contrast"] *:focus {
  outline: 3px solid #000000 !important;
  outline-offset: 2px !important;
  background-color: #ffff00 !important;
}

/* Color Blind Modes */
[data-color-blind-mode="protanopia"] .status-modified,
[data-color-blind-mode="deuteranopia"] .status-modified {
  color: #0077bb;
}

[data-color-blind-mode="protanopia"] .status-added,
[data-color-blind-mode="deuteranopia"] .status-added {
  color: #009988;
}

[data-color-blind-mode="tritanopia"] .status-modified {
  color: #ee7733;
}

/* Screen Reader Only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`

export default useAccessibility
