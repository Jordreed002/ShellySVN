import { useSearch, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import { RefreshCw, FolderX, AlertCircle, Inbox, Loader, ArrowUp } from 'lucide-react'
import type { FileInfo, SvnStatusEntry, SvnStatusChar, FsStatusResult } from '@shared/types'
import { Breadcrumb } from './ui/Breadcrumb'
import { Toolbar } from './ui/Toolbar'
import { FileRow, FileListHeader } from './ui/FileRow'
import { FilterBar, useFileFilters } from './ui/FilterBar'
import { useDualPane } from './ui/DualPaneView'
import { FilePreview } from './ui/FilePreview'
import { CommitDialog } from './ui/CommitDialog'
import { DiffViewer } from './ui/DiffViewer'
import { LogViewer } from './ui/LogViewer'
import { SettingsDialog } from './ui/SettingsDialog'
import { useFileExplorerActions } from '../hooks/useSvnActions'
import { useSettings } from '../hooks/useSettings'

// Cache configuration
const FILE_CACHE_TIME = 5 * 60 * 1000      // 5 minutes - files rarely change
const STATUS_STALE_TIME = 30 * 1000        // 30 seconds - status can change externally  
const DEEP_STATUS_STALE_TIME = 2 * 60 * 1000 // 2 minutes - expensive to compute

// Convert FileInfo to SvnStatusEntry for FileRow compatibility
function fileInfoToEntry(file: FileInfo): SvnStatusEntry {
  return {
    path: file.path,
    status: file.svnStatus?.status || ' ',
    revision: file.svnStatus?.revision,
    author: file.svnStatus?.author,
    date: file.svnStatus?.date,
    isDirectory: file.isDirectory
  }
}

// Apply deep status to files
function applyDeepStatus(files: FileInfo[], deepStatus: FsStatusResult): FileInfo[] {
  const statusPriority: Record<string, number> = {
    'C': 100, '!': 90, '~': 85, 'M': 80, 'D': 70, 'R': 60, 'A': 50, 'X': 40, '?': 30, 'I': 20, ' ': 0
  }
  
  return files.map(file => {
    if (file.isDirectory) {
      let worstStatus: SvnStatusChar = ' '
      for (const entry of deepStatus.allEntries) {
        if (entry.fullPath.startsWith(file.path + '\\') || 
            entry.fullPath.startsWith(file.path + '/')) {
          if (statusPriority[entry.status] > statusPriority[worstStatus]) {
            worstStatus = entry.status
          }
        }
      }
      if (worstStatus !== ' ') {
        return { ...file, svnStatus: { path: file.path, status: worstStatus as SvnStatusChar, isDirectory: true } }
      }
    }
    return file
  })
}

// Hook to invalidate SVN status caches after actions
export function useInvalidateStatus() {
  const queryClient = useQueryClient()
  
  return useCallback((path: string) => {
    // Invalidate status for this path and all parent paths
    queryClient.invalidateQueries({ queryKey: ['fs:getStatus', path] })
    queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', path] })
    
    // Invalidate file listing (in case files were added/deleted)
    queryClient.invalidateQueries({ queryKey: ['fs:listDirectory', path] })
    
    // Invalidate parent directories too (folder aggregation changes)
    const parts = path.split(/[/\\]/)
    for (let i = parts.length - 1; i > 0; i--) {
      const parentPath = parts.slice(0, i).join(path.includes('\\') ? '\\' : '/')
      if (parentPath) {
        queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', parentPath] })
      }
    }
  }, [queryClient])
}

export function FileExplorer() {
  const { path } = useSearch({ from: '/files/' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const parentRef = useRef<HTMLDivElement>(null)
  const { settings, addRecentPath, addBookmark, removeBookmark } = useSettings()
  
  // Track recent paths on navigation
  useEffect(() => {
    if (path && path !== 'DRIVES://') {
      addRecentPath(path)
    }
  }, [path, addRecentPath])
  
  // Check if current path is bookmarked
  const isBookmarked = settings.bookmarks?.some(b => b.path === path) ?? false
  
  const handleToggleBookmark = useCallback(() => {
    if (!path || path === 'DRIVES://') return
    if (isBookmarked) {
      removeBookmark(path)
    } else {
      const name = path.split(/[/\\]/).pop() || path
      addBookmark(path, name)
    }
  }, [path, isBookmarked, addBookmark, removeBookmark])
  
  // Multi-select state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [diffViewerPath, setDiffViewerPath] = useState<string | null>(null)
  const [logViewerPath, setLogViewerPath] = useState<string | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  
  // Preview state
  const [showPreview, setShowPreview] = useState(false)
  
  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [showFilters, setShowFilters] = useState(true)
  
  // Column width state
  const [columnWidths, setColumnWidths] = useState({
    name: 300,
    status: 80,
    revision: 70,
    author: 100,
    date: 100,
    size: 80
  })
  
  const handleColumnWidthChange = useCallback((column: string, width: number) => {
    setColumnWidths(prev => ({ ...prev, [column]: width }))
  }, [])
  
  // Dual-pane state
  const { isDualPane, toggleDualPane } = useDualPane(path || '')
  
  // Phase 1: Fetch files immediately from filesystem (instant, cached for 5 min)
  const { data: rawFiles, isLoading: isLoadingFiles, error, refetch } = useQuery({
    queryKey: ['fs:listDirectory', path],
    queryFn: () => window.api.fs.listDirectory(path),
    enabled: !!path,
    staleTime: FILE_CACHE_TIME,
    gcTime: FILE_CACHE_TIME
  })
  
  // Check if current directory is versioned (for SVN features)
  const { data: isVersioned } = useQuery({
    queryKey: ['fs:isVersioned', path],
    queryFn: () => window.api.fs.isVersioned(path),
    enabled: !!path && path !== 'DRIVES://',
    staleTime: FILE_CACHE_TIME
  })
  
  // Get parent path for up navigation
  const { data: parentPath } = useQuery({
    queryKey: ['fs:getParent', path],
    queryFn: () => window.api.fs.getParent(path),
    enabled: !!path,
    staleTime: Infinity
  })
  
  // Phase 2: Get shallow SVN status (cached for 30 sec) - only if versioned
  const { data: statusData, isFetching: isLoadingStatus } = useQuery({
    queryKey: ['fs:getStatus', path],
    queryFn: () => window.api.fs.getStatus(path),
    enabled: !!path && path !== 'DRIVES://' && isVersioned === true && !!rawFiles,
    staleTime: STATUS_STALE_TIME
  })
  
  // Phase 3: Get deep status for folder aggregation (cached for 2 min, background) - only if versioned
  const { data: deepStatusData, isFetching: isLoadingDeep } = useQuery({
    queryKey: ['fs:getDeepStatus', path],
    queryFn: () => window.api.fs.getDeepStatus(path),
    enabled: !!path && path !== 'DRIVES://' && isVersioned === true && !!rawFiles,
    staleTime: DEEP_STATUS_STALE_TIME,
    refetchOnWindowFocus: false
  })
  
  // Apply status to files (shallow first, then deep)
  const files = useMemo(() => {
    if (!rawFiles) return []
    
    let result = rawFiles
    
    if (statusData) {
      result = result.map(file => {
        const directStatus = statusData.directStatus[file.name]
        if (directStatus) {
          return {
            ...file,
            svnStatus: {
              path: file.path,
              status: directStatus.status,
              revision: directStatus.revision,
              author: directStatus.author,
              isDirectory: file.isDirectory
            }
          }
        }
        return file
      })
    }
    
    if (deepStatusData) {
      result = applyDeepStatus(result, deepStatusData)
    }
    
    return result
  }, [rawFiles, statusData, deepStatusData])
  
  // Convert to entries for virtualizer
  const entries = useMemo(() => {
    return (files || []).map(fileInfoToEntry)
  }, [files])
  
  // Use filter hook for type/status filtering
  const { filteredEntries: typeFilteredEntries, fileTypeFilter, setFileTypeFilter, statusFilter, setStatusFilter, hasActiveFilters } = useFileFilters(entries)
  
  // Apply search and sorting
  const filteredEntries = useMemo(() => {
    let result = typeFilteredEntries
    
    // Apply global ignore patterns from settings
    if (settings?.globalIgnorePatterns && settings.globalIgnorePatterns.length > 0) {
      const ignoreRegexes = settings.globalIgnorePatterns.map(pattern => {
        // Convert glob pattern to regex
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
          .replace(/\//g, '[/\\\\]')
        return new RegExp(regexPattern, 'i')
      })
      
      result = result.filter(entry => {
        const filename = entry.path.split(/[/\\]/).pop() || ''
        // Don't filter directories, only files
        if (entry.isDirectory) return true
        return !ignoreRegexes.some(regex => regex.test(filename))
      })
    }
    
    // Apply search filter
    if (searchQuery) {
      result = result.filter(entry => 
        entry.path.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }
    
    // Apply sorting
    result = [...result].sort((a, b) => {
      // Always sort folders first
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      
      let comparison = 0
      switch (sortColumn) {
        case 'name': {
          const aName = a.path.split(/[/\\]/).pop() || ''
          const bName = b.path.split(/[/\\]/).pop() || ''
          comparison = aName.localeCompare(bName)
          break
        }
        case 'status':
          comparison = (a.status || ' ').localeCompare(b.status || ' ')
          break
        case 'revision':
          comparison = (a.revision || 0) - (b.revision || 0)
          break
        case 'author':
          comparison = (a.author || '').localeCompare(b.author || '')
          break
        case 'date':
          comparison = (a.date || '').localeCompare(b.date || '')
          break
        default:
          comparison = 0
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
    
    return result
  }, [typeFilteredEntries, searchQuery, sortColumn, sortDirection, settings?.globalIgnorePatterns])
  
  // Sort handler
  const handleSort = useCallback((column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }, [sortColumn])
  
  // SVN Actions - get first selected entry for single-file actions
  const selectedEntry = useMemo(() => {
    const firstSelected = Array.from(selectedPaths)[0]
    if (!firstSelected) return null
    return filteredEntries.find(e => e.path === firstSelected) || null
  }, [selectedPaths, filteredEntries])
  
  const actions = useFileExplorerActions(path || '', selectedEntry, () => {
    queryClient.invalidateQueries({ queryKey: ['fs:listDirectory', path] })
    queryClient.invalidateQueries({ queryKey: ['fs:getStatus', path] })
    queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', path] })
  }, selectedPaths)
  
  // Virtualizer
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 15
  })
  
  const handleNavigate = useCallback((newPath: string) => {
    navigate({ to: '/files', search: { path: newPath } })
  }, [navigate])
  
  // Multi-select handler - supports Ctrl, Shift, and normal clicks
  const handleSelect = useCallback((entry: SvnStatusEntry, event?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
    const entryIndex = filteredEntries.findIndex(e => e.path === entry.path)
    
    // Shift+click: range selection
    if (event?.shiftKey && lastSelectedIndex >= 0) {
      const start = Math.min(lastSelectedIndex, entryIndex)
      const end = Math.max(lastSelectedIndex, entryIndex)
      const rangePaths = new Set<string>()
      for (let i = start; i <= end; i++) {
        rangePaths.add(filteredEntries[i].path)
      }
      setSelectedPaths(rangePaths)
      setFocusedIndex(entryIndex)
      return
    }
    
    // Ctrl+click: toggle selection
    if (event?.ctrlKey || event?.metaKey) {
      setSelectedPaths(prev => {
        const next = new Set(prev)
        if (next.has(entry.path)) {
          next.delete(entry.path)
        } else {
          next.add(entry.path)
        }
        return next
      })
      setLastSelectedIndex(entryIndex)
      setFocusedIndex(entryIndex)
      return
    }
    
    // Normal click: single selection
    setSelectedPaths(new Set([entry.path]))
    setLastSelectedIndex(entryIndex)
    setFocusedIndex(entryIndex)
  }, [filteredEntries, lastSelectedIndex])
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (diffViewerPath || logViewerPath || actions.commitDialogOpen) return
      
      // Handle navigation keys
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        
        const direction = e.key === 'ArrowDown' ? 1 : -1
        let newIndex = focusedIndex
        
        if (focusedIndex < 0) {
          newIndex = direction === 1 ? 0 : filteredEntries.length - 1
        } else {
          newIndex = Math.max(0, Math.min(filteredEntries.length - 1, focusedIndex + direction))
        }
        
        // Shift+Arrow: extend selection
        if (e.shiftKey) {
          setSelectedPaths(prev => {
            const next = new Set(prev)
            next.add(filteredEntries[newIndex].path)
            return next
          })
        } else {
          setSelectedPaths(new Set([filteredEntries[newIndex].path]))
          setLastSelectedIndex(newIndex)
        }
        
        setFocusedIndex(newIndex)
        
        // Scroll into view
        virtualizer.scrollToIndex(newIndex, { align: 'auto' })
      }
      
      // Ctrl+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedPaths(new Set(filteredEntries.map(e => e.path)))
      }
      
      // Escape: clear selection
      if (e.key === 'Escape') {
        setSelectedPaths(new Set())
        setFocusedIndex(-1)
      }
      
      // Enter: open folder
      if (e.key === 'Enter' && focusedIndex >= 0) {
        const entry = filteredEntries[focusedIndex]
        if (entry.isDirectory) {
          handleNavigateToEntry(entry)
        }
      }
      
      // Delete: delete selected
      if (e.key === 'Delete' && selectedPaths.size > 0) {
        e.preventDefault()
        // Will implement with actions
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedIndex, filteredEntries, virtualizer, selectedPaths, diffViewerPath, logViewerPath, actions.commitDialogOpen])
  
  // Clear selection when path changes
  useEffect(() => {
    setSelectedPaths(new Set())
    setFocusedIndex(-1)
    setLastSelectedIndex(-1)
  }, [path])
  
  const handleNavigateToEntry = useCallback((entry: SvnStatusEntry) => {
    if (entry.isDirectory) {
      navigate({ to: '/files', search: { path: entry.path } })
    }
  }, [navigate])
  
  // FileRow actions - works with multi-select
  const fileRowActions = useMemo(() => ({
    onUpdate: async () => {
      if (selectedEntry) await actions.handleUpdate()
    },
    onCommit: () => {
      // Commit all selected paths
      const paths = Array.from(selectedPaths)
      if (paths.length > 0) {
        // Open commit dialog with all selected paths
        // For now, use single selection
        actions.handleCommitSelected()
      }
    },
    onRevert: async () => {
      // Revert all selected
      const paths = Array.from(selectedPaths)
      if (paths.length > 0) {
        // Actions now supports batch operations
        await actions.handleRevertSelected()
      }
    },
    onAdd: async () => {
      if (selectedEntry) await actions.handleAddSelected()
    },
    onDelete: async () => {
      if (selectedEntry) await actions.handleDeleteSelected()
    },
    onShowLog: (entry: SvnStatusEntry) => setLogViewerPath(entry.path),
    onDiff: (entry: SvnStatusEntry) => setDiffViewerPath(entry.path),
    onOpenInExplorer: (entry: SvnStatusEntry) => {
      const separator = entry.path.includes('\\') ? '\\' : '/'
      const lastSep = entry.path.lastIndexOf(separator)
      const parentDir = lastSep > 0 ? entry.path.substring(0, lastSep) : entry.path
      window.api.app.openExternal(parentDir)
    },
    onCopyPath: (entry: SvnStatusEntry) => {
      const paths = selectedPaths.size > 1 
        ? Array.from(selectedPaths).join('\n')
        : entry.path
      navigator.clipboard.writeText(paths)
    },
    onPreview: (entry: SvnStatusEntry) => {
      if (!entry.isDirectory) {
        setShowPreview(true)
      }
    }
  }), [selectedEntry, selectedPaths, actions])
  
  const hasChanges = entries.some(e => 
    ['M', 'A', 'D', 'C'].includes(e.status)
  )
  
  const isLoading = isLoadingFiles
  const isFetching = isLoadingStatus || isLoadingDeep || actions.isUpdating

  // Empty state - show when no path is set
  if (!path) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-4">
          <FolderX className="w-8 h-8 text-text-muted" />
        </div>
        <h3 className="text-lg font-medium text-text mb-2">Select a Location</h3>
        <p className="text-sm text-text-secondary max-w-sm">
          Choose a folder from the sidebar to browse files
        </p>
      </div>
    )
  }
  
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-[--toolbar-height] bg-bg-secondary border-b border-border animate-pulse" />
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="w-6 h-6 text-text-muted animate-spin" />
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-[--toolbar-height] bg-bg-secondary border-b border-border" />
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 rounded-2xl bg-error/10 flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-error" />
          </div>
          <h3 className="text-lg font-medium text-text mb-2">Error Loading Directory</h3>
          <p className="text-sm text-text-secondary max-w-sm mb-4">
            {(error as Error).message}
          </p>
          <button
            onClick={() => refetch()}
            className="btn btn-secondary"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Breadcrumb Header */}
        <div className="h-[--header-height] flex items-center px-4 bg-bg-secondary border-b border-border">
          {/* Up navigation button */}
          {parentPath && (
            <button
              onClick={() => handleNavigate(parentPath)}
              className="btn-icon-sm mr-2"
              title="Go to parent directory"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
          <Breadcrumb path={path} onNavigate={handleNavigate} />
          {isFetching && (
            <span title="Loading status...">
              <Loader className="w-4 h-4 text-accent animate-spin ml-2" />
            </span>
          )}
        </div>
        
        {/* Toolbar */}
        <Toolbar
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['fs:listDirectory', path] })
          queryClient.invalidateQueries({ queryKey: ['fs:getStatus', path] })
          queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', path] })
          queryClient.invalidateQueries({ queryKey: ['fs:isVersioned', path] })
        }}
        onUpdate={actions.handleUpdate}
        onCommit={actions.handleCommit}
        onRevert={actions.handleRevertSelected}
        onAdd={actions.handleAddSelected}
        onDelete={actions.handleDeleteSelected}
        isUpdating={isFetching}
        hasChanges={hasChanges}
        hasSelection={selectedPaths.size > 0}
        isVersioned={isVersioned === true}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(prev => !prev)}
        hasActiveFilters={hasActiveFilters}
        isDualPane={isDualPane}
        onToggleDualPane={toggleDualPane}
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview(prev => !prev)}
        hasSelectionForPreview={selectedEntry !== null && !selectedEntry.isDirectory}
        isBookmarked={isBookmarked}
        onToggleBookmark={handleToggleBookmark}
        onSettings={() => setSettingsDialogOpen(true)}
      />
      
      {/* Filter Bar */}
      {showFilters && (
        <FilterBar
          activeFileType={fileTypeFilter}
          activeStatus={statusFilter}
          onFileTypeChange={setFileTypeFilter}
          onStatusChange={setStatusFilter}
          fileCount={{ total: entries.length, filtered: filteredEntries.length }}
        />
      )}
      
      {/* File List Header */}
      <FileListHeader
        columnWidths={columnWidths}
        onColumnWidthChange={handleColumnWidthChange}
        onSort={handleSort}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
      />
      
      {/* File list */}
      <div 
        ref={parentRef} 
        className={`scrollbar-overlay ${settings.fileListHeight === 'fill' ? 'flex-1 overflow-auto' : 'flex-none overflow-auto'}`}
        style={settings.fileListHeight === 'auto' ? { maxHeight: 'calc(100vh - 200px)' } : undefined}
      >
        {filteredEntries.length === 0 ? (
          <div className="empty-state">
            <Inbox className="empty-state-icon" />
            <h3 className="empty-state-title">
              {hasActiveFilters ? 'No Matching Files' : searchQuery ? 'No matching files' : 'Empty Directory'}
            </h3>
            <p className="empty-state-description">
              {hasActiveFilters 
                ? 'No files match the current filters. Try adjusting your filter settings.'
                : searchQuery 
                  ? `No files matching "${searchQuery}"`
                  : 'This directory contains no files'
              }
            </p>
            {hasActiveFilters && (
              <button 
                className="btn btn-secondary btn-sm mt-4"
                onClick={() => {
                  setFileTypeFilter('all')
                  setStatusFilter('all')
                }}
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div
            style={{
              height: settings.fileListHeight === 'fill' 
                ? `${virtualizer.getTotalSize()}px`
                : 'auto',
              minHeight: settings.fileListHeight === 'auto' 
                ? `${virtualizer.getTotalSize()}px`
                : undefined,
              position: settings.fileListHeight === 'fill' ? 'relative' : undefined
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index]
              return (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  isSelected={selectedPaths.has(entry.path)}
                  onSelect={handleSelect}
                  onNavigate={handleNavigateToEntry}
                  actions={fileRowActions}
                  columnWidths={columnWidths}
                  compact={settings.compactFileRows}
                  showThumbnails={settings.showThumbnails}
                  style={settings.fileListHeight === 'fill' ? {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  } : undefined}
                />
              )
            })}
          </div>
        )}
      </div>
      
      {/* Status Bar */}
      <div className="status-bar">
        <div className="flex items-center gap-4">
          <span>{filteredEntries.length} items</span>
          {selectedPaths.size > 0 && (
            <span className="text-accent">
              {selectedPaths.size} selected
            </span>
          )}
          {hasChanges && (
            <span className="text-svn-modified">
              {entries.filter(e => e.status === 'M').length || 0} modified
            </span>
          )}
          {isLoadingDeep && (
            <span className="text-accent">Calculating folder status...</span>
          )}
        </div>
        <span className="text-text-faint">
          {path}
        </span>
      </div>
      </div>
      
      {/* Preview Sidebar - VS Code style right panel */}
      <FilePreview
        filePath={showPreview && selectedEntry && !selectedEntry.isDirectory ? selectedEntry.path : null}
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
      />
      
      {/* Commit Dialog */}
      <CommitDialog
        isOpen={actions.commitDialogOpen}
        workingCopyPath={path || ''}
        onClose={actions.closeCommitDialog}
        onSubmit={actions.handleSubmitCommit}
      />
      
      {/* Diff Viewer */}
      {diffViewerPath && (
        <DiffViewer
          isOpen={!!diffViewerPath}
          filePath={diffViewerPath}
          onClose={() => setDiffViewerPath(null)}
        />
      )}
      
      {/* Log Viewer */}
      {logViewerPath && (
        <LogViewer
          isOpen={!!logViewerPath}
          path={logViewerPath}
          onClose={() => setLogViewerPath(null)}
        />
      )}
      
      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />
    </div>
  )
}
