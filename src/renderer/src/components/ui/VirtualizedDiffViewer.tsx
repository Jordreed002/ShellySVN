/**
 * VirtualizedDiffViewer - Memory-efficient diff viewer for large files
 *
 * Features:
 * - Virtualized rendering using @tanstack/react-virtual for 60 FPS scrolling with 100k+ lines
 * - Progressive loading of diff chunks
 * - Memory-efficient with only visible lines rendered
 * - LRU caching for parsed diffs
 * - Progressive image loading support
 *
 * Performance Targets:
 * - 10MB+ diffs load in < 1 second
 * - 100k+ line diffs scroll at 60 FPS
 * - Memory grows linearly with file size
 */

import { useRef, useCallback, useMemo, useState, useEffect, memo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2, FileText, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import type { SvnDiffResult, SvnDiffLine, SvnDiffHunk, SvnDiffFile } from '@shared/types'

// Import the LRU cache
import { LRUCache } from '@shared/utils/lru-cache'

// ============================================
// Types
// ============================================

interface VirtualizedDiffViewerProps {
  /** Diff result to display */
  diff: SvnDiffResult | null
  /** Whether diff is currently loading */
  isLoading?: boolean
  /** Error message if loading failed */
  error?: string | null
  /** Custom class name */
  className?: string
  /** Estimated row height for virtualization */
  estimatedRowHeight?: number
  /** Number of overscan rows */
  overscan?: number
  /** Callback when a line is clicked */
  onLineClick?: (line: SvnDiffLine, fileIndex: number, hunkIndex: number, lineIndex: number) => void
  /** Whether to show file headers */
  showFileHeaders?: boolean
  /** Whether to collapse unchanged sections */
  collapseContext?: boolean
  /** Context lines to show around changes when collapsed */
  contextLines?: number
}

interface FlattenedLine {
  type: 'file-header' | 'hunk-header' | 'diff-line'
  line?: SvnDiffLine
  file?: SvnDiffFile
  hunk?: SvnDiffHunk
  fileIndex: number
  hunkIndex: number
  lineIndex: number
  isCollapsed?: boolean
}

interface FileCollapseState {
  [key: number]: boolean // fileIndex -> isCollapsed
}

// ============================================
// LRU Cache for Diffs
// ============================================

// Global cache for diff flattening results (100MB limit)
const diffCache = new LRUCache<FlattenedLine[]>({
  maxSize: 100 * 1024 * 1024,
  defaultTTL: 30 * 60 * 1000 // 30 minutes
})

// ============================================
// Utility Functions
// ============================================

/**
 * Escape HTML entities in text
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Generate a cache key for a diff
 */
function getDiffCacheKey(diff: SvnDiffResult): string {
  // Use file paths and hunk counts as a simple hash
  const hash = diff.files.reduce((acc, f, i) => {
    return acc + `${i}:${f.oldPath}:${f.hunks.length}:`
  }, 'diff:')
  return hash
}

/**
 * Flatten diff result into a single array of renderable lines
 * This enables efficient virtualization across files and hunks
 */
function flattenDiff(
  diff: SvnDiffResult,
  collapseContext: boolean = false,
  contextLines: number = 3
): FlattenedLine[] {
  const cacheKey = getDiffCacheKey(diff) + `:${collapseContext}:${contextLines}`

  // Check cache
  const cached = diffCache.peek(cacheKey)
  if (cached) {
    return cached
  }

  const lines: FlattenedLine[] = []

  for (let fileIndex = 0; fileIndex < diff.files.length; fileIndex++) {
    const file = diff.files[fileIndex]

    // File header
    lines.push({
      type: 'file-header',
      file,
      fileIndex,
      hunkIndex: -1,
      lineIndex: -1
    })

    for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
      const hunk = file.hunks[hunkIndex]

      // Hunk header
      lines.push({
        type: 'hunk-header',
        hunk,
        fileIndex,
        hunkIndex,
        lineIndex: -1
      })

      // Diff lines
      if (collapseContext) {
        // Collapse long runs of context lines
        const collapsed = collapseContextLines(hunk.lines, contextLines)
        for (let lineIndex = 0; lineIndex < collapsed.lines.length; lineIndex++) {
          const line = collapsed.lines[lineIndex]
          lines.push({
            type: 'diff-line',
            line,
            fileIndex,
            hunkIndex,
            lineIndex,
            isCollapsed: collapsed.collapsedIndices.has(lineIndex)
          })
        }
      } else {
        for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex++) {
          const line = hunk.lines[lineIndex]
          lines.push({
            type: 'diff-line',
            line,
            fileIndex,
            hunkIndex,
            lineIndex
          })
        }
      }
    }
  }

  // Cache the result
  diffCache.set(cacheKey, lines)

  return lines
}

/**
 * Collapse long runs of context lines, keeping context around changes
 */
