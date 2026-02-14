import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, User, Search, Loader2 } from 'lucide-react'

interface BlameViewerProps {
  isOpen: boolean
  filePath: string
  onClose: () => void
  startRevision?: string
  endRevision?: string
}

interface BlameLine {
  lineNumber: number
  revision: number
  author: string
  date: string
  content: string
  isMerged?: boolean
  mergedFrom?: string
}

export function BlameViewer({ isOpen, onClose, filePath, startRevision, endRevision }: BlameViewerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightRevision, setHighlightRevision] = useState<number | null>(null)
  
  // Fetch blame data
  const { data: blameData, isLoading, error } = useQuery({
    queryKey: ['svn:blame', filePath, startRevision, endRevision],
    queryFn: async (): Promise<BlameLine[]> => {
      const startRev = startRevision ? parseInt(startRevision, 10) : undefined
      const endRev = endRevision ? parseInt(endRevision, 10) : undefined
      
      const result = await window.api.svn.blame(filePath, startRev, endRev)
      
      return result.lines.map(line => ({
        lineNumber: line.lineNumber,
        revision: line.revision,
        author: line.author,
        date: line.date,
        content: line.content
      }))
    },
    enabled: isOpen && !!filePath,
  })
  
  // Filter lines by search
  const filteredLines = blameData?.filter(line => 
    searchQuery === '' || 
    line.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    line.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
    line.revision.toString().includes(searchQuery)
  )
  
  // Get unique authors for legend
  const authors = blameData 
    ? [...new Set(blameData.map(l => l.author))].map(author => ({
        author,
        color: getAuthorColor(author)
      }))
    : []
  
  // Get unique revisions
  const revisions = blameData 
    ? [...new Set(blameData.map(l => l.revision))].sort((a, b) => b - a)
    : []
  
  if (!isOpen) return null
  
  const filename = filePath.split(/[/\\]/).pop() || filePath
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[900px] max-h-[90vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <User className="w-5 h-5 text-accent" />
            Blame: {filename}
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Toolbar */}
        <div className="flex items-center gap-4 px-4 py-2 bg-bg-tertiary border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search content, author, or revision..."
              className="input pl-8"
            />
          </div>
          
          {highlightRevision && (
            <button
              onClick={() => setHighlightRevision(null)}
              className="text-sm text-accent"
            >
              Clear highlight (r{highlightRevision})
            </button>
          )}
        </div>
        
        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2 bg-bg-secondary border-b border-border overflow-x-auto">
          <span className="text-xs text-text-muted">Authors:</span>
          {authors.map(({ author, color }) => (
            <div key={author} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded ${color}`} />
              <span className="text-xs text-text-secondary">{author}</span>
            </div>
          ))}
        </div>
        
        {/* Content */}
        <div className="modal-body overflow-auto max-h-[60vh] font-mono text-sm">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-error">
              Failed to load blame data
            </div>
          ) : !filteredLines?.length ? (
            <div className="text-center py-8 text-text-muted">
              No results found
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-bg-primary">
                <tr className="text-left text-xs text-text-muted">
                  <th className="px-2 py-1 w-12 border-b border-border">Line</th>
                  <th className="px-2 py-1 w-16 border-b border-border">Rev</th>
                  <th className="px-2 py-1 w-24 border-b border-border">Author</th>
                  <th className="px-2 py-1 w-32 border-b border-border">Date</th>
                  <th className="px-2 py-1 border-b border-border">Content</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((line) => (
                  <tr
                    key={line.lineNumber}
                    className={`hover:bg-bg-tertiary cursor-pointer ${
                      highlightRevision === line.revision ? 'bg-accent/20' : ''
                    }`}
                    onClick={() => setHighlightRevision(
                      highlightRevision === line.revision ? null : line.revision
                    )}
                  >
                    <td className="px-2 py-0.5 text-text-faint border-r border-border">
                      {line.lineNumber}
                    </td>
                    <td className="px-2 py-0.5 text-accent border-r border-border">
                      r{line.revision}
                    </td>
                    <td className={`px-2 py-0.5 border-r border-border ${getAuthorColor(line.author).replace('bg-', 'text-')}`}>
                      {line.author}
                    </td>
                    <td className="px-2 py-0.5 text-text-faint border-r border-border">
                      {new Date(line.date).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-0.5 whitespace-pre">
                      {line.content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <div className="flex-1 text-sm text-text-faint">
            {filteredLines?.length || 0} lines
            {revisions.length > 0 && `, ${revisions.length} revisions`}
          </div>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// Generate consistent colors for authors
function getAuthorColor(author: string): string {
  const colors = [
    'bg-red-500/30',
    'bg-blue-500/30',
    'bg-green-500/30',
    'bg-yellow-500/30',
    'bg-purple-500/30',
    'bg-pink-500/30',
    'bg-indigo-500/30',
    'bg-teal-500/30',
  ]
  
  let hash = 0
  for (let i = 0; i < author.length; i++) {
    hash = author.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  return colors[Math.abs(hash) % colors.length]
}
