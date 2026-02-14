import { useState, useCallback, useMemo } from 'react'
import {
  Filter,
  FileCode,
  FileImage,
  FileText,
  FileArchive,
  File,
  Folder,
  X,
  ChevronDown
} from 'lucide-react'
import type { SvnStatusChar } from '@shared/types'

export type FileTypeFilter = 'all' | 'code' | 'images' | 'documents' | 'archives' | 'folders'
export type StatusFilter = SvnStatusChar | 'all'

interface FileTypeOption {
  value: FileTypeFilter
  label: string
  icon: React.ComponentType<{ className?: string }>
  extensions: string[]
}

const FILE_TYPE_OPTIONS: FileTypeOption[] = [
  { value: 'all', label: 'All Files', icon: File, extensions: [] },
  { value: 'folders', label: 'Folders', icon: Folder, extensions: [] },
  { value: 'code', label: 'Code', icon: FileCode, extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.swift', '.kt', '.php', '.vue', '.svelte'] },
  { value: 'images', label: 'Images', icon: FileImage, extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp'] },
  { value: 'documents', label: 'Documents', icon: FileText, extensions: ['.md', '.txt', '.pdf', '.doc', '.docx', '.rtf', '.odt'] },
  { value: 'archives', label: 'Archives', icon: FileArchive, extensions: ['.zip', '.tar', '.gz', '.rar', '.7z', '.bz2'] },
]

interface StatusFilterOption {
  value: StatusFilter
  label: string
  color: string
}

const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { value: 'all', label: 'All', color: 'text-text-secondary' },
  { value: 'M', label: 'Modified', color: 'text-svn-modified' },
  { value: 'A', label: 'Added', color: 'text-svn-added' },
  { value: 'D', label: 'Deleted', color: 'text-svn-deleted' },
  { value: 'C', label: 'Conflict', color: 'text-svn-conflict' },
  { value: '?', label: 'Unversioned', color: 'text-svn-unversioned' },
  { value: '!', label: 'Missing', color: 'text-warning' },
  { value: 'R', label: 'Replaced', color: 'text-info' },
  { value: 'X', label: 'External', color: 'text-accent' },
]

interface FilterBarProps {
  onFileTypeChange?: (filter: FileTypeFilter) => void
  onStatusChange?: (filter: StatusFilter) => void
  activeFileType?: FileTypeFilter
  activeStatus?: StatusFilter
  fileCount?: { total: number; filtered: number }
  className?: string
}

export function FilterBar({
  onFileTypeChange,
  onStatusChange,
  activeFileType = 'all',
  activeStatus = 'all',
  fileCount,
  className = ''
}: FilterBarProps) {
  const [showFileTypeMenu, setShowFileTypeMenu] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  const currentTypeOption = FILE_TYPE_OPTIONS.find(o => o.value === activeFileType) || FILE_TYPE_OPTIONS[0]
  const currentStatusOption = STATUS_FILTER_OPTIONS.find(o => o.value === activeStatus) || STATUS_FILTER_OPTIONS[0]

  const hasActiveFilters = activeFileType !== 'all' || activeStatus !== 'all'

  const clearFilters = useCallback(() => {
    onFileTypeChange?.('all')
    onStatusChange?.('all')
  }, [onFileTypeChange, onStatusChange])

  return (
    <div className={`flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-border ${className}`}>
      {/* File Type Filter */}
      <div className="relative">
        <button
          onClick={() => setShowFileTypeMenu(!showFileTypeMenu)}
          className={`btn btn-secondary btn-sm gap-1.5 ${activeFileType !== 'all' ? 'border-accent text-accent' : ''}`}
        >
          <currentTypeOption.icon className="w-3.5 h-3.5" />
          <span>{currentTypeOption.label}</span>
          <ChevronDown className="w-3 h-3" />
        </button>
        
        {showFileTypeMenu && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setShowFileTypeMenu(false)}
            />
            <div className="dropdown top-full left-0 mt-1 z-50 min-w-[160px]">
              {FILE_TYPE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => {
                    onFileTypeChange?.(option.value)
                    setShowFileTypeMenu(false)
                  }}
                  className={`dropdown-item w-full ${activeFileType === option.value ? 'dropdown-item-active' : ''}`}
                >
                  <option.icon className="w-4 h-4" />
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Status Filter */}
      <div className="relative">
        <button
          onClick={() => setShowStatusMenu(!showStatusMenu)}
          className={`btn btn-secondary btn-sm gap-1.5 ${activeStatus !== 'all' ? 'border-accent text-accent' : ''}`}
        >
          <Filter className="w-3.5 h-3.5" />
          <span className={currentStatusOption.color}>{currentStatusOption.label}</span>
          <ChevronDown className="w-3 h-3" />
        </button>
        
        {showStatusMenu && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setShowStatusMenu(false)}
            />
            <div className="dropdown top-full left-0 mt-1 z-50 min-w-[160px]">
              {STATUS_FILTER_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => {
                    onStatusChange?.(option.value)
                    setShowStatusMenu(false)
                  }}
                  className={`dropdown-item w-full ${activeStatus === option.value ? 'dropdown-item-active' : ''}`}
                >
                  <span className={option.color}>{option.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Quick Status Filters */}
      <div className="flex items-center gap-1 px-2">
        {(['M', 'A', '?', 'C'] as const).map(status => {
          const opt = STATUS_FILTER_OPTIONS.find(o => o.value === status)
          if (!opt) return null
          return (
            <button
              key={status}
              onClick={() => onStatusChange?.(activeStatus === status ? 'all' : status)}
              className={`px-2 py-0.5 text-xs rounded transition-fast ${
                activeStatus === status 
                  ? 'bg-accent/20 text-accent' 
                  : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
              }`}
              title={opt.label}
            >
              {status}
            </button>
          )
        })}
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="btn-icon-sm text-text-muted hover:text-text"
          title="Clear filters"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* File Count */}
      {fileCount && (
        <div className="ml-auto text-xs text-text-muted">
          {fileCount.filtered !== fileCount.total ? (
            <span>
              <span className="text-accent">{fileCount.filtered}</span>
              <span className="text-text-faint mx-1">/</span>
              {fileCount.total} items
            </span>
          ) : (
            <span>{fileCount.total} items</span>
          )}
        </div>
      )}
    </div>
  )
}

