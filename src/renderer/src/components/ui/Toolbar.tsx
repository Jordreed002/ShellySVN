import { 
  RefreshCw, 
  Upload, 
  Download, 
  Undo2, 
  Plus, 
  Trash2,
  Settings,
  List,
  Grid3X3,
  ChevronDown,
  Search,
  SlidersHorizontal,
  Columns2,
  Eye,
  EyeOff,
  Star,
  StarOff
} from 'lucide-react'
import { useState } from 'react'

interface ToolbarProps {
  onRefresh?: () => void
  onUpdate?: () => void
  onCommit?: () => void
  onRevert?: () => void
  onAdd?: () => void
  onDelete?: () => void
  onSettings?: () => void
  isUpdating?: boolean
  hasChanges?: boolean
  hasSelection?: boolean
  isVersioned?: boolean
  viewMode?: 'list' | 'grid'
  onViewModeChange?: (mode: 'list' | 'grid') => void
  searchQuery?: string
  onSearchChange?: (query: string) => void
  showFilters?: boolean
  onToggleFilters?: () => void
  hasActiveFilters?: boolean
  isDualPane?: boolean
  onToggleDualPane?: () => void
  showPreview?: boolean
  onTogglePreview?: () => void
  hasSelectionForPreview?: boolean
  // Bookmarks
  isBookmarked?: boolean
  onToggleBookmark?: () => void
  className?: string
}

export function Toolbar({
  onRefresh,
  onUpdate,
  onCommit,
  onRevert,
  onAdd,
  onDelete,
  onSettings,
  isUpdating = false,
  hasChanges = false,
  hasSelection = false,
  isVersioned = true,
  viewMode = 'list',
  onViewModeChange,
  searchQuery = '',
  onSearchChange,
  showFilters = true,
  onToggleFilters,
  hasActiveFilters = false,
  isDualPane = false,
  onToggleDualPane,
  showPreview = false,
  onTogglePreview,
  hasSelectionForPreview = false,
  isBookmarked = false,
  onToggleBookmark,
  className = ''
}: ToolbarProps) {
  const [showViewMenu, setShowViewMenu] = useState(false)

  return (
    <div className={`toolbar ${className}`}>
      {/* Primary Actions */}
      <div className="toolbar-group">
        <button
          onClick={onRefresh}
          disabled={isUpdating}
          className="btn-icon-sm"
          title="Refresh (F5)"
        >
          <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
        </button>
        
        {/* Bookmark Toggle */}
        {onToggleBookmark && (
          <button
            onClick={onToggleBookmark}
            className={`btn-icon-sm ${isBookmarked ? 'text-yellow-500' : ''}`}
            title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            {isBookmarked ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* SVN Actions - only show when in versioned directory */}
      {isVersioned && (
        <>
          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              onClick={onUpdate}
              disabled={isUpdating}
              className="btn btn-secondary gap-1.5"
              title="Update working copy"
            >
              <Download className="w-4 h-4" />
              <span>Update</span>
            </button>
            
            <button
              onClick={onCommit}
              disabled={!hasChanges}
              className="btn btn-primary gap-1.5"
              title="Commit changes"
            >
              <Upload className="w-4 h-4" />
              <span>Commit</span>
            </button>
          </div>

          <div className="toolbar-divider" />

          {/* Context Actions */}
          <div className="toolbar-group">
            <button
              onClick={onRevert}
              disabled={!hasSelection}
              className="btn-icon-sm"
              title="Revert selected"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            
            <button
              onClick={onAdd}
              disabled={!hasSelection}
              className="btn-icon-sm"
              title="Add to version control"
            >
              <Plus className="w-4 h-4" />
            </button>
            
            <button
              onClick={onDelete}
              disabled={!hasSelection}
              className="btn-icon-sm hover:text-error"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Filter Toggle */}
      {onToggleFilters && (
        <button
          onClick={onToggleFilters}
          className={`btn-icon-sm ${showFilters ? 'text-accent' : ''} ${hasActiveFilters ? 'bg-accent/10' : ''}`}
          title={showFilters ? 'Hide filters' : 'Show filters'}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {hasActiveFilters && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-accent rounded-full" />
          )}
        </button>
      )}

      {/* Dual Pane Toggle */}
      {onToggleDualPane && (
        <button
          onClick={onToggleDualPane}
          className={`btn-icon-sm ${isDualPane ? 'text-accent bg-accent/10' : ''}`}
          title={isDualPane ? 'Close dual pane' : 'Open dual pane view'}
        >
          <Columns2 className="w-4 h-4" />
        </button>
      )}

      {/* Preview Toggle */}
      {onTogglePreview && (
        <button
          onClick={onTogglePreview}
          disabled={!hasSelectionForPreview}
          className={`btn-icon-sm ${showPreview ? 'text-accent bg-accent/10' : ''}`}
          title={showPreview ? 'Hide preview' : 'Preview selected file'}
        >
          {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}

      {/* Search */}
      {onSearchChange && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files..."
            className="input pl-8 w-48 h-8 text-sm"
          />
        </div>
      )}

      {/* View Toggle */}
      {onViewModeChange && (
        <div className="relative">
          <button
            onClick={() => setShowViewMenu(!showViewMenu)}
            className="btn-icon-sm flex items-center gap-1"
            title="View options"
          >
            {viewMode === 'list' ? (
              <List className="w-4 h-4" />
            ) : (
              <Grid3X3 className="w-4 h-4" />
            )}
            <ChevronDown className="w-3 h-3" />
          </button>
          
          {showViewMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowViewMenu(false)} 
              />
              <div className="dropdown right-0 z-50 w-40">
                <button
                  onClick={() => {
                    onViewModeChange('list')
                    setShowViewMenu(false)
                  }}
                  className={`dropdown-item w-full ${viewMode === 'list' ? 'dropdown-item-active' : ''}`}
                >
                  <List className="w-4 h-4" />
                  <span>List View</span>
                </button>
                <button
                  onClick={() => {
                    onViewModeChange('grid')
                    setShowViewMenu(false)
                  }}
                  className={`dropdown-item w-full ${viewMode === 'grid' ? 'dropdown-item-active' : ''}`}
                >
                  <Grid3X3 className="w-4 h-4" />
                  <span>Grid View</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings */}
      {onSettings && (
        <button
          onClick={onSettings}
          className="btn-icon-sm"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// Compact toolbar for minimal space
export function ToolbarCompact({
  onRefresh,
  onUpdate,
  onCommit,
  isUpdating = false,
  hasChanges = false,
  className = ''
}: Pick<ToolbarProps, 'onRefresh' | 'onUpdate' | 'onCommit' | 'isUpdating' | 'hasChanges' | 'className'>) {
  return (
    <div className={`flex items-center gap-2 h-9 px-3 bg-bg-secondary border-b border-border ${className}`}>
      <button
        onClick={onRefresh}
        disabled={isUpdating}
        className="btn-icon-sm"
        title="Refresh"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
      </button>
      
      <button
        onClick={onUpdate}
        disabled={isUpdating}
        className="btn-icon-sm"
        title="Update"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
      
      <button
        onClick={onCommit}
        disabled={!hasChanges}
        className="btn-sm px-2 py-1 bg-accent text-white rounded text-xs font-medium disabled:opacity-50"
        title="Commit"
      >
        <Upload className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
