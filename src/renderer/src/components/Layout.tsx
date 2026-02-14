import { ReactNode, useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { KeyboardShortcutsDialog } from './ui/KeyboardShortcutsDialog'
import { CommandPalette } from './ui/CommandPalette'
import { useSettings } from '../hooks/useSettings'
import { useVisualSettings } from '../hooks/useVisualSettings'
import { useNavigate, useRouterState } from '@tanstack/react-router'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const { settings } = useSettings()
  const navigate = useNavigate()
  
  // Safely get the current path from the active route
  // This works regardless of which route is currently active
  const routerState = useRouterState()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentPath = (routerState.location.search as any)?.path as string | undefined
  
  // Apply visual settings (accent color, animations, etc.)
  useVisualSettings(settings)
  
  // Global keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Show command palette on Ctrl+P or Cmd+P
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        setShowCommandPalette(true)
        return
      }
      
      // Show shortcuts on "?"
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement
        // Don't trigger if typing in an input
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        setShowShortcuts(true)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  const handleGoToPath = (targetPath: string) => {
    navigate({ to: '/files', search: { path: targetPath } })
  }
  
  return (
    <div className="flex h-screen bg-bg text-text">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Title bar drag region for macOS */}
        <div className="h-[32px] bg-bg-tertiary titlebar-drag flex items-center px-4 border-b border-border">
          <span className="text-xs text-text-muted font-medium">ShellySVN</span>
        </div>
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </main>
      
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog 
        isOpen={showShortcuts} 
        onClose={() => setShowShortcuts(false)} 
      />
      
      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        currentPath={currentPath}
        recentPaths={settings.recentPaths}
        bookmarks={settings.bookmarks}
        onGoToPath={handleGoToPath}
        onOpenSettings={() => {
          setShowCommandPalette(false)
          // Trigger settings dialog - would need prop drilling or context
        }}
        onShowShortcuts={() => {
          setShowCommandPalette(false)
          setShowShortcuts(true)
        }}
      />
    </div>
  )
}
