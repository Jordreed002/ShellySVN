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
