import { useState, useCallback, useEffect } from 'react'

/**
 * Theme color configuration
 */
export interface ThemeColors {
  // Background colors
  background: string
  surface: string
  surfaceHover: string
  surfaceActive: string
  
  // Text colors
  textPrimary: string
  textSecondary: string
  textMuted: string
  textInverse: string
  
  // Brand colors
  primary: string
  primaryHover: string
  primaryActive: string
  
  // Status colors
  success: string
  warning: string
  error: string
  info: string
  
  // Border colors
  border: string
  borderFocus: string
  divider: string
  
  // Code/syntax colors
  codeBackground: string
  codeKeyword: string
  codeString: string
  codeComment: string
  codeNumber: string
  codeFunction: string
  
  // SVN status colors
  statusAdded: string
  statusModified: string
  statusDeleted: string
  statusConflicted: string
  statusUnversioned: string
  statusIgnored: string
  statusExternal: string
  statusLocked: string
}

/**
 * Complete theme configuration
 */
export interface Theme {
  id: string
  name: string
  description?: string
  type: 'light' | 'dark'
  colors: ThemeColors
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'shellysvn-themes'
const ACTIVE_THEME_KEY = 'shellysvn-active-theme'

/**
 * Default light theme
 */
const LIGHT_THEME: Theme = {
  id: 'light',
  name: 'Light',
  type: 'light',
  isBuiltIn: true,
  createdAt: 0,
  updatedAt: 0,
  colors: {
    background: '#ffffff',
    surface: '#f8fafc',
    surfaceHover: '#f1f5f9',
    surfaceActive: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    textInverse: '#ffffff',
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    primaryActive: '#1d4ed8',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#0ea5e9',
    border: '#e2e8f0',
    borderFocus: '#3b82f6',
    divider: '#f1f5f9',
    codeBackground: '#f8fafc',
    codeKeyword: '#8b5cf6',
    codeString: '#22c55e',
    codeComment: '#94a3b8',
    codeNumber: '#f59e0b',
    codeFunction: '#3b82f6',
    statusAdded: '#22c55e',
    statusModified: '#f59e0b',
    statusDeleted: '#ef4444',
    statusConflicted: '#8b5cf6',
    statusUnversioned: '#64748b',
    statusIgnored: '#94a3b8',
    statusExternal: '#06b6d4',
    statusLocked: '#ec4899'
  }
}

/**
 * Default dark theme
 */
const DARK_THEME: Theme = {
  id: 'dark',
  name: 'Dark',
  type: 'dark',
  isBuiltIn: true,
  createdAt: 0,
  updatedAt: 0,
  colors: {
    background: '#0f172a',
    surface: '#1e293b',
    surfaceHover: '#334155',
    surfaceActive: '#475569',
    textPrimary: '#f8fafc',
    textSecondary: '#cbd5e1',
    textMuted: '#64748b',
    textInverse: '#0f172a',
    primary: '#3b82f6',
    primaryHover: '#60a5fa',
    primaryActive: '#93c5fd',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#0ea5e9',
    border: '#334155',
    borderFocus: '#3b82f6',
    divider: '#1e293b',
    codeBackground: '#1e293b',
    codeKeyword: '#a78bfa',
    codeString: '#4ade80',
    codeComment: '#64748b',
    codeNumber: '#fbbf24',
    codeFunction: '#60a5fa',
    statusAdded: '#4ade80',
    statusModified: '#fbbf24',
    statusDeleted: '#f87171',
    statusConflicted: '#c084fc',
    statusUnversioned: '#94a3b8',
    statusIgnored: '#64748b',
    statusExternal: '#22d3ee',
    statusLocked: '#f472b6'
  }
}

const BUILT_IN_THEMES = [LIGHT_THEME, DARK_THEME]

/**
 * Hook for managing custom themes
 */
export function useThemes() {
  const [themes, setThemes] = useState<Theme[]>(BUILT_IN_THEMES)
  const [activeThemeId, setActiveThemeId] = useState<string>('light')
  const [isLoading, setIsLoading] = useState(true)
  
  const activeTheme = themes.find(t => t.id === activeThemeId) || LIGHT_THEME
  
  /**
   * Load themes from storage
   */
  const loadThemes = useCallback(async () => {
    setIsLoading(true)
    try {
      const [storedThemes, storedActiveId] = await Promise.all([
        window.api.store.get<Theme[]>(STORAGE_KEY),
        window.api.store.get<string>(ACTIVE_THEME_KEY)
      ])
      
      if (storedThemes) {
        // Merge built-in with custom themes
        const customThemes = storedThemes.filter(t => !t.isBuiltIn)
        setThemes([...BUILT_IN_THEMES, ...customThemes])
      }
      
      if (storedActiveId) {
        setActiveThemeId(storedActiveId)
      }
    } catch (error) {
      console.error('Failed to load themes:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save custom themes
   */
  const saveThemes = useCallback(async (newThemes: Theme[]) => {
    try {
      const customThemes = newThemes.filter(t => !t.isBuiltIn)
      await window.api.store.set(STORAGE_KEY, customThemes)
    } catch (error) {
      console.error('Failed to save themes:', error)
    }
  }, [])
  
  /**
   * Apply theme to document
   */
  const applyTheme = useCallback((theme: Theme) => {
    const root = document.documentElement
    
    // Set theme type
    root.classList.remove('light', 'dark')
    root.classList.add(theme.type)
    
    // Apply CSS variables
    for (const [key, value] of Object.entries(theme.colors)) {
      const cssVar = key.replace(/([A-Z])/g, '-$1').toLowerCase()
      root.style.setProperty(`--color-${cssVar}`, value)
    }
    
    // Save active theme
    window.api.store.set(ACTIVE_THEME_KEY, theme.id)
  }, [])
  
  /**
   * Set active theme
   */
  const setTheme = useCallback(async (themeId: string): Promise<void> => {
    const theme = themes.find(t => t.id === themeId)
    if (theme) {
      setActiveThemeId(themeId)
      applyTheme(theme)
    }
  }, [themes, applyTheme])
  
  /**
   * Create custom theme
   */
  const createTheme = useCallback(async (
    name: string,
    type: 'light' | 'dark',
    colors: Partial<ThemeColors> = {}
  ): Promise<Theme> => {
    const baseTheme = type === 'dark' ? DARK_THEME : LIGHT_THEME
    const now = Date.now()
    
    const theme: Theme = {
      id: `theme-${now}`,
      name,
      type,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
      colors: { ...baseTheme.colors, ...colors }
    }
    
    const newThemes = [...themes, theme]
    setThemes(newThemes)
    await saveThemes(newThemes)
    
    return theme
  }, [themes, saveThemes])
  
  /**
   * Update custom theme
   */
  const updateTheme = useCallback(async (
    id: string,
    updates: Partial<Pick<Theme, 'name' | 'description' | 'colors'>>
  ): Promise<void> => {
    const newThemes = themes.map(t => 
      t.id === id && !t.isBuiltIn
        ? { ...t, ...updates, updatedAt: Date.now() }
        : t
    )
    setThemes(newThemes)
    await saveThemes(newThemes)
    
    // Re-apply if this is the active theme
    if (activeThemeId === id) {
      const updated = newThemes.find(t => t.id === id)
      if (updated) {
        applyTheme(updated)
      }
    }
  }, [themes, activeThemeId, saveThemes, applyTheme])
  
  /**
   * Delete custom theme
   */
  const deleteTheme = useCallback(async (id: string): Promise<void> => {
    const theme = themes.find(t => t.id === id)
    if (theme?.isBuiltIn) return
    
    const newThemes = themes.filter(t => t.id !== id)
    setThemes(newThemes)
    await saveThemes(newThemes)
    
    // Switch to default if deleted theme was active
    if (activeThemeId === id) {
      await setTheme('light')
    }
  }, [themes, activeThemeId, saveThemes, setTheme])
  
  /**
   * Duplicate theme
   */
  const duplicateTheme = useCallback(async (id: string): Promise<Theme> => {
    const source = themes.find(t => t.id === id)
    if (!source) throw new Error('Theme not found')
    
    return createTheme(
      `${source.name} (Copy)`,
      source.type,
      source.colors
    )
  }, [themes, createTheme])
  
  /**
   * Export theme as JSON
   */
  const exportTheme = useCallback((id: string): string => {
    const theme = themes.find(t => t.id === id)
    if (!theme) throw new Error('Theme not found')
    
    return JSON.stringify(theme, null, 2)
  }, [themes])
  
  /**
   * Import theme from JSON
   */
  const importTheme = useCallback(async (json: string): Promise<Theme> => {
    try {
      const imported = JSON.parse(json) as Theme
      
      if (!imported.name || !imported.type || !imported.colors) {
        throw new Error('Invalid theme format')
      }
      
      return createTheme(imported.name, imported.type, imported.colors)
    } catch (error) {
      throw new Error('Failed to import theme: invalid format')
    }
  }, [createTheme])
  
  // Load on mount
  useEffect(() => {
    loadThemes()
  }, [loadThemes])
  
  // Apply active theme on change
  useEffect(() => {
    if (activeTheme) {
      applyTheme(activeTheme)
    }
  }, [activeTheme, applyTheme])
  
  return {
    themes,
    activeTheme,
    activeThemeId,
    isLoading,
    setTheme,
    createTheme,
    updateTheme,
    deleteTheme,
    duplicateTheme,
    exportTheme,
    importTheme
  }
}

export default useThemes