// Hook for filtering entries
export function useFileFilters(entries: import('@shared/types').SvnStatusEntry[]) {
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filteredEntries = useMemo(() => {
    let result = entries

    // Filter by status
    if (statusFilter !== 'all') {
      result = result.filter(entry => entry.status === statusFilter)
    }

    // Filter by file type
    if (fileTypeFilter !== 'all') {
      if (fileTypeFilter === 'folders') {
        result = result.filter(entry => entry.isDirectory)
      } else {
        const option = FILE_TYPE_OPTIONS.find(o => o.value === fileTypeFilter)
        if (option?.extensions.length) {
          result = result.filter(entry => {
            if (entry.isDirectory) return false
            const ext = '.' + entry.path.split('.').pop()?.toLowerCase()
            return option.extensions.includes(ext)
          })
        }
      }
    }

    return result
  }, [entries, fileTypeFilter, statusFilter])

  return {
    filteredEntries,
    fileTypeFilter,
    setFileTypeFilter,
    statusFilter,
    setStatusFilter,
    hasActiveFilters: fileTypeFilter !== 'all' || statusFilter !== 'all'
  }
}

// ============================================
// Smart Filters
// ============================================

export type SmartFilterType = 
  | 'modified-today'
  | 'modified-this-week'
  | 'conflicted'
  | 'large-files'
  | 'binaries'
  | 'locked'
  | 'added-today'
  | 'needs-attention'
  | 'stale'
  | 'all'

interface SmartFilter {
  id: SmartFilterType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  color: string
}

