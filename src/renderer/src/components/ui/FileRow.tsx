import { memo, useRef } from 'react'
import { 
  Folder, 
  File, 
  FileCode, 
  FileImage, 
  FileText, 
  FileArchive,
  FileSpreadsheet,
  FileJson,
  ChevronRight
} from 'lucide-react'
import type { SvnStatusEntry } from '@shared/types'
import { StatusIcon, StatusDot } from './StatusIcon'
import { useContextMenu, getSvnContextMenuItems, ContextMenu } from './ContextMenu'
import { FileThumbnail } from './FileThumbnail'

// Context menu actions interface
export interface FileRowActions {
  onUpdate?: (entry: SvnStatusEntry) => void
  onCommit?: (entry: SvnStatusEntry) => void
  onRevert?: (entry: SvnStatusEntry) => void
  onAdd?: (entry: SvnStatusEntry) => void
  onDelete?: (entry: SvnStatusEntry) => void
  onShowLog?: (entry: SvnStatusEntry) => void
  onDiff?: (entry: SvnStatusEntry) => void
  onOpenInExplorer?: (entry: SvnStatusEntry) => void
  onCopyPath?: (entry: SvnStatusEntry) => void
  onPreview?: (entry: SvnStatusEntry) => void
}

// File type to icon mapping
function getFileIcon(filename: string, isDirectory: boolean) {
  if (isDirectory) return Folder
  
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    // Images
    'png': FileImage,
    'jpg': FileImage,
    'jpeg': FileImage,
    'gif': FileImage,
    'webp': FileImage,
    'ico': FileImage,
    'svg': FileImage,
    // Code
    'js': FileCode,
    'jsx': FileCode,
    'ts': FileCode,
    'tsx': FileCode,
    'py': FileCode,
    'rb': FileCode,
    'go': FileCode,
    'rs': FileCode,
    'java': FileCode,
    'c': FileCode,
    'cpp': FileCode,
    'h': FileCode,
    'cs': FileCode,
    'swift': FileCode,
    'kt': FileCode,
    'php': FileCode,
    // Data
    'json': FileJson,
    'xml': FileJson,
    'yaml': FileJson,
    'yml': FileJson,
    'toml': FileJson,
    // Documents
    'md': FileText,
    'txt': FileText,
    'pdf': FileText,
    'doc': FileText,
    'docx': FileText,
    // Spreadsheets
    'csv': FileSpreadsheet,
    'xls': FileSpreadsheet,
    'xlsx': FileSpreadsheet,
    // Archives
    'zip': FileArchive,
    'tar': FileArchive,
    'gz': FileArchive,
    'rar': FileArchive,
    '7z': FileArchive,
  }
  
  return iconMap[ext] || File
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

// Format date
function formatDate(dateStr?: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' })
  } else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }
}

