import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { 
  RefreshCw, 
  Folder, 
  FileText, 
  AlertCircle,
  Loader2
} from 'lucide-react'

interface RepoBrowserProps {
  isOpen?: boolean
  repoUrl?: string
  onNavigate?: (path: string) => void
  onClose?: () => void
}

interface RepoEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  revision?: number
  author?: string
  date?: string
}

export function RepoBrowser({ isOpen = true, repoUrl, onNavigate, onClose }: RepoBrowserProps) {
  const [currentUrl, setCurrentUrl] = useState(repoUrl || '')
  const [pathHistory, setPathHistory] = useState<string[]>([])
  const parentRef = useRef<HTMLDivElement>(null)
  
  // Get repository info
  const { data: repoInfo, isLoading: isLoadingInfo } = useQuery({
    queryKey: ['svn:info', currentUrl],
    queryFn: () => window.api.svn.info(currentUrl),
    enabled: !!currentUrl,
  })
  
  // List repository contents
  const { data: entries, isLoading: isLoadingEntries, refetch } = useQuery({
    queryKey: ['repo:list', currentUrl],
    queryFn: async (): Promise<RepoEntry[]> => {
      const result = await window.api.svn.list(currentUrl, undefined, 'immediates')
      return result.entries.map(entry => ({
        name: entry.name,
        path: entry.url,
        isDirectory: entry.kind === 'dir',
        size: entry.size,
        revision: entry.revision,
        author: entry.author,
        date: entry.date
      }))
    },
    enabled: !!currentUrl,
  })
  
  // Virtualizer
  const virtualizer = useVirtualizer({
    count: entries?.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10
  })
  
  const handleNavigate = (entry: RepoEntry) => {
    if (entry.isDirectory) {
      setPathHistory([...pathHistory, currentUrl])
      setCurrentUrl(entry.path)
    } else if (onNavigate) {
      onNavigate(entry.path)
    }
  }
  
  const handleBack = () => {
    if (pathHistory.length > 0) {
      const previousUrl = pathHistory[pathHistory.length - 1]
      setPathHistory(pathHistory.slice(0, -1))
      setCurrentUrl(previousUrl)
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-border">
        <button
          onClick={handleBack}
          disabled={pathHistory.length === 0}
          className="btn btn-secondary btn-sm"
        >
          Back
        </button>
        
        <button
          onClick={() => refetch()}
          className="btn btn-secondary btn-sm"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        
        <div className="flex-1" />
        
        {onClose && (
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Close
          </button>
        )}
      </div>
      
      {/* URL Bar */}
      <div className="px-4 py-2 bg-bg-tertiary border-b border-border">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={currentUrl}
            onChange={(e) => setCurrentUrl(e.target.value)}
            placeholder="Enter repository URL..."
            className="input flex-1 text-sm"
          />
          <button
            onClick={() => refetch()}
            className="btn btn-primary btn-sm"
          >
            Go
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        {isLoadingInfo || isLoadingEntries ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        ) : !currentUrl ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <AlertCircle className="w-8 h-8 text-text-muted mb-2" />
            <p className="text-text-secondary">Enter a repository URL to browse</p>
          </div>
        ) : !entries || entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Folder className="w-8 h-8 text-text-muted mb-2" />
            <p className="text-text-secondary">This folder is empty</p>
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index]
              return (
                <div
                  key={entry.path}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-bg-tertiary cursor-pointer transition-fast"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  onClick={() => handleNavigate(entry)}
                  onDoubleClick={() => handleNavigate(entry)}
                >
                  {entry.isDirectory ? (
                    <Folder className="w-4 h-4 text-accent" />
                  ) : (
                    <FileText className="w-4 h-4 text-text-muted" />
                  )}
                  
                  <span className="flex-1 text-sm truncate">{entry.name}</span>
                  
                  {entry.revision && (
                    <span className="text-xs text-text-faint">r{entry.revision}</span>
                  )}
                  
                  {entry.author && (
                    <span className="text-xs text-text-faint">{entry.author}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Status bar */}
      <div className="px-4 py-2 bg-bg-secondary border-t border-border text-xs text-text-faint">
        {repoInfo && (
          <span>
            {repoInfo.repositoryRoot} - Revision {repoInfo.revision}
          </span>
        )}
      </div>
    </div>
  )
}
