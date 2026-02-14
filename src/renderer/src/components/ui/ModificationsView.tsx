import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { 
  RefreshCw, 
  FileText, 
  Folder, 
  AlertCircle, 
  CheckCircle,
  ArrowUp,
  ArrowDown,
  X,
  Filter
} from 'lucide-react'
import type { SvnStatusChar, SvnStatusEntry } from '@shared/types'
import { StatusIcon, StatusDot } from './StatusIcon'

interface ModificationsViewProps {
  path: string
  onClose?: () => void
}

type ModificationFilter = 'all' | 'modified' | 'added' | 'deleted' | 'conflicted' | 'unversioned'

export function ModificationsView({ path, onClose }: ModificationsViewProps) {
  const queryClient = useQueryClient()
  const parentRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<ModificationFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Get SVN status for the path
  const { data: statusData, isLoading } = useQuery({
    queryKey: ['svn:status', path],
    queryFn: () => window.api.svn.status(path),
    refetchInterval: 30000, // Refresh every 30 seconds
  })
  
  // Filter entries based on status and search
  const filteredEntries = useMemo(() => {
    if (!statusData?.entries) return []
    
    let entries = statusData.entries
    
    // Filter by status
    if (filter !== 'all') {
      const statusMap: Record<ModificationFilter, SvnStatusChar[]> = {
        'all': ['M', 'A', 'D', 'C', 'R', '?', '!'],
        'modified': ['M', 'R'],
        'added': ['A'],
        'deleted': ['D'],
        'conflicted': ['C'],
        'unversioned': ['?']
      }
      entries = entries.filter(e => statusMap[filter].includes(e.status))
    }
    
    // Filter by search query
    if (searchQuery) {
      entries = entries.filter(e => 
        e.path.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }
    
    return entries
  }, [statusData, filter, searchQuery])
  
  // Virtualizer for large lists
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10
  })
  
  // Stats
  const stats = useMemo(() => {
    if (!statusData?.entries) return { modified: 0, added: 0, deleted: 0, conflicted: 0, unversioned: 0 }
    
    return {
      modified: statusData.entries.filter(e => ['M', 'R'].includes(e.status)).length,
      added: statusData.entries.filter(e => e.status === 'A').length,
      deleted: statusData.entries.filter(e => e.status === 'D').length,
      conflicted: statusData.entries.filter(e => e.status === 'C').length,
      unversioned: statusData.entries.filter(e => e.status === '?').length
    }
  }, [statusData])
  
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['svn:status', path] })
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-text">Check for Modifications</h2>
          <span className="text-sm text-text-faint">{path}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="btn btn-secondary"
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {onClose && (
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      {/* Filter Bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary border-b border-border">
        <Filter className="w-4 h-4 text-text-muted" />
        
        <button
          onClick={() => setFilter('all')}
          className={`btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
        >
          All ({statusData?.entries.length || 0})
        </button>
        
        <button
          onClick={() => setFilter('modified')}
          className={`btn-sm ${filter === 'modified' ? 'text-svn-modified bg-svn-modified/20' : 'btn-secondary'}`}
        >
          <ArrowUp className="w-3 h-3" />
          Modified ({stats.modified})
        </button>
        
        <button
          onClick={() => setFilter('added')}
          className={`btn-sm ${filter === 'added' ? 'text-svn-added bg-svn-added/20' : 'btn-secondary'}`}
        >
          <ArrowUp className="w-3 h-3" />
          Added ({stats.added})
        </button>
        
        <button
          onClick={() => setFilter('deleted')}
          className={`btn-sm ${filter === 'deleted' ? 'text-svn-deleted bg-svn-deleted/20' : 'btn-secondary'}`}
        >
          <ArrowDown className="w-3 h-3" />
          Deleted ({stats.deleted})
        </button>
        
        <button
          onClick={() => setFilter('conflicted')}
          className={`btn-sm ${filter === 'conflicted' ? 'text-svn-conflict bg-svn-conflict/20' : 'btn-secondary'}`}
        >
          <AlertCircle className="w-3 h-3" />
          Conflicts ({stats.conflicted})
        </button>
        
        <button
          onClick={() => setFilter('unversioned')}
          className={`btn-sm ${filter === 'unversioned' ? 'text-text-muted bg-bg-elevated' : 'btn-secondary'}`}
        >
          <FileText className="w-3 h-3" />
          Unversioned ({stats.unversioned})
        </button>
        
        <div className="flex-1" />
        
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          className="input w-48"
        />
      </div>
      
      {/* List */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <CheckCircle className="w-8 h-8 text-success mb-2" />
            <p className="text-text-secondary">
              {filter === 'all' 
                ? 'No modifications found' 
                : `No ${filter} files`}
            </p>
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index]
              return (
                <ModificationRow
                  key={entry.path}
                  entry={entry}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
      
      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-t border-border text-sm text-text-secondary">
        <span>{filteredEntries.length} items</span>
        {stats.conflicted > 0 && (
          <span className="text-svn-conflict">
            {stats.conflicted} conflict{stats.conflicted > 1 ? 's' : ''} need resolution
          </span>
        )}
      </div>
    </div>
  )
}

// Individual row component
function ModificationRow({ entry, style }: { entry: SvnStatusEntry; style: React.CSSProperties }) {
  const filename = entry.path.split(/[/\\]/).pop() || entry.path
  
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 hover:bg-bg-tertiary transition-fast"
      style={style}
    >
      {/* Icon */}
      {entry.isDirectory ? (
        <Folder className="w-4 h-4 text-accent" />
      ) : (
        <FileText className="w-4 h-4 text-text-muted" />
      )}
      
      {/* Status */}
      <StatusDot status={entry.status} />
      
      {/* Name */}
      <span className="flex-1 truncate text-sm">{filename}</span>
      
      {/* Status badge */}
      <StatusIcon status={entry.status} size="sm" />
      
      {/* Date */}
      {entry.date && (
        <span className="text-xs text-text-faint w-24 text-right">
          {new Date(entry.date).toLocaleDateString()}
        </span>
      )}
    </div>
  )
}