export interface FileRowProps {
  entry: SvnStatusEntry
  isSelected: boolean
  isExpanded?: boolean
  hasChildren?: boolean
  depth?: number
  compact?: boolean
  showThumbnails?: boolean
  onSelect: (entry: SvnStatusEntry, event?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => void
  onToggle?: (entry: SvnStatusEntry) => void
  onNavigate?: (entry: SvnStatusEntry) => void
  style?: React.CSSProperties
  showColumns?: boolean
  columnWidths?: {
    name: number
    status: number
    revision: number
    author: number
    date: number
    size: number
  }
  actions?: FileRowActions
}

export const FileRow = memo(function FileRow({
  entry,
  isSelected,
  isExpanded = false,
  hasChildren = false,
  depth = 0,
  compact = false,
  showThumbnails = false,
  onSelect,
  onToggle,
  onNavigate,
  style,
  showColumns = true,
  columnWidths = {
    name: 300,
    status: 80,
    revision: 70,
    author: 100,
    date: 100,
    size: 80
  },
  actions = {}
}: FileRowProps) {
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu()
  
  const filename = entry.path.split(/[/\\]/).pop() || entry.path
  const Icon = getFileIcon(filename, entry.isDirectory)
  
  const handleClick = (e: React.MouseEvent) => {
    // Prevent text selection on shift+click
    if (e.shiftKey) {
      e.preventDefault()
      // Clear any existing text selection
      window.getSelection()?.removeAllRanges()
    }
    onSelect(entry, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey })
  }
  
  const handleMouseDown = (e: React.MouseEvent) => {
    // Prevent text selection on shift+click at the mousedown stage
    if (e.shiftKey) {
      e.preventDefault()
    }
  }
  
  const handleDoubleClick = () => {
    if (entry.isDirectory && onNavigate) {
      onNavigate(entry)
    }
  }
  
  const handleContextMenu = (e: React.MouseEvent) => {
    showContextMenu(e, entry)
  }
  
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onToggle) {
      onToggle(entry)
    }
  }
  
  // Context menu items with action callbacks
  const contextMenuItems = getSvnContextMenuItems(entry.status, entry.isDirectory, {
    onUpdate: actions.onUpdate ? () => actions.onUpdate!(entry) : undefined,
    onCommit: actions.onCommit ? () => actions.onCommit!(entry) : undefined,
    onRevert: actions.onRevert ? () => actions.onRevert!(entry) : undefined,
    onAdd: actions.onAdd ? () => actions.onAdd!(entry) : undefined,
    onDelete: actions.onDelete ? () => actions.onDelete!(entry) : undefined,
    onShowLog: actions.onShowLog ? () => actions.onShowLog!(entry) : undefined,
    onDiff: actions.onDiff ? () => actions.onDiff!(entry) : undefined,
    onOpenInExplorer: actions.onOpenInExplorer ? () => actions.onOpenInExplorer!(entry) : undefined,
    onCopyPath: actions.onCopyPath ? () => actions.onCopyPath!(entry) : () => navigator.clipboard.writeText(entry.path),
    onPreview: actions.onPreview ? () => actions.onPreview!(entry) : undefined,
  })

  return (
    <>
      <div
        className={`
          file-row
          ${isSelected ? 'file-row-selected' : ''}
          ${entry.isDirectory ? 'text-text' : 'text-text-secondary'}
          ${compact ? 'py-1' : 'py-2'}
        `}
        style={style}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        data-path={entry.path}
      >
        {/* Expand/Collapse Toggle */}
        <div 
          className="flex items-center justify-center w-5 flex-shrink-0"
          style={{ marginLeft: depth * 16 }}
        >
          {entry.isDirectory && hasChildren && (
            <button
              onClick={handleToggle}
              className="p-0.5 hover:bg-bg-elevated rounded transition-fast"
            >
              <ChevronRight 
                className={`w-3.5 h-3.5 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
              />
            </button>
          )}
        </div>
        
        {/* File Icon */}
        <div className="flex items-center justify-center w-6 flex-shrink-0">
          {showThumbnails ? (
            <FileThumbnail 
              filePath={entry.path}
              isDirectory={entry.isDirectory}
              size={16}
              className="w-4 h-4"
            />
          ) : (
            <Icon 
              className={`
                w-4 h-4
                ${entry.isDirectory ? 'text-accent' : 'text-text-muted'}
              `}
            />
          )}
        </div>
        
        {/* Status Icon */}
        <div className="flex items-center justify-center w-6 flex-shrink-0">
          <StatusDot status={entry.status} />
        </div>
        
        {/* Name Column */}
        <div 
          className="flex-1 truncate pr-4"
          style={{ minWidth: columnWidths.name - 80 }}
        >
          <span className={entry.isDirectory ? 'font-medium' : ''}>
            {filename}
          </span>
        </div>
        
        {/* Additional Columns */}
        {showColumns && (
          <>
            {/* Status */}
            <div 
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: columnWidths.status }}
            >
              <StatusIcon status={entry.status} size="sm" />
            </div>
            
            {/* Revision */}
            <div 
              className="text-right text-sm text-text-secondary font-mono flex-shrink-0"
              style={{ width: columnWidths.revision }}
            >
              {entry.revision || '-'}
            </div>
            
            {/* Author */}
            <div 
              className="truncate text-sm text-text-secondary flex-shrink-0"
              style={{ width: columnWidths.author }}
            >
              {entry.author || '-'}
            </div>
            
            {/* Date */}
            <div 
              className="text-sm text-text-secondary flex-shrink-0"
              style={{ width: columnWidths.date }}
            >
              {formatDate(entry.date)}
            </div>
            
            {/* Size (files only) */}
            <div 
              className="text-right text-sm text-text-secondary font-mono flex-shrink-0"
              style={{ width: columnWidths.size }}
            >
              {entry.isDirectory ? '-' : '-'}
            </div>
          </>
        )}
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={hideContextMenu}
        />
      )}
    </>
  )
})

// Header row for the file list
export function FileListHeader({
  columnWidths = {
    name: 300,
    status: 80,
    revision: 70,
    author: 100,
    date: 100,
    size: 80
  },
  onColumnWidthChange,
  onSort,
  sortColumn,
  sortDirection
}: {
  columnWidths?: FileRowProps['columnWidths']
  onColumnWidthChange?: (column: string, width: number) => void
  onSort?: (column: string) => void
  sortColumn?: string
  sortDirection?: 'asc' | 'desc'
}) {
  return (
    <div className="flex items-center px-4 py-2 bg-bg-tertiary border-b border-border text-xs font-medium text-text-secondary uppercase tracking-wider select-none">
      {/* Toggle + Icon + Status placeholder */}
      <div className="w-5 flex-shrink-0" />
      <div className="w-6 flex-shrink-0" />
      <div className="w-6 flex-shrink-0" />
      
      {/* Name */}
      <div 
        className="flex-1 cursor-pointer hover:text-text transition-fast relative group"
        onClick={() => onSort?.('name')}
      >
        Name
        {sortColumn === 'name' && (
          <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>
      
      {/* Status */}
      <HeaderColumn
        width={columnWidths.status}
        onWidthChange={(w) => onColumnWidthChange?.('status', w)}
        onSort={() => onSort?.('status')}
        isSorted={sortColumn === 'status'}
        sortDirection={sortDirection}
        resizable
      >
        Status
      </HeaderColumn>
      
      {/* Revision */}
      <HeaderColumn
        width={columnWidths.revision}
        onWidthChange={(w) => onColumnWidthChange?.('revision', w)}
        onSort={() => onSort?.('revision')}
        isSorted={sortColumn === 'revision'}
        sortDirection={sortDirection}
        resizable
        align="right"
      >
        Rev
      </HeaderColumn>
      
      {/* Author */}
      <HeaderColumn
        width={columnWidths.author}
        onWidthChange={(w) => onColumnWidthChange?.('author', w)}
        onSort={() => onSort?.('author')}
        isSorted={sortColumn === 'author'}
        sortDirection={sortDirection}
        resizable
      >
        Author
      </HeaderColumn>
      
      {/* Date */}
      <HeaderColumn
        width={columnWidths.date}
        onWidthChange={(w) => onColumnWidthChange?.('date', w)}
        onSort={() => onSort?.('date')}
        isSorted={sortColumn === 'date'}
        sortDirection={sortDirection}
        resizable
      >
        Modified
      </HeaderColumn>
      
      {/* Size */}
      <HeaderColumn
        width={columnWidths.size}
        onWidthChange={(w) => onColumnWidthChange?.('size', w)}
        onSort={() => onSort?.('size')}
        isSorted={sortColumn === 'size'}
        sortDirection={sortDirection}
        align="right"
      >
        Size
      </HeaderColumn>
    </div>
  )
}

// Resizable header column
function HeaderColumn({
  width,
  onWidthChange,
  onSort,
  isSorted,
  sortDirection,
  resizable = false,
  align = 'left',
  children
}: {
  width: number
  onWidthChange?: (width: number) => void
  onSort?: () => void
  isSorted?: boolean
  sortDirection?: 'asc' | 'desc'
  resizable?: boolean
  align?: 'left' | 'right' | 'center'
  children: React.ReactNode
}) {
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    startXRef.current = e.clientX
    startWidthRef.current = width
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startXRef.current
      const newWidth = Math.max(40, startWidthRef.current + diff)
      onWidthChange?.(newWidth)
    }
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
  }
  
  return (
    <div 
      className={`relative cursor-pointer hover:text-text transition-fast ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`}
      style={{ width }}
      onClick={onSort}
    >
      {children}
      {isSorted && (
        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
      )}
      {resizable && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-fast group-hover:bg-border"
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  )
}
