import { useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SvnLogEntry } from '@shared/types'

// Commit row component
function CommitRow({ entry }: { entry: SvnLogEntry }) {
  const date = new Date(entry.date).toLocaleString()
  
  return (
    <div className="flex gap-4 px-4 py-3 border-b border-[#3c3c3c] hover:bg-[#2a2d2e]">
      <div className="w-20 flex-shrink-0">
        <span className="px-2 py-1 bg-[#0e639c] rounded text-xs font-mono">
          r{entry.revision}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[#4fc3f7] text-sm">{entry.author}</span>
          <span className="text-[#666] text-xs">{date}</span>
        </div>
        <p className="text-sm text-[#ccc] line-clamp-2 whitespace-pre-wrap">
          {entry.message || <span className="text-[#666] italic">No commit message</span>}
        </p>
      </div>
    </div>
  )
}

export function CommitHistory() {
  const { path } = useSearch({ from: '/history/' })
  const parentRef = useRef<HTMLDivElement>(null)
  
  // Fetch commit history
  const { data, isLoading, error } = useQuery({
    queryKey: ['svn:log', path],
    queryFn: () => window.api.svn.log(path, 100),
    enabled: !!path && path !== '/'
  })
  
  // Virtualizer
  const virtualizer = useVirtualizer({
    count: data?.entries.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5
  })
  
  if (!path || path === '/') {
    return (
      <div className="flex-1 flex items-center justify-center text-[#888]">
        No working copy selected
      </div>
    )
  }
  
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#888]">
        Loading history...
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#f44336]">
        Error: {(error as Error).message}
      </div>
    )
  }
  
  const entries = data?.entries || []
  
  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="h-[48px] flex items-center px-4 border-b border-[#3c3c3c] bg-[#252526]">
        <span className="text-sm text-[#888]">Commit History</span>
        <span className="ml-auto text-sm text-[#666]">{entries.length} commits</span>
      </div>
      
      {/* Commit list */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#888]">
            No commits found
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative'
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <CommitRow entry={entry} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