const SMART_FILTERS: SmartFilter[] = [
  {
    id: 'all',
    label: 'All',
    description: 'Show all files',
    icon: File,
    color: 'text-text-secondary'
  },
  {
    id: 'needs-attention',
    label: 'Needs Attention',
    description: 'Conflicts, missing files, and tree conflicts',
    icon: AlertCircle,
    badge: '!',
    color: 'text-warning'
  },
  {
    id: 'modified-today',
    label: 'Modified Today',
    description: 'Files modified in the last 24 hours',
    icon: FileCode,
    color: 'text-svn-modified'
  },
  {
    id: 'modified-this-week',
    label: 'This Week',
    description: 'Files modified in the last 7 days',
    icon: FileCode,
    color: 'text-info'
  },
  {
    id: 'added-today',
    label: 'Added Today',
    description: 'New files added today',
    icon: Plus,
    color: 'text-svn-added'
  },
  {
    id: 'conflicted',
    label: 'Conflicted',
    description: 'Files with merge conflicts',
    icon: AlertCircle,
    color: 'text-svn-conflict'
  },
  {
    id: 'large-files',
    label: 'Large Files',
    description: 'Files larger than 1MB',
    icon: FileArchive,
    badge: '>1MB',
    color: 'text-accent'
  },
  {
    id: 'binaries',
    label: 'Binaries',
    description: 'Binary files (images, executables, etc.)',
    icon: FileArchive,
    color: 'text-text-muted'
  },
  {
    id: 'locked',
    label: 'Locked',
    description: 'Files that are locked',
    icon: Lock,
    color: 'text-warning'
  },
  {
    id: 'stale',
    label: 'Stale',
    description: 'Not updated in 30+ days',
    icon: File,
    color: 'text-text-faint'
  }
]

interface SmartFilterBarProps {
  activeFilter: SmartFilterType
  onFilterChange: (filter: SmartFilterType) => void
  counts?: Partial<Record<SmartFilterType, number>>
  className?: string
}

