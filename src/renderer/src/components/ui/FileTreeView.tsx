import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, File, RefreshCw, ChevronsDown, ChevronsUp } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileInfo, SvnStatusChar } from '@shared/types'
import { StatusDot } from './StatusIcon'

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  depth: number
  svnStatus?: SvnStatusChar
  revision?: number
  author?: string
  isExpanded?: boolean
  children?: TreeNode[]
  parent?: TreeNode | null
}

interface FileTreeViewProps {
  files: FileInfo[]
  onFileSelect?: (path: string, isDirectory: boolean) => void
  onFileDoubleClick?: (path: string, isDirectory: boolean) => void
  selectedPaths?: Set<string>
  showStatus?: boolean
  defaultExpanded?: boolean
  expandAll?: boolean
  onExpandChange?: (path: string, isExpanded: boolean) => void
  onRefresh?: () => void
  maxHeight?: number
  /** Accessibility label for the tree */
  ariaLabel?: string
  /** ID of element that labels this tree */
  ariaLabelledby?: string
}

export function FileTreeView({
  files,
  onFileSelect,
  onFileDoubleClick,
  selectedPaths = new Set(),
  showStatus = true,
  defaultExpanded = false,
  expandAll = false,
  onExpandChange,
  onRefresh,
  maxHeight = 600,
  ariaLabel = 'File tree',
  ariaLabelledby
}: FileTreeViewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)
  const focusedItemRef = useRef<HTMLDivElement>(null)

  // Build tree structure from flat file list
  const tree = useMemo(() => {
    const rootNodes: TreeNode[] = []
    const nodeMap = new Map<string, TreeNode>()

    // First pass: create all nodes
    for (const file of files) {
      const parts = file.path.split(/[/\\]/)
      const depth = parts.length - 1

      const node: TreeNode = {
        name: file.name,
        path: file.path,
        isDirectory: file.isDirectory,
        depth,
        svnStatus: file.svnStatus?.status,
        revision: file.svnStatus?.revision,
        author: file.svnStatus?.author,
        isExpanded: defaultExpanded || expandAll,
        children: file.isDirectory ? [] : undefined
      }

      nodeMap.set(file.path, node)
    }

    // Second pass: build hierarchy
    for (const file of files) {
      const node = nodeMap.get(file.path)!
      const parts = file.path.split(/[/\\]/)
      
      if (parts.length === 1) {
        // Root level
        rootNodes.push(node)
      } else {
        // Find parent
        const parentPath = parts.slice(0, -1).join(file.path.includes('\\') ? '\\' : '/')
        const parent = nodeMap.get(parentPath)
        if (parent && parent.children) {
          parent.children.push(node)
          node.parent = parent
        }
      }
    }

    // Sort each level: directories first, then files, alphabetically
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      for (const node of nodes) {
        if (node.children) {
          sortNodes(node.children)
        }
      }
    }
    sortNodes(rootNodes)

    return rootNodes
  }, [files, defaultExpanded, expandAll])

  // Flatten tree to visible items (respecting expanded state)
  const visibleItems = useMemo(() => {
    const items: TreeNode[] = []

    const traverse = (nodes: TreeNode[], expandedSet: Set<string>) => {
      for (const node of nodes) {
        items.push(node)
        if (node.isDirectory && expandedSet.has(node.path) && node.children) {
          traverse(node.children, expandedSet)
        }
      }
    }

    traverse(tree, expandedPaths)
    return items
  }, [tree, expandedPaths])

  // Virtualizer for large trees
  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10
  })

  // Toggle expand/collapse
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
        onExpandChange?.(path, false)
      } else {
        next.add(path)
        onExpandChange?.(path, true)
      }
      return next
    })
  }, [onExpandChange])

  // Expand all
  const handleExpandAll = useCallback(() => {
    const allDirPaths = new Set<string>()
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.isDirectory) {
          allDirPaths.add(node.path)
          if (node.children) traverse(node.children)
        }
      }
    }
    traverse(tree)
    setExpandedPaths(allDirPaths)
  }, [tree])

  // Collapse all
  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])

  // Handle click
  const handleClick = useCallback((node: TreeNode) => {
    if (node.isDirectory) {
      toggleExpand(node.path)
    }
    onFileSelect?.(node.path, node.isDirectory)
    setFocusedPath(node.path)
  }, [toggleExpand, onFileSelect])

  // Handle double click
  const handleDoubleClick = useCallback((node: TreeNode) => {
    onFileDoubleClick?.(node.path, node.isDirectory)
  }, [onFileDoubleClick])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!focusedPath) return

    const currentIndex = visibleItems.findIndex(item => item.path === focusedPath)
    if (currentIndex === -1) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (currentIndex < visibleItems.length - 1) {
          setFocusedPath(visibleItems[currentIndex + 1].path)
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (currentIndex > 0) {
          setFocusedPath(visibleItems[currentIndex - 1].path)
        }
        break
      case 'ArrowRight':
        e.preventDefault()
        {
          const node = visibleItems[currentIndex]
          if (node.isDirectory && !expandedPaths.has(node.path)) {
            toggleExpand(node.path)
          }
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        {
          const node = visibleItems[currentIndex]
          if (node.isDirectory && expandedPaths.has(node.path)) {
            toggleExpand(node.path)
          } else if (node.parent) {
            setFocusedPath(node.parent.path)
          }
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        {
          const node = visibleItems[currentIndex]
          handleClick(node)
        }
        break
    }
  }, [focusedPath, visibleItems, expandedPaths, toggleExpand, handleClick])

  // Render tree item
  const renderTreeItem = (node: TreeNode, index: number) => {
    const isExpanded = expandedPaths.has(node.path)
    const isSelected = selectedPaths.has(node.path)
    const isFocused = focusedPath === node.path
    const statusLabel = node.svnStatus && node.svnStatus !== ' '
      ? getStatusLabel(node.svnStatus)
      : undefined

    return (
      <div
        key={node.path}
        ref={isFocused ? focusedItemRef : null}
        className={`
          flex items-center gap-1 py-1 px-2 cursor-pointer select-none
          transition-colors duration-75
          ${isSelected ? 'bg-accent/20' : 'hover:bg-bg-elevated'}
          ${isFocused ? 'bg-accent/10 ring-1 ring-accent/50' : ''}
        `}
        style={{
          paddingLeft: `${node.depth * 16 + 8}px`,
          height: '28px'
        }}
        onClick={() => handleClick(node)}
        onDoubleClick={() => handleDoubleClick(node)}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={node.isDirectory ? isExpanded : undefined}
        aria-level={node.depth + 1}
        aria-setsize={visibleItems.length}
        aria-posinset={index + 1}
        tabIndex={isFocused ? 0 : -1}
        aria-label={statusLabel ? `${node.name}, ${statusLabel}` : node.name}
      >
        {/* Expand/collapse toggle */}
        {node.isDirectory ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleExpand(node.path)
            }}
            className="w-4 h-4 flex items-center justify-center flex-shrink-0 hover:bg-bg-elevated rounded"
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            tabIndex={-1}
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-text-muted" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-muted" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="w-4" aria-hidden="true" />
        )}

        {/* Icon */}
        {node.isDirectory ? (
          isExpanded ? (
            <FolderOpen className="w-4 h-4 text-accent flex-shrink-0" aria-hidden="true" />
          ) : (
            <Folder className="w-4 h-4 text-accent flex-shrink-0" aria-hidden="true" />
          )
        ) : (
          <File className="w-4 h-4 text-text-muted flex-shrink-0" aria-hidden="true" />
        )}

        {/* Name */}
        <span className="flex-1 truncate text-sm text-text">
          {node.name}
        </span>

        {/* Status */}
        {showStatus && node.svnStatus && node.svnStatus !== ' ' && (
          <StatusDot status={node.svnStatus} aria-label={statusLabel} />
        )}
      </div>
    )
  }

  // Get status label for screen readers
  function getStatusLabel(status: SvnStatusChar): string | undefined {
    const labels: Record<SvnStatusChar, string> = {
      ' ': 'Normal',
      'A': 'Added',
      'C': 'Conflicted',
      'D': 'Deleted',
      'I': 'Ignored',
      'M': 'Modified',
      'R': 'Replaced',
      'X': 'External',
      '?': 'Unversioned',
      '!': 'Missing',
      '~': 'Obstructed'
    }
    return labels[status]
  }

  // Scroll focused item into view
  useEffect(() => {
    if (focusedItemRef.current) {
      focusedItemRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedPath])

  // Focus the tree container when focusedPath changes
  useEffect(() => {
    if (focusedPath && parentRef.current && document.activeElement !== parentRef.current) {
      // If a focused item exists but tree doesn't have focus, don't steal focus
      // Focus will be managed when user interacts with the tree
    }
  }, [focusedPath])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-2 py-1 border-b border-border bg-bg-secondary"
        role="toolbar"
        aria-label="File tree controls"
      >
        <button
          onClick={handleExpandAll}
          className="btn-icon-sm"
          title="Expand All"
          aria-label="Expand all folders"
        >
          <ChevronsDown className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={handleCollapseAll}
          className="btn-icon-sm"
          title="Collapse All"
          aria-label="Collapse all folders"
        >
          <ChevronsUp className="w-4 h-4" aria-hidden="true" />
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="btn-icon-sm"
            title="Refresh"
            aria-label="Refresh file tree"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
        <div className="flex-1" role="presentation" />
        <span className="text-xs text-text-muted" aria-live="polite" aria-atomic="true">
          {visibleItems.length} items
        </span>
      </div>

      {/* Tree */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        style={{ maxHeight }}
        role="tree"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-multiselectable={selectedPaths.size > 1}
      >
        {visibleItems.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-text-muted text-sm"
            role="status"
            aria-live="polite"
          >
            No files to display
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }}
            role="presentation"
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const node = visibleItems[virtualItem.index]
              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                  role="presentation"
                >
                  {renderTreeItem(node, virtualItem.index)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Hook to manage tree view state
 */
export function useFileTreeView(_initialExpanded = false) {
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'list' ? 'tree' : 'list')
  }, [])

  const expandPath = useCallback((path: string) => {
    setExpandedPaths(prev => new Set(prev).add(path))
  }, [])

  const collapsePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const expandAll = useCallback((paths: string[]) => {
    setExpandedPaths(new Set(paths))
  }, [])

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])

  return {
    viewMode,
    setViewMode,
    toggleViewMode,
    expandedPaths,
    expandPath,
    collapsePath,
    togglePath,
    expandAll,
    collapseAll,
    isExpanded: (path: string) => expandedPaths.has(path)
  }
}

export default FileTreeView
