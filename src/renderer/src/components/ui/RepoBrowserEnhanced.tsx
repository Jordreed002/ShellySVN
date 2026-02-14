import { useState, useCallback, useMemo } from 'react'
import { Folder, FolderOpen, File, RefreshCw, ChevronRight, ChevronDown, Search, Download, ExternalLink } from 'lucide-react'

/**
 * Repository browser node
 */
export interface RepoBrowserNode {
  name: string
  path: string
  url: string
  kind: 'file' | 'dir'
  size?: number
  revision: number
  author: string
  date: string
  isLoaded: boolean
  isLoading: boolean
  children: RepoBrowserNode[]
}

/**
 * Browser state
 */
export interface BrowserState {
  currentUrl: string
  currentNode: RepoBrowserNode | null
  pathHistory: string[]
  historyIndex: number
}

/**
 * Hook for repository browser functionality
 */
export function useRepoBrowser(repositoryUrl: string) {
  const [rootNode, setRootNode] = useState<RepoBrowserNode | null>(null)
  const [currentPath, setCurrentPath] = useState<string>('/')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [history, setHistory] = useState<string[]>(['/'])
  const [historyIndex, setHistoryIndex] = useState(0)
  
  /**
   * Load directory contents from repository
   */
  const loadDirectory = useCallback(async (path: string): Promise<RepoBrowserNode[]> => {
    const fullPath = path.startsWith('/') ? path : `/${path}`
    const url = `${repositoryUrl}${fullPath}`
    
    setLoadingPaths(prev => new Set(prev).add(path))
    
    try {
      const result = await window.api.svn.list(url)
      
      const nodes: RepoBrowserNode[] = result.entries.map(entry => ({
        name: entry.name,
        path: `${fullPath}/${entry.name}`.replace(/\/+/g, '/'),
        url: entry.url,
        kind: entry.kind,
        size: entry.size,
        revision: entry.revision,
        author: entry.author,
        date: entry.date,
        isLoaded: entry.kind === 'file',
        isLoading: false,
        children: []
      }))
      
      return nodes.sort((a, b) => {
        // Directories first, then files
        if (a.kind !== b.kind) {
          return a.kind === 'dir' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [repositoryUrl])
  
  /**
   * Initialize root node
   */
  const initialize = useCallback(async () => {
    const children = await loadDirectory('/')
    
    const root: RepoBrowserNode = {
      name: repositoryUrl.split('/').pop() || 'Repository',
      path: '/',
      url: repositoryUrl,
      kind: 'dir',
      revision: 0,
      author: '',
      date: '',
      isLoaded: true,
      isLoading: false,
      children
    }
    
    setRootNode(root)
    setExpandedPaths(new Set(['/']))
  }, [loadDirectory, repositoryUrl])
  
  /**
   * Expand a directory node
   */
  const expandNode = useCallback(async (node: RepoBrowserNode) => {
    if (node.kind !== 'dir' || node.isLoaded) return
    
    const children = await loadDirectory(node.path)
    
    // Update the node in the tree
    const updateNode = (current: RepoBrowserNode): RepoBrowserNode => {
      if (current.path === node.path) {
        return { ...current, children, isLoaded: true }
      }
      return {
        ...current,
        children: current.children.map(updateNode)
      }
    }
    
    if (rootNode) {
      setRootNode(updateNode(rootNode))
    }
  }, [loadDirectory, rootNode])
  
  /**
   * Toggle node expansion
   */
  const toggleExpand = useCallback(async (node: RepoBrowserNode) => {
    const path = node.path
    
    if (expandedPaths.has(path)) {
      setExpandedPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    } else {
      setExpandedPaths(prev => new Set(prev).add(path))
      await expandNode(node)
    }
  }, [expandedPaths, expandNode])
  
  /**
   * Navigate to a path
   */
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
    
    // Add to history
    setHistory(prev => {
      const newHistory = [...prev.slice(0, historyIndex + 1), path]
      return newHistory
    })
    setHistoryIndex(prev => prev + 1)
  }, [historyIndex])
  
  /**
   * Go back in history
   */
  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1)
      setCurrentPath(history[historyIndex - 1])
    }
  }, [historyIndex, history])
  
  /**
   * Go forward in history
   */
  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1)
      setCurrentPath(history[historyIndex + 1])
    }
  }, [historyIndex, history])
  
  /**
   * Refresh current directory
   */
  const refresh = useCallback(async () => {
    if (rootNode) {
      const children = await loadDirectory('/')
      setRootNode({ ...rootNode, children, isLoaded: true })
    }
  }, [loadDirectory, rootNode])
  
  /**
   * Get flattened visible nodes for rendering
   */
  const visibleNodes = useMemo(() => {
    if (!rootNode) return []
    
    const result: { node: RepoBrowserNode; depth: number }[] = []
    
    const flatten = (nodes: RepoBrowserNode[], depth: number) => {
      for (const node of nodes) {
        // Apply search filter
        if (searchQuery && !node.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          continue
        }
        
        result.push({ node, depth })
        
        if (expandedPaths.has(node.path) && node.kind === 'dir') {
          flatten(node.children, depth + 1)
        }
      }
    }
    
    flatten(rootNode.children, 0)
    return result
  }, [rootNode, expandedPaths, searchQuery])
  
  /**
   * Find node by path
   */
  const findNode = useCallback((path: string): RepoBrowserNode | null => {
    if (!rootNode) return null
    
    const find = (current: RepoBrowserNode): RepoBrowserNode | null => {
      if (current.path === path) return current
      for (const child of current.children) {
        const found = find(child)
        if (found) return found
      }
      return null
    }
    
    return find(rootNode)
  }, [rootNode])
  
  return {
    rootNode,
    currentPath,
    expandedPaths,
    loadingPaths,
    searchQuery,
    setSearchQuery,
    visibleNodes,
    initialize,
    toggleExpand,
    expandNode,
    navigateTo,
    goBack,
    goForward,
    refresh,
    findNode,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex < history.length - 1
  }
}