export function SmartFilterBar({
  activeFilter,
  onFilterChange,
  counts,
  className = ''
}: SmartFilterBarProps) {
  const [showAll, setShowAll] = useState(false)
  
  const visibleFilters = showAll ? SMART_FILTERS : SMART_FILTERS.slice(0, 6)
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-xs text-text-muted">Smart Filters:</span>
      
      <div className="flex items-center gap-1 flex-wrap">
        {visibleFilters.map(filter => {
          const count = counts?.[filter.id]
          const isActive = activeFilter === filter.id
          
          return (
            <button
              key={filter.id}
              onClick={() => onFilterChange(isActive ? 'all' : filter.id)}
              className={`
                flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                transition-fast
                ${isActive 
                  ? 'bg-accent/20 text-accent ring-1 ring-accent/50' 
                  : 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text'
                }
              `}
              title={filter.description}
            >
              <filter.icon className="w-3 h-3" />
              <span>{filter.label}</span>
              {count !== undefined && count > 0 && (
                <span className={`
                  px-1 rounded text-xs
                  ${isActive ? 'bg-accent/30 text-accent' : 'bg-bg text-text-muted'}
                `}>
                  {count}
                </span>
              )}
              {filter.badge && !count && (
                <span className="text-xs text-text-faint">{filter.badge}</span>
              )}
            </button>
          )
        })}
        
        {!showAll && SMART_FILTERS.length > 6 && (
          <button
            onClick={() => setShowAll(true)}
            className="px-2 py-1 text-xs text-accent hover:text-accent/80"
          >
            +{SMART_FILTERS.length - 6} more
          </button>
        )}
        
        {showAll && (
          <button
            onClick={() => setShowAll(false)}
            className="px-2 py-1 text-xs text-text-muted hover:text-text"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  )
}

// Hook for smart filtering
interface FileInfo {
  path: string
  status: import('@shared/types').SvnStatusChar
  isDirectory: boolean
  size?: number
  modifiedTime?: string
  lock?: { owner: string }
}

export function useSmartFilters(files: FileInfo[]) {
  const [activeFilter, setActiveFilter] = useState<SmartFilterType>('all')
  
  const filterCounts = useMemo(() => {
    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000
    const oneWeek = 7 * oneDay
    const thirtyDays = 30 * oneDay
    
    const counts: Partial<Record<SmartFilterType, number>> = {}
    
    counts['needs-attention'] = files.filter(f => 
      ['C', '!', '~'].includes(f.status)
    ).length
    
    counts['modified-today'] = files.filter(f => {
      if (f.status !== 'M') return false
      if (!f.modifiedTime) return false
      return (now - new Date(f.modifiedTime).getTime()) < oneDay
    }).length
    
    counts['modified-this-week'] = files.filter(f => {
      if (f.status !== 'M') return false
      if (!f.modifiedTime) return false
      return (now - new Date(f.modifiedTime).getTime()) < oneWeek
    }).length
    
    counts['added-today'] = files.filter(f => {
      if (f.status !== 'A') return false
      if (!f.modifiedTime) return false
      return (now - new Date(f.modifiedTime).getTime()) < oneDay
    }).length
    
    counts['conflicted'] = files.filter(f => f.status === 'C').length
    
    counts['large-files'] = files.filter(f => 
      !f.isDirectory && (f.size || 0) > 1024 * 1024
    ).length
    
    counts['binaries'] = files.filter(f => {
      if (f.isDirectory) return false
      const ext = f.path.split('.').pop()?.toLowerCase() || ''
      return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'exe', 'dll', 'so', 'dylib', 'pdf', 'zip', 'tar', 'gz'].includes(ext)
    }).length
    
    counts['locked'] = files.filter(f => f.lock).length
    
    counts['stale'] = files.filter(f => {
      if (!f.modifiedTime) return false
      return (now - new Date(f.modifiedTime).getTime()) > thirtyDays
    }).length
    
    return counts
  }, [files])
  
  const filteredFiles = useMemo(() => {
    if (activeFilter === 'all') return files
    
    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000
    const oneWeek = 7 * oneDay
    const thirtyDays = 30 * oneDay
    
    switch (activeFilter) {
      case 'needs-attention':
        return files.filter(f => ['C', '!', '~'].includes(f.status))
        
      case 'modified-today':
        return files.filter(f => {
          if (f.status !== 'M') return false
          if (!f.modifiedTime) return false
          return (now - new Date(f.modifiedTime).getTime()) < oneDay
        })
        
      case 'modified-this-week':
        return files.filter(f => {
          if (f.status !== 'M') return false
          if (!f.modifiedTime) return false
          return (now - new Date(f.modifiedTime).getTime()) < oneWeek
        })
        
      case 'added-today':
        return files.filter(f => {
          if (f.status !== 'A') return false
          if (!f.modifiedTime) return false
          return (now - new Date(f.modifiedTime).getTime()) < oneDay
        })
        
      case 'conflicted':
        return files.filter(f => f.status === 'C')
        
      case 'large-files':
        return files.filter(f => !f.isDirectory && (f.size || 0) > 1024 * 1024)
        
      case 'binaries':
        return files.filter(f => {
          if (f.isDirectory) return false
          const ext = f.path.split('.').pop()?.toLowerCase() || ''
          return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'exe', 'dll', 'so', 'dylib', 'pdf', 'zip', 'tar', 'gz'].includes(ext)
        })
        
      case 'locked':
        return files.filter(f => f.lock)
        
      case 'stale':
        return files.filter(f => {
          if (!f.modifiedTime) return false
          return (now - new Date(f.modifiedTime).getTime()) > thirtyDays
        })
        
      default:
        return files
    }
  }, [files, activeFilter])
  
  return {
    activeFilter,
    setActiveFilter,
    filteredFiles,
    filterCounts
  }
}

// Additional imports needed
import { Lock, AlertCircle, Plus } from 'lucide-react'
