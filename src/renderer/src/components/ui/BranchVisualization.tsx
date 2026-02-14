import { useState, useCallback, useMemo } from 'react'
import { GitBranch, Tag, Clock, User, MessageSquare } from 'lucide-react'
import type { SvnLogEntry } from '@shared/types'

/**
 * Branch node in the visualization tree
 */
export interface BranchNode {
  id: string
  name: string
  path: string
  revision: number
  author: string
  date: string
  message: string
  isTag: boolean
  isActive: boolean
  children: BranchNode[]
  parent?: BranchNode
  copyFrom?: {
    path: string
    revision: number
  }
}

/**
 * Branch visualization configuration
 */
export interface BranchVisualizationConfig {
  showTags: boolean
  showInactive: boolean
  maxDepth: number
  nodeSpacing: number
  orientation: 'horizontal' | 'vertical'
}

/**
 * Hook for building branch tree from SVN log
 */
export function useBranchVisualization(logEntries: SvnLogEntry[], config: Partial<BranchVisualizationConfig> = {}) {
  const cfg: BranchVisualizationConfig = {
    showTags: true,
    showInactive: true,
    maxDepth: 10,
    nodeSpacing: 60,
    orientation: 'vertical',
    ...config
  }
  
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['trunk']))
  const [selectedNode, setSelectedNode] = useState<BranchNode | null>(null)
  
  /**
   * Build branch tree from log entries
   */
  const branchTree = useMemo(() => {
    const branches: Map<string, BranchNode> = new Map()
    
    // Common branch patterns
    const branchPatterns = [
      /^\/trunk$/i,
      /^\/branches\/(.+)$/i,
      /^\/tags\/(.+)$/i,
      /^\/(trunk)$/i,
      /\/branches\/([^/]+)/i,
      /\/tags\/([^/]+)/i
    ]
    
    // Extract branches from log entries
    for (const entry of logEntries) {
      for (const path of entry.paths) {
        // Check if this is a branch/tag operation
        if (path.action === 'A' && path.copyFromPath) {
          // This is likely a branch or tag creation
          let branchName = ''
          let isTag = false
          
          // Extract branch name from path
          for (const pattern of branchPatterns) {
            const match = path.path.match(pattern)
            if (match) {
              if (path.path.includes('/tags/')) {
                isTag = true
                branchName = match[1] || 'unknown'
              } else if (path.path.includes('/branches/')) {
                branchName = match[1] || 'unknown'
              } else {
                branchName = 'trunk'
              }
              break
            }
          }
          
          if (branchName) {
            const node: BranchNode = {
              id: path.path,
              name: branchName,
              path: path.path,
              revision: entry.revision,
              author: entry.author,
              date: entry.date,
              message: entry.message,
              isTag,
              isActive: true,
              children: [],
              copyFrom: {
                path: path.copyFromPath,
                revision: path.copyFromRev || 0
              }
            }
            
            branches.set(path.path, node)
          }
        }
      }
    }
    
    // Add trunk if not present
    if (!branches.has('/trunk')) {
      branches.set('/trunk', {
        id: '/trunk',
        name: 'trunk',
        path: '/trunk',
        revision: 0,
        author: '',
        date: '',
        message: 'Main development line',
        isTag: false,
        isActive: true,
        children: []
      })
    }
    
    // Build parent-child relationships
    for (const node of branches.values()) {
      if (node.copyFrom) {
        const parent = branches.get(node.copyFrom.path)
        if (parent && parent !== node) {
          node.parent = parent
          if (!parent.children.includes(node)) {
            parent.children.push(node)
          }
        }
      }
    }
    
    // Return root nodes (nodes without parents)
    const roots: BranchNode[] = []
    for (const node of branches.values()) {
      if (!node.parent) {
        roots.push(node)
      }
    }
    
    return roots
  }, [logEntries])
  
  /**
   * Flatten tree for rendering
   */
  const flatNodes = useMemo(() => {
    const result: { node: BranchNode; depth: number }[] = []
    
    const flatten = (nodes: BranchNode[], depth: number) => {
      for (const node of nodes) {
        if (depth <= cfg.maxDepth) {
          result.push({ node, depth })
          
          if (expandedNodes.has(node.id) && node.children.length > 0) {
            flatten(node.children, depth + 1)
          }
        }
      }
    }
    
    flatten(branchTree, 0)
    return result
  }, [branchTree, expandedNodes, cfg.maxDepth])
  
  /**
   * Toggle node expansion
   */
  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])
  
  /**
   * Expand all nodes
   */
  const expandAll = useCallback(() => {
    const allIds = new Set<string>()
    const collect = (nodes: BranchNode[]) => {
      for (const node of nodes) {
        allIds.add(node.id)
        collect(node.children)
      }
    }
    collect(branchTree)
    setExpandedNodes(allIds)
  }, [branchTree])
  
  /**
   * Collapse all nodes
   */
  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set())
  }, [])
  
  /**
   * Get node statistics
   */
  const stats = useMemo(() => {
    let totalBranches = 0
    let totalTags = 0
    let activeBranches = 0
    
    const count = (nodes: BranchNode[]) => {
      for (const node of nodes) {
        if (node.isTag) {
          totalTags++
        } else {
          totalBranches++
          if (node.isActive) activeBranches++
        }
        count(node.children)
      }
    }
    
    count(branchTree)
    
    return { totalBranches, totalTags, activeBranches }
  }, [branchTree])
  
  return {
    branchTree,
    flatNodes,
    expandedNodes,
    selectedNode,
    setSelectedNode,
    toggleNode,
    expandAll,
    collapseAll,
    stats,
    config: cfg
  }
}

