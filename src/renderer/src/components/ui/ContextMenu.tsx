import { 
  useEffect, 
  useRef, 
  useState,
  useCallback 
} from 'react'
import { 
  Download, 
  Upload, 
  Undo2, 
  Plus, 
  Trash2,
  FileText,
  FolderOpen,
  Copy,
  RotateCcw,
  History,
  ExternalLink,
  Lock,
  Unlock,
  GitBranch,
  RefreshCw,
  Settings,
  Eye,
  User,
  GitMerge,
  ArrowRightLeft,
  Wrench,
  FileCode,
  Layers,
  ClipboardList
} from 'lucide-react'
import type { SvnStatusChar } from '@shared/types'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  divider?: boolean
  onClick?: () => void
  submenu?: ContextMenuItem[]
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number }
  onClose: () => void
  className?: string
}

export function ContextMenu({ 
  items, 
  position, 
  onClose,
  className = '' 
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null)
  
  // Adjust position to stay within viewport
  const [adjustedPosition, setAdjustedPosition] = useState(position)
  
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      let x = position.x
      let y = position.y
      
      if (x + rect.width > viewportWidth - 16) {
        x = viewportWidth - rect.width - 16
      }
      if (y + rect.height > viewportHeight - 16) {
        y = viewportHeight - rect.height - 16
      }
      
      setAdjustedPosition({ x, y })
    }
  }, [position])
  
  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  
  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div 
      ref={menuRef}
      className={`context-menu ${className}`}
      style={{ 
        left: adjustedPosition.x, 
        top: adjustedPosition.y 
      }}
    >
      {items.map((item, index) => {
        if (item.divider) {
          return <div key={`divider-${index}`} className="context-menu-divider" />
        }
        
        const Icon = item.icon
        const hasSubmenu = item.submenu && item.submenu.length > 0
        
        return (
          <div 
            key={item.id}
            className="relative"
            onMouseEnter={() => hasSubmenu && setSubmenuOpen(item.id)}
            onMouseLeave={() => hasSubmenu && setSubmenuOpen(null)}
          >
            <button
              onClick={() => {
                if (!item.disabled && item.onClick) {
                  item.onClick()
                  onClose()
                }
              }}
              disabled={item.disabled}
              className={`
                context-menu-item w-full
                ${item.danger ? 'context-menu-item-danger' : ''}
                ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
              <span className="flex-1 text-left">{item.label}</span>
              {item.shortcut && (
                <span className="text-xs text-text-faint ml-4">{item.shortcut}</span>
              )}
              {hasSubmenu && (
                <ExternalLink className="w-3 h-3 rotate-90" />
              )}
            </button>
            
            {/* Submenu */}
            {hasSubmenu && submenuOpen === item.id && (
              <div className="absolute left-full top-0 ml-1">
                <div className="context-menu">
                  {item.submenu!.map((subItem) => {
                    const SubIcon = subItem.icon
                    return (
                      <button
                        key={subItem.id}
                        onClick={() => {
                          if (!subItem.disabled && subItem.onClick) {
                            subItem.onClick()
                            onClose()
                          }
                        }}
                        disabled={subItem.disabled}
                        className="context-menu-item w-full"
                      >
                        {SubIcon && <SubIcon className="w-4 h-4" />}
                        <span>{subItem.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Hook for context menu
export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number }
    data?: unknown
  } | null>(null)
  
  const showContextMenu = useCallback((e: React.MouseEvent, data?: unknown) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      position: { x: e.clientX, y: e.clientY },
      data
    })
  }, [])
  
  const hideContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])
  
  return {
    contextMenu,
    showContextMenu,
    hideContextMenu
  }
}

// Predefined SVN context menu items
export function getSvnContextMenuItems(
  status: SvnStatusChar,
  isDirectory: boolean,
  actions: {
    onUpdate?: () => void
    onCommit?: () => void
    onRevert?: () => void
    onAdd?: () => void
    onDelete?: () => void
    onResolve?: () => void
    onGetLock?: () => void
    onReleaseLock?: () => void
    onShowLog?: () => void
    onDiff?: () => void
    onOpenInExplorer?: () => void
    onCopyPath?: () => void
    onPreview?: () => void
    // Extended actions
    onBlame?: () => void
    onProperties?: () => void
    onAddToIgnore?: () => void
    onBranchTag?: () => void
    onSwitch?: () => void
    onMerge?: () => void
    onExport?: () => void
    onRelocate?: () => void
    onRepoBrowser?: () => void
    onCreatePatch?: () => void
    onApplyPatch?: () => void
    onCleanup?: () => void
    onChangelist?: () => void
    onRevisionGraph?: () => void
    onCheckForModifications?: () => void
  }
): ContextMenuItem[] {
  const isVersioned = status !== '?' && status !== 'I'
  const isModified = status === 'M'
  const isConflicted = status === 'C'
  const isUnversioned = status === '?'
  const isDeleted = status === 'D'
  const isAdded = status === 'A'
  const isFile = !isDirectory
  
  const items: ContextMenuItem[] = []
  
  // === Working Copy Operations (for directories) ===
  if (isDirectory && isVersioned) {
    if (actions.onCheckForModifications) {
      items.push({
        id: 'check-mods',
        label: 'Check for Modifications...',
        icon: RefreshCw,
        onClick: actions.onCheckForModifications
      })
    }
  }
  
  // === SVN Update ===
  if (isVersioned && actions.onUpdate) {
    items.push({
      id: 'update',
      label: 'Update',
      icon: Download,
      shortcut: 'Ctrl+U',
      onClick: actions.onUpdate
    })
  }
  
  // === SVN Commit ===
  if ((isModified || isAdded || isDeleted || isUnversioned) && actions.onCommit) {
    items.push({
      id: 'commit',
      label: 'Commit...',
      icon: Upload,
      shortcut: 'Ctrl+S',
      onClick: actions.onCommit
    })
  }
  
  // === SVN Revert ===
  if ((isModified || isAdded || isDeleted) && actions.onRevert) {
    items.push({
      id: 'revert',
      label: 'Revert',
      icon: Undo2,
      shortcut: 'Ctrl+R',
      onClick: actions.onRevert
    })
  }
  
  // === SVN Resolve (for conflicts) ===
  if (isConflicted && actions.onResolve) {
    items.push({
      id: 'resolve',
      label: 'Resolve...',
      icon: RotateCcw,
      onClick: actions.onResolve
    })
  }
  
  // Divider
  if (items.length > 0) {
    items.push({ id: 'divider-1', label: '', divider: true })
  }
  
  // === SVN Add ===
  if (isUnversioned && actions.onAdd) {
    items.push({
      id: 'add',
      label: 'Add',
      icon: Plus,
      onClick: actions.onAdd
    })
  }
  
  // === Add to Ignore ===
  if (isUnversioned && actions.onAddToIgnore) {
    items.push({
      id: 'ignore',
      label: 'Add to Ignore List',
      icon: Eye,
      onClick: actions.onAddToIgnore
    })
  }
  
  // === SVN Delete ===
  if (actions.onDelete) {
    items.push({
      id: 'delete',
      label: isVersioned ? 'Delete (versioned)' : 'Delete',
      icon: Trash2,
      danger: true,
      onClick: actions.onDelete
    })
  }
  
  // === Lock/Unlock ===
  if (isVersioned && isFile) {
    if (actions.onGetLock) {
      items.push({
        id: 'lock',
        label: 'Get Lock',
        icon: Lock,
        onClick: actions.onGetLock
      })
    }
    if (actions.onReleaseLock) {
      items.push({
        id: 'unlock',
        label: 'Release Lock',
        icon: Unlock,
        onClick: actions.onReleaseLock
      })
    }
  }
  
  // === Changelist ===
  if (isVersioned && actions.onChangelist) {
    items.push({
      id: 'changelist',
      label: 'Add to Changelist...',
      icon: ClipboardList,
      onClick: actions.onChangelist
    })
  }
  
  // Divider - Branching operations
  if (isDirectory && isVersioned) {
    items.push({ id: 'divider-2', label: '', divider: true })
    
    // === Branch/Tag ===
    if (actions.onBranchTag) {
      items.push({
        id: 'branch-tag',
        label: 'Branch/Tag...',
        icon: GitBranch,
        onClick: actions.onBranchTag
      })
    }
    
    // === Switch ===
    if (actions.onSwitch) {
      items.push({
        id: 'switch',
        label: 'Switch...',
        icon: ArrowRightLeft,
        onClick: actions.onSwitch
      })
    }
    
    // === Merge ===
    if (actions.onMerge) {
      items.push({
        id: 'merge',
        label: 'Merge...',
        icon: GitMerge,
        onClick: actions.onMerge
      })
    }
  }
  
  // Divider - Info operations
  items.push({ id: 'divider-3', label: '', divider: true })
  
  // === Show Log ===
  if (isVersioned && actions.onShowLog) {
    items.push({
      id: 'show-log',
      label: 'Show Log',
      icon: History,
      onClick: actions.onShowLog
    })
  }
  
  // === Revision Graph ===
  if (isVersioned && actions.onRevisionGraph) {
    items.push({
      id: 'revision-graph',
      label: 'Revision Graph',
      icon: GitBranch,
      onClick: actions.onRevisionGraph
    })
  }
  
  // === Diff ===
  if (isModified && isFile && actions.onDiff) {
    items.push({
      id: 'diff',
      label: 'Diff',
      icon: FileText,
      shortcut: 'Ctrl+D',
      onClick: actions.onDiff
    })
  }
  
  // === Preview ===
  if (isFile && actions.onPreview) {
    items.push({
      id: 'preview',
      label: 'Preview',
      icon: Eye,
      shortcut: 'Ctrl+P',
      onClick: actions.onPreview
    })
  }
  
  // === Blame ===
  if (isVersioned && isFile && actions.onBlame) {
    items.push({
      id: 'blame',
      label: 'Blame...',
      icon: User,
      onClick: actions.onBlame
    })
  }
  
  // === Properties ===
  if (isVersioned && actions.onProperties) {
    items.push({
      id: 'properties',
      label: 'Properties',
      icon: Settings,
      onClick: actions.onProperties
    })
  }
  
  // Divider - Patch operations
  if (isDirectory && isVersioned) {
    items.push({ id: 'divider-4', label: '', divider: true })
    
    // === Create Patch ===
    if (actions.onCreatePatch) {
      items.push({
        id: 'create-patch',
        label: 'Create Patch...',
        icon: FileCode,
        onClick: actions.onCreatePatch
      })
    }
    
    // === Apply Patch ===
    if (actions.onApplyPatch) {
      items.push({
        id: 'apply-patch',
        label: 'Apply Patch...',
        icon: Layers,
        onClick: actions.onApplyPatch
      })
    }
  }
  
  // Divider - Repository operations
  if (isDirectory && isVersioned) {
    items.push({ id: 'divider-5', label: '', divider: true })
    
    // === Repo Browser ===
    if (actions.onRepoBrowser) {
      items.push({
        id: 'repo-browser',
        label: 'Repo Browser',
        icon: FolderOpen,
        onClick: actions.onRepoBrowser
      })
    }
    
    // === Export ===
    if (actions.onExport) {
      items.push({
        id: 'export',
        label: 'Export...',
        icon: Download,
        onClick: actions.onExport
      })
    }
    
    // === Relocate ===
    if (actions.onRelocate) {
      items.push({
        id: 'relocate',
        label: 'Relocate...',
        icon: ArrowRightLeft,
        onClick: actions.onRelocate
      })
    }
    
    // === Cleanup ===
    if (actions.onCleanup) {
      items.push({
        id: 'cleanup',
        label: 'Cleanup...',
        icon: Wrench,
        onClick: actions.onCleanup
      })
    }
  }
  
  // Divider - System operations
  items.push({ id: 'divider-6', label: '', divider: true })
  
  // === Open in Explorer/Finder ===
  if (actions.onOpenInExplorer) {
    items.push({
      id: 'open-in-explorer',
      label: 'Open in Explorer',
      icon: FolderOpen,
      onClick: actions.onOpenInExplorer
    })
  }
  
  // === Copy Path ===
  if (actions.onCopyPath) {
    items.push({
      id: 'copy-path',
      label: 'Copy Path',
      icon: Copy,
      shortcut: 'Ctrl+Shift+C',
      onClick: actions.onCopyPath
    })
  }
  
  return items
}
