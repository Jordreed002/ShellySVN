import {
  RefreshCw,
  Upload,
  Download,
  Undo2,
  Plus,
  Trash2,
  List,
  Grid3X3,
  ChevronDown,
  Check,
  Search,
  SlidersHorizontal,
  Columns2,
  Eye,
  EyeOff,
  Star,
  StarOff,
  HardDrive,
  Globe,
  Cloud,
  Stethoscope,
  Wrench,
  CheckCircle2,
  Move,
  Copy,
  Pencil,
} from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';

interface ToolbarActionItem {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface ToolbarProps {
  onRefresh?: () => void;
  onUpdate?: () => void;
  onCommit?: () => void;
  onRevert?: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  onCleanup?: () => void;
  onResolve?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onRename?: () => void;
  onSettings?: () => void;
  onSettingsPreload?: () => void;
  onCommitPreload?: () => void;
  onDiagnostics?: () => void;
  isUpdating?: boolean;
  hasChanges?: boolean;
  hasSelection?: boolean;
  isVersioned?: boolean;
  viewMode?: 'list' | 'grid';
  onViewModeChange?: (mode: 'list' | 'grid') => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
  hasActiveFilters?: boolean;
  isDualPane?: boolean;
  onToggleDualPane?: () => void;
  showPreview?: boolean;
  onTogglePreview?: () => void;
  hasSelectionForPreview?: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  browseMode?: 'local' | 'online';
  onBrowseModeChange?: (mode: 'local' | 'online') => void;
  canBrowseOnline?: boolean;
  showRemoteItems?: boolean;
  onToggleRemoteItems?: () => void;
  onShowNotes?: () => void;
  className?: string;
}

export function Toolbar({
  onRefresh,
  onUpdate,
  onCommit,
  onRevert,
  onAdd,
  onDelete,
  onCleanup,
  onResolve,
  onMove,
  onCopy,
  onRename,
  onCommitPreload,
  onDiagnostics,
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
  browseMode = 'local',
  onBrowseModeChange,
  canBrowseOnline = false,
  showRemoteItems = false,
  onToggleRemoteItems,
  className = '',
}: ToolbarProps) {
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Secondary file actions, collapsed into a single "Actions" menu to keep the
  // toolbar uncluttered. Only handlers that were provided are shown.
  const actionItems: ToolbarActionItem[] = [];
  if (onRevert)
    actionItems.push({ key: 'revert', icon: Undo2, label: 'Revert', onClick: onRevert });
  if (onAdd)
    actionItems.push({ key: 'add', icon: Plus, label: 'Add to version control', onClick: onAdd });
  if (onResolve)
    actionItems.push({
      key: 'resolve',
      icon: CheckCircle2,
      label: 'Resolve conflict',
      onClick: onResolve,
    });
  if (onMove) actionItems.push({ key: 'move', icon: Move, label: 'Move…', onClick: onMove });
  if (onCopy) actionItems.push({ key: 'copy', icon: Copy, label: 'Copy…', onClick: onCopy });
  if (onRename)
    actionItems.push({ key: 'rename', icon: Pencil, label: 'Rename…', onClick: onRename });
  if (onCleanup)
    actionItems.push({ key: 'cleanup', icon: Wrench, label: 'Cleanup', onClick: onCleanup });
  if (onDelete)
    actionItems.push({
      key: 'delete',
      icon: Trash2,
      label: 'Delete',
      onClick: onDelete,
      danger: true,
    });

  // Close view menu on escape
  const handleViewMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowViewMenu(false);
    }
  }, []);

  // Focus management for view menu
  useEffect(() => {
    if (showViewMenu && viewMenuRef.current) {
      const firstButton = viewMenuRef.current.querySelector('button');
      firstButton?.focus();
    }
  }, [showViewMenu]);

  return (
    <div className={`toolbar ${className}`} role="toolbar" aria-label="Main toolbar">
      {/* Primary Actions */}
      <div className="toolbar-group" role="group" aria-label="Primary actions">
        <button
          onClick={onRefresh}
          disabled={isUpdating}
          className="btn-icon-sm"
          title="Refresh (F5)"
          aria-label={isUpdating ? 'Refreshing...' : 'Refresh files (F5)'}
          aria-busy={isUpdating}
        >
          <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
        </button>

        {/* Bookmark Toggle */}
        {onToggleBookmark && (
          <button
            type="button"
            onClick={onToggleBookmark}
            className={`btn-icon-sm ${isBookmarked ? 'text-yellow-500' : ''}`}
            title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            aria-pressed={isBookmarked}
          >
            {isBookmarked ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
          </button>
        )}
      </div>

      {canBrowseOnline && onBrowseModeChange && (
        <div
          className="flex items-center bg-bg-tertiary rounded-md p-0.5 ml-2"
          role="radiogroup"
          aria-label="Browse mode"
        >
          <button
            type="button"
            onClick={() => onBrowseModeChange('local')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-fast ${
              browseMode === 'local' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
            }`}
            title="View local files"
            role="radio"
            aria-checked={browseMode === 'local'}
            aria-label="Local files"
          >
            <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Local</span>
          </button>
          <button
            type="button"
            onClick={() => onBrowseModeChange('online')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-fast ${
              browseMode === 'online' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
            }`}
            title="View online repository"
            role="radio"
            aria-checked={browseMode === 'online'}
            aria-label="Online repository"
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Online</span>
          </button>
        </div>
      )}

      {isVersioned && (
        <>
          <div className="toolbar-divider" role="separator" aria-orientation="vertical" />

          <div className="toolbar-group" role="group" aria-label="Version control actions">
            <button
              onClick={onUpdate}
              disabled={isUpdating}
              className="btn btn-secondary gap-1.5"
              title="Update working copy"
              aria-label="Update working copy from repository"
              aria-disabled={isUpdating}
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>Update</span>
            </button>

            <button
              onPointerEnter={onCommitPreload}
              onFocus={onCommitPreload}
              onClick={onCommit}
              disabled={!hasChanges}
              className="btn btn-primary gap-1.5"
              title="Commit changes"
              aria-label={`Commit changes${!hasChanges ? ' (no changes to commit)' : ''}`}
              aria-disabled={!hasChanges}
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>Commit</span>
            </button>
          </div>

          {actionItems.length > 0 && (
            <>
              <div className="toolbar-divider" role="separator" aria-orientation="vertical" />

              {/* Context actions, collapsed into a single menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowActionsMenu((value) => !value)}
                  className="btn btn-ghost gap-1.5"
                  title="File actions"
                  aria-label="File actions"
                  aria-haspopup="menu"
                  aria-expanded={showActionsMenu}
                >
                  <span>Actions</span>
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                </button>

                {showActionsMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowActionsMenu(false)}
                      aria-hidden="true"
                    />
                    <div
                      className="dropdown left-0 z-50 w-56"
                      role="menu"
                      aria-label="File actions"
                      onKeyDown={(e) => e.key === 'Escape' && setShowActionsMenu(false)}
                    >
                      {!hasSelection && (
                        <p className="px-3 py-1.5 text-2xs text-text-muted">
                          Select an item to act on it
                        </p>
                      )}
                      {actionItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            disabled={!hasSelection}
                            onClick={() => {
                              item.onClick();
                              setShowActionsMenu(false);
                            }}
                            className={`dropdown-item w-full disabled:opacity-40 disabled:pointer-events-none ${
                              item.danger ? 'hover:text-error hover:bg-error/10' : ''
                            }`}
                          >
                            <Icon className="w-4 h-4" aria-hidden="true" />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" role="presentation" />

      {/* Filter Toggle */}
      {onToggleFilters && (
        <button
          onClick={onToggleFilters}
          className={`btn-icon-sm ${showFilters ? 'text-accent' : ''} ${hasActiveFilters ? 'bg-accent/10' : ''}`}
          title={showFilters ? 'Hide filters' : 'Show filters'}
          aria-label={`${showFilters ? 'Hide' : 'Show'} filters${hasActiveFilters ? ' (filters active)' : ''}`}
          aria-pressed={showFilters}
          aria-haspopup="true"
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          {hasActiveFilters && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-accent rounded-full"
              aria-label="Filters active"
            />
          )}
        </button>
      )}

      {/* Dual Pane Toggle */}
      {onToggleDualPane && (
        <button
          onClick={onToggleDualPane}
          className={`btn-icon-sm ${isDualPane ? 'text-accent bg-accent/10' : ''}`}
          title={isDualPane ? 'Close dual pane' : 'Open dual pane view'}
          aria-label={isDualPane ? 'Close dual pane view' : 'Open dual pane view'}
          aria-pressed={isDualPane}
        >
          <Columns2 className="w-4 h-4" aria-hidden="true" />
        </button>
      )}

      {/* Preview Toggle */}
      {onTogglePreview && (
        <button
          onClick={onTogglePreview}
          disabled={!hasSelectionForPreview}
          className={`btn-icon-sm ${showPreview ? 'text-accent bg-accent/10' : ''}`}
          title={showPreview ? 'Hide preview' : 'Preview selected file'}
          aria-label={showPreview ? 'Hide file preview' : 'Preview selected file'}
          aria-pressed={showPreview}
          aria-disabled={!hasSelectionForPreview}
        >
          {showPreview ? (
            <EyeOff className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Eye className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
      )}

      {/* Search */}
      {onSearchChange && (
        <div className="relative" role="search">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
            aria-hidden="true"
          />
          <label htmlFor="toolbar-search" className="sr-only">
            Search files
          </label>
          <input
            id="toolbar-search"
            ref={searchInputRef}
            type="search"
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
            aria-label="View options"
            aria-expanded={showViewMenu}
            aria-haspopup="menu"
          >
            {viewMode === 'list' ? (
              <List className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Grid3X3 className="w-4 h-4" aria-hidden="true" />
            )}
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          </button>

          {showViewMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowViewMenu(false)}
                aria-hidden="true"
              />
              <div
                ref={viewMenuRef}
                className="dropdown right-0 z-50 w-56"
                role="menu"
                aria-label="View options"
                onKeyDown={handleViewMenuKeyDown}
              >
                <button
                  onClick={() => {
                    onViewModeChange('list');
                    setShowViewMenu(false);
                  }}
                  className={`dropdown-item w-full ${viewMode === 'list' ? 'dropdown-item-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={viewMode === 'list'}
                >
                  <List className="w-4 h-4" aria-hidden="true" />
                  <span>List View</span>
                </button>
                <button
                  onClick={() => {
                    onViewModeChange('grid');
                    setShowViewMenu(false);
                  }}
                  className={`dropdown-item w-full ${viewMode === 'grid' ? 'dropdown-item-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={viewMode === 'grid'}
                >
                  <Grid3X3 className="w-4 h-4" aria-hidden="true" />
                  <span>Grid View</span>
                </button>

                {isVersioned && browseMode === 'local' && onToggleRemoteItems && (
                  <>
                    <div className="context-menu-divider" />
                    <button
                      onClick={() => {
                        onToggleRemoteItems();
                        setShowViewMenu(false);
                      }}
                      className="dropdown-item w-full justify-between"
                      role="menuitemcheckbox"
                      aria-checked={showRemoteItems}
                      title="Show items that exist in the repository but aren't checked out locally (sparse checkout)"
                    >
                      <span className="flex items-center gap-2">
                        <Cloud className="w-4 h-4" aria-hidden="true" />
                        <span>Show remote items</span>
                      </span>
                      {showRemoteItems && (
                        <Check className="w-4 h-4 text-accent" aria-hidden="true" />
                      )}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Diagnostics - only show for versioned paths */}
      {isVersioned && onDiagnostics && (
        <button
          onClick={onDiagnostics}
          className="btn-icon-sm"
          title="Repository Diagnostics"
          aria-label="Open repository diagnostics"
        >
          <Stethoscope className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// Compact toolbar for minimal space
export function ToolbarCompact({
  onRefresh,
  onUpdate,
  onCommit,
  onCommitPreload,
  isUpdating = false,
  hasChanges = false,
  className = '',
}: Pick<
  ToolbarProps,
  | 'onRefresh'
  | 'onUpdate'
  | 'onCommit'
  | 'onCommitPreload'
  | 'isUpdating'
  | 'hasChanges'
  | 'className'
>) {
  return (
    <div
      className={`flex items-center gap-2 h-9 px-3 bg-bg-secondary border-b border-border ${className}`}
      role="toolbar"
      aria-label="Compact toolbar"
    >
      <button
        onClick={onRefresh}
        disabled={isUpdating}
        className="btn-icon-sm"
        title="Refresh"
        aria-label={isUpdating ? 'Refreshing...' : 'Refresh files'}
        aria-busy={isUpdating}
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
      </button>

      <div className="toolbar-divider" role="separator" aria-orientation="vertical" />

      <button
        onClick={onUpdate}
        disabled={isUpdating}
        className="btn-icon-sm"
        title="Update"
        aria-label="Update working copy"
        aria-disabled={isUpdating}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      <button
        onPointerEnter={onCommitPreload}
        onFocus={onCommitPreload}
        onClick={onCommit}
        disabled={!hasChanges}
        className="btn-sm px-2 py-1 bg-accent text-white rounded text-xs font-medium disabled:opacity-50"
        title="Commit"
        aria-label={`Commit changes${!hasChanges ? ' (no changes)' : ''}`}
        aria-disabled={!hasChanges}
      >
        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