/**
 * Repository browser component props
 */
export interface RepoBrowserEnhancedProps {
  repositoryUrl: string
  onSelectFile?: (node: RepoBrowserNode) => void
  onCheckout?: (path: string) => void
  className?: string
}

/**
 * Enhanced repository browser component
 */
export function RepoBrowserEnhanced({
  repositoryUrl,
  onSelectFile,
  onCheckout,
  className = ''
}: RepoBrowserEnhancedProps) {
  const {
    rootNode,
    expandedPaths,
    loadingPaths,
    searchQuery,
    setSearchQuery,
    visibleNodes,
    initialize,
    toggleExpand,
    goBack,
    goForward,
    refresh,
    canGoBack,
    canGoForward
  } = useRepoBrowser(repositoryUrl)
  
  const [selectedNode, setSelectedNode] = useState<RepoBrowserNode | null>(null)
  
  // Initialize on mount
  useState(() => {
    initialize()
  })
  
  const formatSize = (bytes?: number): string => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString()
  }
  
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        {/* Navigation buttons */}
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Back"
        >
          ←
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Forward"
        >
          →
        </button>
        <button
          onClick={refresh}
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
          />
        </div>
        
        {/* Checkout button */}
        {onCheckout && (
          <button
            onClick={() => onCheckout(selectedNode?.path || '/')}
            disabled={!selectedNode}
            className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md disabled:opacity-50"
          >
            <Download className="w-4 h-4 inline mr-1" />
            Checkout
          </button>
        )}
      </div>
      
      {/* File list */}
      <div className="max-h-96 overflow-auto">
        {!rootNode ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            Loading repository...
          </div>
        ) : visibleNodes.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            {searchQuery ? 'No files match your search' : 'Repository is empty'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {visibleNodes.map(({ node, depth }) => (
              <div
                key={node.path}
                className={`
                  flex items-center gap-2 px-4 py-2 cursor-pointer
                  hover:bg-slate-50 dark:hover:bg-slate-700
                  ${selectedNode?.path === node.path ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
                `}
                style={{ paddingLeft: `${depth * 20 + 16}px` }}
                onClick={() => setSelectedNode(node)}
                onDoubleClick={() => {
                  if (node.kind === 'dir') {
                    toggleExpand(node)
                  } else {
                    onSelectFile?.(node)
                  }
                }}
              >
                {/* Expand/collapse button for directories */}
                {node.kind === 'dir' && (
                  <span
                    className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
                    onClick={e => {
                      e.stopPropagation()
                      toggleExpand(node)
                    }}
                  >
                    {loadingPaths.has(node.path) ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : expandedPaths.has(node.path) ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </span>
                )}
                
                {/* Icon */}
                {node.kind === 'dir' ? (
                  expandedPaths.has(node.path) ? (
                    <FolderOpen className="w-4 h-4 text-amber-500" />
                  ) : (
                    <Folder className="w-4 h-4 text-amber-500" />
                  )
                ) : (
                  <File className="w-4 h-4 text-slate-400" />
                )}
                
                {/* Name */}
                <span className="flex-1 text-sm text-slate-800 dark:text-slate-200 truncate">
                  {node.name}
                </span>
                
                {/* Size (files only) */}
                {node.kind === 'file' && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 w-16 text-right">
                    {formatSize(node.size)}
                  </span>
                )}
                
                {/* Revision */}
                <span className="text-xs text-slate-500 dark:text-slate-400 w-12 text-right">
                  r{node.revision}
                </span>
                
                {/* Date */}
                <span className="text-xs text-slate-500 dark:text-slate-400 w-20 text-right">
                  {formatDate(node.date)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Selected item details */}
      {selectedNode && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {selectedNode.name}
              </span>
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                {selectedNode.kind === 'dir' ? 'Directory' : 'File'}
              </span>
            </div>
            <button
              onClick={() => window.api.app.openExternal(selectedNode.url)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
              title="Open in browser"
            >
              <ExternalLink className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {selectedNode.author} • r{selectedNode.revision} • {formatDate(selectedNode.date)}
          </div>
        </div>
      )}
    </div>
  )
}

export default RepoBrowserEnhanced