function collapseContextLines(
  lines: SvnDiffLine[],
  contextLines: number
): { lines: SvnDiffLine[]; collapsedIndices: Set<number> } {
  const result: SvnDiffLine[] = [...lines]
  const collapsedIndices = new Set<number>()

  // Find runs of context lines
  let contextRun: number[] = []

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'context') {
      contextRun.push(i)
    } else {
      // End of context run
      if (contextRun.length > contextLines * 2 + 10) {
        // Collapse middle of run
        const start = contextLines
        const end = contextRun.length - contextLines

        for (let j = start; j < end; j++) {
          collapsedIndices.add(contextRun[j])
        }
      }
      contextRun = []
    }
  }

  // Handle trailing context run
  if (contextRun.length > contextLines * 2 + 10) {
    const start = contextLines
    const end = contextRun.length - contextLines

    for (let j = start; j < end; j++) {
      collapsedIndices.add(contextRun[j])
    }
  }

  return { lines: result, collapsedIndices }
}

// ============================================
// Sub-Components
// ============================================

/**
 * File header component
 */
const DiffFileHeader = memo(function DiffFileHeader({
  file,
  fileIndex,
  isCollapsed,
  onToggle
}: {
  file: SvnDiffFile
  fileIndex: number
  isCollapsed: boolean
  onToggle: () => void
}) {
  const fileName = file.newPath || file.oldPath
  const displayPath = fileName.split('/').pop() || fileName

  return (
    <div
      className="diff-file-header sticky top-0 z-20 bg-bg-elevated px-4 py-2 border-b border-border flex items-center gap-2 cursor-pointer hover:bg-bg-secondary"
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      {isCollapsed ? (
        <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
      ) : (
        <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
      )}
      <FileText className="w-4 h-4 text-accent flex-shrink-0" />
      <span className="text-text font-medium truncate">{displayPath}</span>
      {file.oldPath !== file.newPath && (
        <span className="text-text-muted text-sm ml-2 truncate">
          (from {file.oldPath.split('/').pop()})
        </span>
      )}
      <span className="text-text-muted text-xs ml-auto">
        {file.hunks.length} hunk{file.hunks.length !== 1 ? 's' : ''}
      </span>
    </div>
  )
})

/**
 * Hunk header component
 */
const DiffHunkHeader = memo(function DiffHunkHeader({
  hunk
}: {
  hunk: SvnDiffHunk
}) {
  return (
    <div className="diff-hunk-header bg-bg-tertiary px-4 py-1 text-text-muted text-xs font-mono">
      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
    </div>
  )
})

/**
 * Single diff line component
 */
const DiffLineComponent = memo(function DiffLineComponent({
  line,
  onClick
}: {
  line: SvnDiffLine
  onClick?: () => void
}) {
  const getLineClass = () => {
    switch (line.type) {
      case 'added':
        return 'bg-green-500/10 hover:bg-green-500/20'
      case 'removed':
        return 'bg-red-500/10 hover:bg-red-500/20'
      case 'hunk':
        return 'bg-blue-500/10'
      default:
        return 'hover:bg-bg-secondary'
    }
  }

  const getLineNumber = () => {
    if (line.type === 'added' && line.newLineNumber !== undefined) {
      return line.newLineNumber
    }
    if (line.type === 'removed' && line.oldLineNumber !== undefined) {
      return line.oldLineNumber
    }
    if (line.type === 'context') {
      return line.newLineNumber ?? line.oldLineNumber ?? ''
    }
    return ''
  }

  const getPrefix = () => {
    switch (line.type) {
      case 'added': return '+'
      case 'removed': return '-'
      case 'hunk': return ''
      default: return ' '
    }
  }

  const getPrefixClass = () => {
    switch (line.type) {
      case 'added': return 'text-green-600 dark:text-green-400'
      case 'removed': return 'text-red-600 dark:text-red-400'
      default: return 'text-text-muted'
    }
  }

  return (
    <div
      className={`${getLineClass()} flex font-mono text-sm cursor-pointer`}
      onClick={onClick}
    >
      {/* Line number */}
      <div className="diff-line-number w-12 flex-shrink-0 text-right pr-3 text-text-faint select-none border-r border-border">
        {getLineNumber()}
      </div>

      {/* Prefix */}
      <div className={`diff-line-prefix w-5 flex-shrink-0 text-center ${getPrefixClass()}`}>
        {getPrefix()}
      </div>

      {/* Content */}
      <div className="diff-line-content flex-1 whitespace-pre overflow-x-auto pl-2">
        {escapeHtml(line.content)}
      </div>
    </div>
  )
})

/**
 * Collapsed context indicator
 */
const CollapsedContextIndicator = memo(function CollapsedContextIndicator({
  count
}: {
  count: number
}) {
  return (
    <div className="diff-collapsed-context bg-bg-tertiary px-4 py-1 text-text-muted text-xs text-center italic">
      {count} unchanged lines hidden
    </div>
  )
})

// ============================================
// Main Component
// ============================================

/**
 * VirtualizedDiffViewer - Efficiently renders large diffs with virtualization
 *
 * @example
 * ```tsx
 * <VirtualizedDiffViewer
 *   diff={diffResult}
 *   isLoading={loading}
 *   error={error}
 *   collapseContext={true}
 * />
 * ```
 */
