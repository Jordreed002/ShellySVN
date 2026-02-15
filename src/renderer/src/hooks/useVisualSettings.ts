import { useEffect } from 'react'
import type { AppSettings } from '@shared/types'

/**
 * Hook to apply visual settings (theme, accent color, animations, etc.) to the app
 * 
 * This hook connects the settings UI to actual CSS variables and classes,
 * ensuring that when users change settings, the app visually updates.
 * 
 * Note: When the Settings Dialog is open with unsaved changes, the preview
 * system in SettingsPreviewContext handles live preview. This hook only
 * applies the saved settings and won't interfere with preview mode.
 */
export function useVisualSettings(settings: AppSettings | undefined) {
  // Apply theme (light/dark/system)
  useEffect(() => {
    const root = document.documentElement
    
    const applyTheme = (isDark: boolean) => {
      root.classList.remove('light', 'dark')
      root.classList.add(isDark ? 'dark' : 'light')
    }
    
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      applyTheme(e.matches)
    }
    
    if (settings?.theme === 'system' || !settings?.theme) {
      // System theme - listen for changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mediaQuery.matches)
      mediaQuery.addEventListener('change', handleSystemThemeChange)
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange)
    } else {
      applyTheme(settings.theme === 'dark')
      return undefined
    }
  }, [settings?.theme])
  
  // Apply accent color as CSS variable
  useEffect(() => {
    if (settings?.accentColor) {
      const accentColor = settings.accentColor
      
      // Parse the hex color to RGB values
      const rgb = hexToRgb(accentColor)
      if (rgb) {
        // Set RGB values for Tailwind opacity support
        document.documentElement.style.setProperty('--color-accent-rgb', `${rgb.r} ${rgb.g} ${rgb.b}`)
        
        // Set direct color for CSS var usage
        document.documentElement.style.setProperty('--color-accent', `rgb(${rgb.r} ${rgb.g} ${rgb.b})`)
        
        // Calculate hover variant (slightly lighter) and set as RGB
        const hoverColor = adjustColorBrightness(accentColor, 20)
        const hoverRgb = hexToRgb(hoverColor)
        if (hoverRgb) {
          document.documentElement.style.setProperty('--color-accent-hover-rgb', `${hoverRgb.r} ${hoverRgb.g} ${hoverRgb.b}`)
          document.documentElement.style.setProperty('--color-accent-hover', `rgb(${hoverRgb.r} ${hoverRgb.g} ${hoverRgb.b})`)
        }
        
        // Calculate muted variant (slightly darker) and set as RGB
        const mutedColor = adjustColorBrightness(accentColor, -15)
        const mutedRgb = hexToRgb(mutedColor)
        if (mutedRgb) {
          document.documentElement.style.setProperty('--color-accent-muted-rgb', `${mutedRgb.r} ${mutedRgb.g} ${mutedRgb.b}`)
          document.documentElement.style.setProperty('--color-accent-muted', `rgb(${mutedRgb.r} ${mutedRgb.g} ${mutedRgb.b})`)
        }
        
        // Calculate glow color (accent with transparency)
        const glowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`
        document.documentElement.style.setProperty('--color-accent-glow', glowColor)
      }
    }
  }, [settings?.accentColor])
  
  // Apply animation speed
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('animations-none', 'animations-fast', 'animations-normal')
    
    if (settings?.animationSpeed === 'none') {
      root.classList.add('animations-none')
    } else if (settings?.animationSpeed === 'fast') {
      root.classList.add('animations-fast')
    } else {
      root.classList.add('animations-normal')
    }
  }, [settings?.animationSpeed])
  
  // Apply font size
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
    
    if (settings?.fontSize) {
      root.classList.add(`font-size-${settings.fontSize}`)
    }
  }, [settings?.fontSize])
  
  // Apply sidebar width
  useEffect(() => {
    if (settings?.sidebarWidth) {
      document.documentElement.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`)
    }
  }, [settings?.sidebarWidth])
}

/**
 * Adjust color brightness by a percentage
 */
function adjustColorBrightness(hex: string, percent: number): string {
  // Remove # if present
  const cleanHex = hex.replace('#', '')
  
  // Parse RGB values
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)
  
  // Adjust brightness
  const adjust = (value: number) => {
    const adjusted = value + (255 * percent / 100)
    return Math.min(255, Math.max(0, Math.round(adjusted)))
  }
  
  const newR = adjust(r)
  const newG = adjust(g)
  const newB = adjust(b)
  
  // Convert back to hex
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}

/**
 * Convert hex color to RGB object
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # if present
  const cleanHex = hex.replace('#', '')
  
  if (cleanHex.length !== 6) {
    return null
  }
  
  // Parse RGB values
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)
  
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return null
  }
  
  return { r, g, b }
}
