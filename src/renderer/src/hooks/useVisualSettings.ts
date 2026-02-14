import { useEffect } from 'react'
import type { AppSettings } from '@shared/types'

/**
 * Hook to apply visual settings (accent color, animations, etc.) to the app
 */
export function useVisualSettings(settings: AppSettings | undefined) {
  // Apply accent color as CSS variable
  useEffect(() => {
    if (settings?.accentColor) {
      document.documentElement.style.setProperty('--color-accent', settings.accentColor)
      
      // Calculate hover variant (slightly lighter)
      const hoverColor = adjustColorBrightness(settings.accentColor, 15)
      document.documentElement.style.setProperty('--color-accent-hover', hoverColor)
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