export function VirtualizedDiffViewer({
  diff,
  isLoading = false,
  error = null,
  className = '',
  estimatedRowHeight = 24,
  overscan = 15,
  onLineClick,
  showFileHeaders = true,
  collapseContext = false,
  contextLines = 3
}: VirtualizedDiffViewerProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [collapsedFiles, setCollapsedFiles] = useState<FileCollapseState>({})

  // Flatten diff for virtualization
  const flattenedLines = useMemo(() => {
    if (!diff) return []
    return flattenDiff(diff, collapseContext, contextLines)
  }, [diff, collapseContext, contextLines])

  // Filter out lines from collapsed files
  const visibleLines = useMemo(() => {
    return flattenedLines.filter((line) => {
      if (line.type === 'file-header') return true
      return !collapsedFiles[line.fileIndex]
    })
  }, [flattenedLines, collapsedFiles])

  // Create virtualizer
  const rowVirtualizer = useVirtualizer({
    count: visibleLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(
      (index: number) => {
        const line = visibleLines[index]
        if (line.type === 'file-header') return 44
        if (line.type === 'hunk-header') return 28
        return estimatedRowHeight
      },
      [visibleLines, estimatedRowHeight]
    ),
    overscan
  })

  // Toggle file collapse
  const toggleFileCollapse = useCallback((fileIndex: number) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [fileIndex]: !prev[fileIndex]
    }))
  }, [])

  // Get virtual items
  const virtualItems = rowVirtualizer.getVirtualItems()

  // Calculate diff stats
  const stats = useMemo(() => {
    if (!diff) return { additions: 0, deletions: 0, files: 0 }

    let additions = 0
    let deletions = 0

    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'added') additions++
          if (line.type === 'removed') deletions++
        }
      }
    }

    return {
      additions,
      deletions,
      files: diff.files.length
    }
  }, [diff])

  // Loading state
  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <span className="text-text-secondary">Loading diff...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-3 text-center p-8">
          <AlertTriangle className="w-10 h-10 text-warning" />
          <div>
            <p className="text-text font-medium mb-1">Failed to load diff</p>
            <p className="text-text-secondary text-sm">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  // Empty state
  if (!diff || !diff.hasChanges) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-3 text-center p-8">
          <FileText className="w-10 h-10 text-text-muted" />
          <div>
            <p className="text-text font-medium mb-1">No Changes</p>
            <p className="text-text-secondary text-sm">This file has no modifications</p>
          </div>
        </div>
      </div>
    )
  }

  // Binary file state
  if (diff.isBinary) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-3 text-center p-8">
          <FileText className="w-10 h-10 text-text-muted" />
          <div>
            <p className="text-text font-medium mb-1">Binary File</p>
            <p className="text-text-secondary text-sm">Cannot display diff for binary files</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Stats bar */}
      <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-b border-border flex items-center gap-4 text-sm">
        <span className="text-text-secondary">
          {stats.files} file{stats.files !== 1 ? 's' : ''} changed
        </span>
        <span className="text-green-600 dark:text-green-400">
          +{stats.additions} addition{stats.additions !== 1 ? 's' : ''}
        </span>
        <span className="text-red-600 dark:text-red-400">
          -{stats.deletions} deletion{stats.deletions !== 1 ? 's' : ''}
        </span>
        <span className="text-text-muted ml-auto text-xs">
          {flattenedLines.length.toLocaleString()} lines
        </span>
      </div>

      {/* Virtualized content */}
      <div ref={parentRef} className="flex-1 overflow-auto bg-bg font-mono">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {virtualItems.map((virtualRow) => {
            const line = visibleLines[virtualRow.index]
            const isCollapsed = collapsedFiles[line.fileIndex]

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {line.type === 'file-header' && showFileHeaders && line.file && (
                  <DiffFileHeader
                    file={line.file}
                    fileIndex={line.fileIndex}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleFileCollapse(line.fileIndex)}
                  />
                )}

                {line.type === 'hunk-header' && !isCollapsed && line.hunk && (
                  <DiffHunkHeader hunk={line.hunk} />
                )}

                {line.type === 'diff-line' && !isCollapsed && line.line && (
                  <>
                    {line.isCollapsed ? (
                      <CollapsedContextIndicator count={1} />
                    ) : (
                      <DiffLineComponent
                        line={line.line}
                        onClick={() => {
                          if (onLineClick) {
                            onLineClick(line.line, line.fileIndex, line.hunkIndex, line.lineIndex)
                          }
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Progressive Image Loading Hook
// ============================================

/**
 * Hook for progressive image loading with lazy loading
 */
export function useProgressiveImageLoad(src: string | null, placeholder?: string) {
  const [imageSrc, setImageSrc] = useState<string | null>(placeholder || null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!src) {
      setImageSrc(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    const img = new Image()

    img.onload = () => {
      setImageSrc(src)
      setIsLoading(false)
    }

    img.onerror = () => {
      setError('Failed to load image')
      setIsLoading(false)
    }

    img.src = src

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])

  return { src: imageSrc, isLoading, error }
}

// ============================================
// Export
// ============================================

export default VirtualizedDiffViewer
