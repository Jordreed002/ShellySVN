import { useEffect, useCallback } from 'react'

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  action: () => void
  description?: string
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean
  shortcuts: KeyboardShortcut[]
}

/**
 * Hook for registering global keyboard shortcuts
 */
export function useKeyboardShortcuts({ enabled = true, shortcuts }: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // Allow specific shortcuts even in inputs (like Escape)
      if (event.key !== 'Escape') {
        return
      }
    }
    
    for (const shortcut of shortcuts) {
      const ctrlMatch = shortcut.ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey
      const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey
      const altMatch = shortcut.alt ? event.altKey : !event.altKey
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()
      
      if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
        event.preventDefault()
        shortcut.action()
        return
      }
    }
  }, [shortcuts])
  
  useEffect(() => {
    if (!enabled) return
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}

// Common keyboard shortcuts for SVN operations
export const COMMON_SVN_SHORTCUTS = {
  COMMIT: { key: 's', ctrl: true, description: 'Commit changes' },
  UPDATE: { key: 'u', ctrl: true, description: 'Update working copy' },
  REVERT: { key: 'r', ctrl: true, shift: true, description: 'Revert changes' },
  REFRESH: { key: 'F5', description: 'Refresh file list' },
  LOG: { key: 'l', ctrl: true, description: 'Show log' },
  DIFF: { key: 'd', ctrl: true, description: 'Show diff' },
  ADD: { key: 'a', ctrl: true, description: 'Add to version control' },
  DELETE: { key: 'Delete', description: 'Delete selected' },
  SELECT_ALL: { key: 'a', ctrl: true, shift: true, description: 'Select all files' },
  ESCAPE: { key: 'Escape', description: 'Close dialog / Cancel' },
  SEARCH: { key: 'f', ctrl: true, description: 'Search files' },
  SETTINGS: { key: ',', ctrl: true, description: 'Open settings' },
} as const

/**
 * Format keyboard shortcut for display
 */
export function formatShortcut(shortcut: Partial<KeyboardShortcut>): string {
  const parts: string[] = []
  
  if (shortcut.ctrl) {
    parts.push(navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')
  }
  if (shortcut.shift) {
    parts.push(navigator.platform.includes('Mac') ? '⇧' : 'Shift')
  }
  if (shortcut.alt) {
    parts.push(navigator.platform.includes('Mac') ? '⌥' : 'Alt')
  }
  if (shortcut.key) {
    // Format special keys
    const key = shortcut.key.toLowerCase()
    const keyMap: Record<string, string> = {
      'escape': 'Esc',
      'arrowup': '↑',
      'arrowdown': '↓',
      'arrowleft': '←',
      'arrowright': '→',
      'enter': '↵',
      'backspace': '⌫',
      'delete': 'Del',
    }
    parts.push(keyMap[key] || key.toUpperCase())
  }
  
  return parts.join(navigator.platform.includes('Mac') ? '' : '+')
}