/**
 * Branch tree node component props
 */
export interface BranchNodeProps {
  node: BranchNode
  depth: number
  isExpanded: boolean
  isSelected: boolean
  onToggle: () => void
  onSelect: () => void
  orientation: 'horizontal' | 'vertical'
  nodeSpacing: number
}

/**
 * Branch tree node component
 */
export function BranchTreeNode({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  orientation,
  nodeSpacing
}: BranchNodeProps) {
  const hasChildren = node.children.length > 0
  
  const nodeStyle = orientation === 'vertical'
    ? { marginLeft: depth * nodeSpacing }
    : { marginTop: depth * nodeSpacing }
  
  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer
        transition-colors duration-150
        ${isSelected 
          ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-500 border' 
          : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }
      `}
      style={nodeStyle}
      onClick={onSelect}
    >
      {/* Expand/Collapse button */}
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
        >
          {isExpanded ? '▼' : '▶'}
        </button>
      )}
      
      {/* Icon */}
      {node.isTag ? (
        <Tag className="w-4 h-4 text-amber-500" />
      ) : (
        <GitBranch className={`w-4 h-4 ${node.name === 'trunk' ? 'text-green-500' : 'text-blue-500'}`} />
      )}
      
      {/* Name */}
      <span className="font-medium text-slate-800 dark:text-slate-200">
        {node.name}
      </span>
      
      {/* Revision */}
      <span className="text-xs text-slate-500 dark:text-slate-400">
        r{node.revision}
      </span>
      
      {/* Info icons */}
      <div className="flex items-center gap-1 ml-auto text-slate-400">
        <User className="w-3 h-3" />
        <span className="text-xs">{node.author}</span>
      </div>
    </div>
  )
}

/**
 * Branch visualization component
 */
export function BranchVisualization({ logEntries }: { logEntries: SvnLogEntry[] }) {
  const {
    flatNodes,
    expandedNodes,
    selectedNode,
    setSelectedNode,
    toggleNode,
    expandAll,
    collapseAll,
    stats,
    config
  } = useBranchVisualization(logEntries)
  
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Branch Visualization
          </h3>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {stats.totalBranches} branches, {stats.totalTags} tags
          </span>
          <button
            onClick={expandAll}
            className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
          >
            Collapse All
          </button>
        </div>
      </div>
      
      {/* Tree */}
      <div className="p-4 max-h-96 overflow-auto">
        {flatNodes.length === 0 ? (
          <div className="text-center text-slate-500 dark:text-slate-400 py-8">
            No branch information available
          </div>
        ) : (
          <div className="space-y-1">
            {flatNodes.map(({ node, depth }) => (
              <BranchTreeNode
                key={node.id}
                node={node}
                depth={depth}
                isExpanded={expandedNodes.has(node.id)}
                isSelected={selectedNode?.id === node.id}
                onToggle={() => toggleNode(node.id)}
                onSelect={() => setSelectedNode(node)}
                orientation={config.orientation}
                nodeSpacing={config.nodeSpacing}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Selected node details */}
      {selectedNode && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-2">
            {selectedNode.isTag ? 'Tag' : 'Branch'}: {selectedNode.name}
          </h4>
          
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
              <Clock className="w-3 h-3" />
              <span>{new Date(selectedNode.date).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
              <User className="w-3 h-3" />
              <span>{selectedNode.author}</span>
            </div>
          </div>
          
          {selectedNode.message && (
            <div className="mt-2 flex items-start gap-1 text-sm text-slate-600 dark:text-slate-400">
              <MessageSquare className="w-3 h-3 mt-0.5" />
              <span className="line-clamp-2">{selectedNode.message}</span>
            </div>
          )}
          
          {selectedNode.copyFrom && (
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-500">
              Copied from {selectedNode.copyFrom.path} @ r{selectedNode.copyFrom.revision}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default BranchVisualization
