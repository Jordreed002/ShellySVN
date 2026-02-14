import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useSettings } from '@renderer/hooks/useSettings'
import { useQuery } from '@tanstack/react-query'
import { 
  Folder, 
  History, 
  Settings, 
  ChevronRight, 
  ChevronDown,
  Plus,
  MoreHorizontal,
  Search,
  RefreshCw,
  GitBranch,
  Home,
  HardDrive,
  FileText,
  Monitor,
  Trash2,
  ExternalLink,
  Key,
  Loader2,
  Bookmark
} from 'lucide-react'
import { AddRepoModal } from './AddRepoModal'
import { StatusDot } from './ui/StatusIcon'
import { SettingsDialog } from './ui/SettingsDialog'
import { BookmarksManager } from './ui/BookmarksManager'

interface QuickAccessItem {
  name: string
  path: string
  icon: React.ComponentType<{ className?: string }>
}

interface TreeEntry {
  name: string
  path: string
  isDirectory: boolean
}

// Tree item component that loads children on expand
function RepoTreeItem({ 
  path, 
  depth = 0,
  currentPath 
}: { 
  path: string
  depth?: number
  currentPath: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  const { data: entries, isLoading } = useQuery({
    queryKey: ['sidebar:tree', path],
    queryFn: async (): Promise<TreeEntry[]> => {
      const files = await window.api.fs.listDirectory(path)
      // Only show directories in the tree
      return files
        .filter(f => f.isDirectory)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(f => ({
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory
        }))
    },
    enabled: isExpanded
  })
  
  const isActive = currentPath === path
  const name = path.split(/[/\\]/).pop() || path
  
  return (
    <>
      <div 
        className={`
          flex items-center gap-1 px-2 py-1 cursor-pointer transition-fast
          ${isActive ? 'bg-accent/10' : 'hover:bg-bg-tertiary'}
        `}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-0.5 hover:bg-bg-elevated rounded transition-fast"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-text-muted" />
          ) : (
            <ChevronRight className="w-3 h-3 text-text-muted" />
          )}
        </button>
        <Link
          to="/files"
          search={{ path }}
          className="flex items-center gap-1.5 min-w-0 flex-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Folder className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          <span className={`truncate text-xs ${isActive ? 'text-accent font-medium' : 'text-text-secondary'}`}>
            {name}
          </span>
        </Link>
      </div>
      
      {isExpanded && (
        <div className="border-l border-border ml-4">
          {isLoading ? (
            <div className="px-3 py-1">
              <Loader2 className="w-3 h-3 animate-spin text-text-muted" />
            </div>
          ) : entries && entries.length > 0 ? (
            entries.map(entry => (
              <RepoTreeItem 
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                currentPath={currentPath}
              />
            ))
          ) : (
            <div className="px-3 py-1 text-xs text-text-muted">
              Empty
            </div>
          )}
        </div>
      )}
    </>
  )
}

