import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { 
  Search, 
  Command,
  Folder,
  Settings,
  Upload,
  Download,
  Undo2,
  History,
  RefreshCw,
  Layers,
  StickyNote,
  Keyboard,
  Eye,
  Columns2,
  Zap,
  Star,
  StarOff
} from 'lucide-react'

interface CommandItem {
  id: string
  title: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  shortcut?: string
  category: string
  action: () => void
  keywords?: string[]
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  currentPath?: string
  // Action callbacks
  onCommit?: () => void
  onUpdate?: () => void
  onRevert?: () => void
  onShowLog?: () => void
  onRefresh?: () => void
  onOpenSettings?: () => void
  onTogglePreview?: () => void
  onToggleDualPane?: () => void
  onToggleFilters?: () => void
  onShowShortcuts?: () => void
  onShowNotes?: () => void
  onQuickCommit?: () => void
  onAddBookmark?: () => void
  onGoToPath?: (path: string) => void
  // Recent paths
  recentPaths?: string[]
  // Bookmarks
  bookmarks?: { path: string; name: string }[]
}

export function CommandPalette({
  isOpen,
  onClose,
  currentPath,
  onCommit,
  onUpdate,
  onRevert,
  onShowLog,
  onRefresh,
  onOpenSettings,
  onTogglePreview,
  onToggleDualPane,
  onToggleFilters,
  onShowShortcuts,
  onShowNotes,
  onQuickCommit,
  onAddBookmark,
  onGoToPath,
  recentPaths = [],
  bookmarks = []
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  
  // Build commands list
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = []
    
    // SVN Actions
    if (onCommit) {
      items.push({
        id: 'commit',
        title: 'Commit Changes',
        description: 'Commit selected files',
        icon: Upload,
        shortcut: 'Ctrl+S',
        category: 'SVN',
        action: onCommit,
        keywords: ['svn', 'checkin', 'save']
      })
    }
    
    if (onUpdate) {
      items.push({
        id: 'update',
        title: 'Update Working Copy',
        description: 'Get latest changes from repository',
        icon: Download,
        shortcut: 'Ctrl+U',
        category: 'SVN',
        action: onUpdate,
        keywords: ['svn', 'checkout', 'pull']
      })
    }
    
    if (onRevert) {
      items.push({
        id: 'revert',
        title: 'Revert Changes',
        description: 'Discard local modifications',
        icon: Undo2,
        shortcut: 'Ctrl+R',
        category: 'SVN',
        action: onRevert,
        keywords: ['svn', 'undo', 'discard']
      })
    }
    
    if (onShowLog) {
      items.push({
        id: 'log',
        title: 'Show Log',
        description: 'View revision history',
        icon: History,
        shortcut: 'Ctrl+L',
        category: 'SVN',
        action: onShowLog,
        keywords: ['svn', 'history', 'revisions']
      })
    }
    
    if (onQuickCommit) {
      items.push({
        id: 'quick-commit',
        title: 'Quick Commit',
        description: 'Commit with auto-generated message',
        icon: Zap,
        category: 'SVN',
        action: onQuickCommit,
        keywords: ['fast', 'auto', 'quick']
      })
    }
    
    // Navigation
    if (onRefresh) {
      items.push({
        id: 'refresh',
        title: 'Refresh',
        description: 'Reload current directory',
        icon: RefreshCw,
        shortcut: 'F5',
        category: 'Navigation',
        action: onRefresh,
        keywords: ['reload', 'update']
      })
    }
    
    // Recent paths
    recentPaths.slice(0, 5).forEach((path, index) => {
      if (onGoToPath) {
        items.push({
          id: `recent-${index}`,
          title: `Go to: ${path.split(/[/\\]/).pop() || path}`,
          description: path,
          icon: Folder,
          category: 'Recent',
          action: () => onGoToPath(path),
          keywords: ['go', 'navigate', 'open']
        })
      }
    })
    
    // Bookmarks
    bookmarks.forEach((bookmark, index) => {
      if (onGoToPath) {
        items.push({
          id: `bookmark-${index}`,
          title: `Bookmark: ${bookmark.name}`,
          description: bookmark.path,
          icon: Star,
          category: 'Bookmarks',
          action: () => onGoToPath(bookmark.path),
          keywords: ['go', 'navigate', 'favorite']
        })
      }
    })
    
    if (onAddBookmark && currentPath) {
      items.push({
        id: 'add-bookmark',
        title: 'Add Bookmark',
        description: 'Bookmark current location',
        icon: StarOff,
        category: 'Bookmarks',
        action: onAddBookmark,
        keywords: ['favorite', 'save']
      })
    }
    
    // View
    if (onTogglePreview) {
      items.push({
        id: 'toggle-preview',
        title: 'Toggle Preview Panel',
        description: 'Show/hide file preview',
        icon: Eye,
        shortcut: 'Ctrl+P',
        category: 'View',
        action: onTogglePreview,
        keywords: ['preview', 'panel', 'show']
      })
    }
    
    if (onToggleDualPane) {
      items.push({
        id: 'toggle-dual-pane',
        title: 'Toggle Dual Pane',
        description: 'Show/hide split view',
        icon: Columns2,
        category: 'View',
        action: onToggleDualPane,
        keywords: ['split', 'dual', 'columns']
      })
    }
    
    if (onToggleFilters) {
      items.push({
        id: 'toggle-filters',
        title: 'Toggle Filter Bar',
        description: 'Show/hide file filters',
        icon: Layers,
        category: 'View',
        action: onToggleFilters,
        keywords: ['filter', 'status', 'type']
      })
    }
    
    // Tools
    if (onShowNotes) {
      items.push({
        id: 'notes',
        title: 'Quick Notes',
        description: 'Open notes panel',
        icon: StickyNote,
        category: 'Tools',
        action: onShowNotes,
        keywords: ['note', 'comment', 'memo']
      })
    }
    
    if (onShowShortcuts) {
      items.push({
        id: 'shortcuts',
        title: 'Keyboard Shortcuts',
        description: 'View all keyboard shortcuts',
        icon: Keyboard,
        shortcut: '?',
        category: 'Help',
        action: onShowShortcuts,
        keywords: ['help', 'keys', 'bindings']
      })
    }
    
    if (onOpenSettings) {
      items.push({
        id: 'settings',
        title: 'Open Settings',
        description: 'Configure application preferences',
        icon: Settings,
        shortcut: 'Ctrl+,',
        category: 'Tools',
        action: onOpenSettings,
        keywords: ['preferences', 'config', 'options']
      })
    }
    
    return items
  }, [
    onCommit, onUpdate, onRevert, onShowLog, onRefresh,
    onOpenSettings, onTogglePreview, onToggleDualPane, onToggleFilters,
    onShowShortcuts, onShowNotes, onQuickCommit, onAddBookmark, onGoToPath,
    currentPath, recentPaths, bookmarks
  ])
  
  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands
    
    const lowerQuery = query.toLowerCase()
    return commands.filter(cmd => {
      const titleMatch = cmd.title.toLowerCase().includes(lowerQuery)
      const descMatch = cmd.description?.toLowerCase().includes(lowerQuery)
      const categoryMatch = cmd.category.toLowerCase().includes(lowerQuery)
      const keywordMatch = cmd.keywords?.some(k => k.includes(lowerQuery))
      
      return titleMatch || descMatch || categoryMatch || keywordMatch
    })
  }, [commands, query])
  
  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])
  
  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])
  
  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = filteredCommands[selectedIndex]
        if (selected) {
          selected.action()
          onClose()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredCommands, selectedIndex, onClose])
  
  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])
  
  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index)
  }, [])
  
  const handleExecute = useCallback((cmd: CommandItem) => {
    cmd.action()
    onClose()
  }, [onClose])
  
  if (!isOpen) return null
  
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      
      {/* Palette */}
      <div className="relative w-[600px] max-w-[90vw] bg-bg-secondary border border-border rounded-xl shadow-2xl animate-scale-in overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Command className="w-5 h-5 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-text placeholder:text-text-muted outline-none text-sm"
          />
          <kbd className="px-2 py-0.5 bg-bg-tertiary rounded text-xs text-text-muted">esc</kbd>
        </div>
        
        {/* Results */}
        <div 
          ref={listRef}
          className="max-h-[400px] overflow-auto py-2"
        >
          {filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="w-8 h-8 text-text-muted mb-2" />
              <p className="text-sm text-text-secondary">No commands found</p>
            </div>
          ) : (
            filteredCommands.map((cmd, index) => {
              const Icon = cmd.icon
              const isSelected = index === selectedIndex
              
              return (
                <div
                  key={cmd.id}
                  onClick={() => handleExecute(cmd)}
                  onMouseEnter={() => handleSelect(index)}
                  className={`
                    flex items-center gap-3 px-4 py-3 cursor-pointer transition-fast
                    ${isSelected ? 'bg-accent/10' : 'hover:bg-bg-tertiary'}
                  `}
                >
                  <div className={`
                    flex items-center justify-center w-8 h-8 rounded-lg
                    ${isSelected ? 'bg-accent/20 text-accent' : 'bg-bg-tertiary text-text-muted'}
                  `}>
                    <Icon className="w-4 h-4" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isSelected ? 'text-accent' : 'text-text'}`}>
                        {cmd.title}
                      </span>
                      {cmd.shortcut && (
                        <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded text-xs text-text-muted">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </div>
                    {cmd.description && (
                      <p className="text-xs text-text-muted truncate mt-0.5">
                        {cmd.description}
                      </p>
                    )}
                  </div>
                  
                  <span className="text-xs text-text-muted px-2 py-0.5 bg-bg-tertiary rounded">
                    {cmd.category}
                  </span>
                </div>
              )
            })
          )}
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-bg-tertiary border-t border-border text-xs text-text-muted">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="px-1 bg-bg-elevated rounded">↑</kbd>
              <kbd className="px-1 bg-bg-elevated rounded ml-1">↓</kbd>
              to navigate
            </span>
            <span>
              <kbd className="px-1 bg-bg-elevated rounded">Enter</kbd>
              to select
            </span>
          </div>
          <span>{filteredCommands.length} commands</span>
        </div>
      </div>
    </div>
  )
}
