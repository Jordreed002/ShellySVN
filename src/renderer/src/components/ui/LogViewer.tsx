import { useEffect, useState, useRef } from 'react'
import { X, History, Loader, User, Calendar, GitCommit, RefreshCw } from 'lucide-react'
import type { SvnLogResult, SvnLogEntry } from '@shared/types'

interface LogViewerProps {
  isOpen: boolean
  path: string
  onClose: () => void
  onSelectRevision?: (revision: number, path: string) => void
}

export function LogViewer({ isOpen, path, onClose, onSelectRevision }: LogViewerProps) {
  const [log, setLog] = useState<SvnLogResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<SvnLogEntry | null>(null)
  const [limit, setLimit] = useState(50)
  const listRef = useRef<HTMLDivElement>(null)
  
  const loadLog = async () => {
    if (!path) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await window.api.svn.log(path, limit)
      setLog(result)
    } catch (err) {
      setError((err as Error).message || 'Failed to load log')
    } finally {
      setIsLoading(false)
    }
  }
  
  useEffect(() => {
    if (isOpen && path) {
      loadLog()
      setSelectedEntry(null)
    }
  }, [isOpen, path, limit])
  
  // Keyboard shortcut to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])
  
  if (!isOpen) return null
  
  const pathName = path.split(/[/\\]/).pop() || path
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[1000px] max-w-[95vw] h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <History className="w-5 h-5 text-accent" />
            Log: {pathName}
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="input text-sm py-1"
            >
              <option value={25}>25 entries</option>
              <option value={50}>50 entries</option>
              <option value={100}>100 entries</option>
              <option value={200}>200 entries</option>
            </select>
            <button
              onClick={loadLog}
              disabled={isLoading}
              className="btn-icon-sm"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Log entries list */}
          <div 
            ref={listRef}
            className="w-80 flex-shrink-0 border-r border-border overflow-auto"
          >
            {isLoading && !log && (
              <div className="flex items-center justify-center h-full">
                <Loader className="w-6 h-6 text-accent animate-spin" />
              </div>
            )}
            
            {error && (
              <div className="flex items-center justify-center h-full p-4 text-center">
                <div className="text-error">{error}</div>
              </div>
            )}
            
            {log && log.entries.length === 0 && (
              <div className="flex items-center justify-center h-full text-text-muted">
                No history found
              </div>
            )}
            
            {log && log.entries.length > 0 && (
              <div className="divide-y divide-border">
                {log.entries.map((entry) => (
                  <div
                    key={entry.revision}
                    onClick={() => setSelectedEntry(entry)}
                    className={`p-3 cursor-pointer transition-colors ${
                      selectedEntry?.revision === entry.revision
                        ? 'bg-accent/10 border-l-2 border-l-accent'
                        : 'hover:bg-bg-elevated border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-accent font-medium">
                        r{entry.revision}
                      </span>
                      <span className="text-xs text-text-muted flex-1 truncate">
                        {entry.author}
                      </span>
                    </div>
                    <div className="text-xs text-text-secondary line-clamp-2">
                      {entry.message || <span className="italic text-text-faint">No message</span>}
                    </div>
                    <div className="text-xs text-text-faint mt-1">
                      {formatDate(entry.date)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Selected entry details */}
          <div className="flex-1 overflow-auto bg-bg">
            {selectedEntry ? (
              <div className="p-4">
                {/* Revision header */}
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
                  <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center">
                    <GitCommit className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <div className="text-xl font-mono font-medium text-text">
                      Revision {selectedEntry.revision}
                    </div>
                    <div className="text-sm text-text-secondary">
                      {pathName}
                    </div>
                  </div>
                </div>
                
                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-text-muted" />
                    <span className="text-text-secondary">Author:</span>
                    <span className="text-text font-medium">{selectedEntry.author}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-text-muted" />
                    <span className="text-text-secondary">Date:</span>
                    <span className="text-text font-medium">
                      {formatDateFull(selectedEntry.date)}
                    </span>
                  </div>
                </div>
                
                {/* Message */}
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-text-secondary mb-2">Message</h4>
                  <div className="bg-bg-secondary rounded-lg p-3 text-sm text-text whitespace-pre-wrap">
                    {selectedEntry.message || <span className="italic text-text-faint">No commit message</span>}
                  </div>
                </div>
                
                {/* Changed paths */}
                {selectedEntry.paths.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-text-secondary mb-2">
                      Changed Paths ({selectedEntry.paths.length})
                    </h4>
                    <div className="bg-bg-secondary rounded-lg overflow-hidden">
                      {selectedEntry.paths.slice(0, 20).map((p, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border last:border-0"
                        >
                          <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                            p.action === 'A' ? 'bg-svn-added/20 text-svn-added' :
                            p.action === 'D' ? 'bg-svn-deleted/20 text-svn-deleted' :
                            p.action === 'R' ? 'bg-svn-replaced/20 text-svn-replaced' :
                            'bg-svn-modified/20 text-svn-modified'
                          }`}>
                            {p.action}
                          </span>
                          <span className="text-text-secondary truncate flex-1">
                            {p.path}
                          </span>
                        </div>
                      ))}
                      {selectedEntry.paths.length > 20 && (
                        <div className="px-3 py-2 text-sm text-text-muted text-center">
                          ...and {selectedEntry.paths.length - 20} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Actions */}
                {onSelectRevision && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <button
                      onClick={() => onSelectRevision(selectedEntry.revision, path)}
                      className="btn btn-secondary"
                    >
                      View Diff for this Revision
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted">
                <div className="text-center">
                  <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Select a revision to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        {log && log.entries.length > 0 && (
          <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-t border-border text-sm text-text-secondary">
            Showing {log.entries.length} revisions (r{log.startRevision} - r{log.endRevision})
          </div>
        )}
      </div>
    </div>
  )
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) {
    return 'Today ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return `${diffDays} days ago`
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
}

function formatDateFull(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