export function Sidebar() {
  const { settings, addRecentRepo, removeRecentRepo, addBookmark, removeBookmark } = useSettings()
  const navigate = useNavigate()
  const routerState = useRouterState()
  
  // Safely get the path from search params
  const currentPath = (routerState.location.search as { path?: string })?.path || ''
  
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set())
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false)
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [quickAccess, setQuickAccess] = useState<QuickAccessItem[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; repo: string } | null>(null)
  const [settingsTab, setSettingsTab] = useState<string>('general')
  const [isBookmarksManagerOpen, setIsBookmarksManagerOpen] = useState(false)
  
  const recentRepos = settings?.recentRepositories || []
  const bookmarks = settings?.bookmarks || []
  
  // Load quick access locations
  useEffect(() => {
    const loadQuickAccess = async () => {
      const items: QuickAccessItem[] = []
      
      // Get common paths
      try {
        const homePath = await window.api.app.getPath('home')
        items.push({ name: 'Home', path: homePath, icon: Home })
      } catch {}
      
      try {
        const desktopPath = await window.api.app.getPath('desktop')
        items.push({ name: 'Desktop', path: desktopPath, icon: Monitor })
      } catch {}
      
      try {
        const docsPath = await window.api.app.getPath('documents')
        items.push({ name: 'Documents', path: docsPath, icon: FileText })
      } catch {}
      
      // Add drives (Windows) or root (Mac/Linux)
      if (process.platform === 'win32') {
        // On Windows, add drives
        items.push({ name: 'This PC', path: 'DRIVES://', icon: HardDrive })
      } else {
        // On Mac/Linux, add root
        items.push({ name: 'Root', path: '/', icon: HardDrive })
      }
      
      setQuickAccess(items)
    }
    
    loadQuickAccess()
  }, [])
  
  // Handler for opening a repo - saves to recent and navigates
  const handleOpenRepo = useCallback(async (path: string) => {
    await addRecentRepo(path)
    navigate({ to: '/files', search: { path } })
  }, [addRecentRepo, navigate])
  
  const toggleRepo = (path: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }
  
  const filteredRepos = searchQuery
    ? recentRepos.filter(repo => 
        repo.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : recentRepos
  
  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, repo: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, repo })
  }, [])
  
  const handleRemoveRepo = useCallback(async (repo: string) => {
    await removeRecentRepo(repo)
    setContextMenu(null)
  }, [removeRecentRepo])
  
  const handleOpenInExplorer = useCallback(async (repo: string) => {
    await window.api.external.openFolder(repo)
    setContextMenu(null)
  }, [])
  
  const handleManageCredentials = useCallback(() => {
    setSettingsTab('auth')
    setIsSettingsDialogOpen(true)
    setContextMenu(null)
  }, [])
  
  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  return (
    <>
      <aside className="w-[--sidebar-width] bg-bg-secondary border-r border-border flex flex-col overflow-hidden">
        {/* Title Bar */}
        <div className="h-[--titlebar-height] flex items-center justify-between px-4 bg-bg-tertiary border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-text">ShellySVN</span>
          </div>
          <button 
            onClick={() => setIsAddRepoModalOpen(true)}
            className="btn-icon-sm"
            title="Add Repository"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories..."
              className="w-full pl-8 pr-2 py-1.5 text-sm bg-bg-tertiary border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent transition-fast"
            />
          </div>
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto scrollbar-overlay">
          {/* Quick Access */}
          <div className="py-2">
            <div className="px-3 py-1.5 text-2xs font-semibold text-text-muted uppercase tracking-wider">
              Quick Access
            </div>
            {quickAccess.map((item) => {
              const Icon = item.icon
              const isActive = currentPath === item.path
              return (
                <Link
                  key={item.path}
                  to="/files"
                  search={{ path: item.path }}
                  className={`tree-item ${isActive ? 'tree-item-active' : ''}`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </Link>
              )
            })}
          </div>
          
          {/* Main Navigation */}
          <div className="py-2 border-t border-border">
            <div className="px-3 py-1.5 text-2xs font-semibold text-text-muted uppercase tracking-wider">
              Browse
            </div>
            <Link
              to="/files"
              search={{ path: currentPath || '/' }}
              className="tree-item"
              activeProps={{ className: 'tree-item-active' }}
            >
              <Folder className="w-4 h-4" />
              <span>File Explorer</span>
            </Link>
            <Link
              to="/history"
              search={{ path: currentPath || '/' }}
              className="tree-item"
              activeProps={{ className: 'tree-item-active' }}
            >
              <History className="w-4 h-4" />
              <span>History</span>
            </Link>
          </div>
          
          {/* Bookmarks Section */}
          {bookmarks.length > 0 && (
            <div className="border-t border-border py-2">
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-2xs font-semibold text-text-muted uppercase tracking-wider">
                  Bookmarks
                </span>
                <button 
                  onClick={() => setIsBookmarksManagerOpen(true)}
                  className="btn-icon-sm p-0.5"
                  title="Manage Bookmarks"
                >
                  <Bookmark className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-0.5">
                {bookmarks.slice(0, 5).map((bookmark) => (
                  <Link
                    key={bookmark.path}
                    to="/files"
                    search={{ path: bookmark.path }}
                    className={`tree-item ${currentPath === bookmark.path ? 'tree-item-active' : ''}`}
                  >
                    <Bookmark className="w-4 h-4" />
                    <span className="truncate">{bookmark.name}</span>
                  </Link>
                ))}
                {bookmarks.length > 5 && (
                  <button
                    onClick={() => setIsBookmarksManagerOpen(true)}
                    className="w-full text-left px-6 py-1 text-xs text-text-muted hover:text-text transition-fast"
                  >
                    +{bookmarks.length - 5} more...
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* Repositories Section */}
          <div className="border-t border-border py-2">
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wider">
                SVN Repositories
              </span>
              {recentRepos.length > 0 && (
                <button className="btn-icon-sm p-0.5">
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </div>
            
            {filteredRepos.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center mx-auto mb-2">
                  <Folder className="w-5 h-5 text-text-muted" />
                </div>
                <p className="text-xs text-text-muted mb-2">No repositories yet</p>
                <button
                  onClick={() => setIsAddRepoModalOpen(true)}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  Add your first repository
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredRepos.map((repo) => {
                  const name = repo.split('/').pop() || repo
                  const isExpanded = expandedRepos.has(repo)
                  const isActive = currentPath === repo || currentPath?.startsWith(repo + '/')
                  const isContextMenuOpen = contextMenu?.repo === repo
                  
                  return (
                    <div key={repo}>
                      {/* Repository Item */}
                      <div
                        className={`
                          flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-fast group
                          ${isActive || isContextMenuOpen ? 'bg-accent/10' : 'hover:bg-bg-tertiary'}
                        `}
                        onClick={() => toggleRepo(repo)}
                        onContextMenu={(e) => handleContextMenu(e, repo)}
                      >
                        <button className="p-0.5 hover:bg-bg-elevated rounded transition-fast">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                          )}
                        </button>
                        <StatusDot status=" " />
                        <Link
                          to="/files"
                          search={{ path: repo }}
                          className="flex-1 flex items-center gap-2 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Folder className="w-4 h-4 text-accent flex-shrink-0" />
                          <span className={`truncate text-sm ${isActive ? 'text-accent font-medium' : 'text-text-secondary'}`}>
                            {name}
                          </span>
                        </Link>
                        <button 
                          className="btn-icon-sm p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleContextMenu(e, repo)
                          }}
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      
                      {/* Expanded Children (tree view) */}
                      {isExpanded && (
                        <div className="border-l border-border ml-4">
                          <RepoTreeItem 
                            path={repo} 
                            depth={0}
                            currentPath={currentPath}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </nav>
        
        {/* Status Bar */}
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{recentRepos.length} repositor{recentRepos.length === 1 ? 'y' : 'ies'}</span>
            <button 
              onClick={() => setIsSettingsDialogOpen(true)}
              className="hover:text-text transition-fast"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
      
      {/* Add Repo Modal */}
      <AddRepoModal
        isOpen={isAddRepoModalOpen}
        onClose={() => setIsAddRepoModalOpen(false)}
        onOpenRepo={handleOpenRepo}
        onCheckout={(url, path) => {
          console.log('Checkout:', url, path)
        }}
        recentRepos={recentRepos}
      />
      
      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={isSettingsDialogOpen}
        onClose={() => setIsSettingsDialogOpen(false)}
        initialTab={settingsTab as any}
      />
      
      {/* Bookmarks Manager */}
      <BookmarksManager
        isOpen={isBookmarksManagerOpen}
        onClose={() => setIsBookmarksManagerOpen(false)}
        bookmarks={bookmarks}
        onAddBookmark={(path, name) => addBookmark(path, name)}
        onRemoveBookmark={(path) => removeBookmark(path)}
      />
      
      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-bg-secondary border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              navigate({ to: '/files', search: { path: contextMenu.repo } })
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg-tertiary transition-fast"
          >
            <Folder className="w-4 h-4" />
            Open
          </button>
          <button
            onClick={() => handleOpenInExplorer(contextMenu.repo)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg-tertiary transition-fast"
          >
            <ExternalLink className="w-4 h-4" />
            Open in Explorer
          </button>
          <div className="border-t border-border my-1" />
          <button
            onClick={handleManageCredentials}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg-tertiary transition-fast"
          >
            <Key className="w-4 h-4" />
            Manage Credentials
          </button>
          <div className="border-t border-border my-1" />
          <button
            onClick={() => handleRemoveRepo(contextMenu.repo)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-error hover:bg-error/10 transition-fast"
          >
            <Trash2 className="w-4 h-4" />
            Remove from List
          </button>
        </div>
      )}
    </>
  )
}
