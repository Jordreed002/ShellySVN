import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, GitBranch, RefreshCw, ZoomIn, ZoomOut, Download, Loader2, Filter, ChevronDown } from 'lucide-react'

interface RevisionGraphProps {
  isOpen: boolean
  path: string
  onClose: () => void
}

interface GraphNode {
  revision: number
  author: string
  date: string
  message: string
  branch: string
  x: number
  y: number
  isCopySource?: boolean
  isDeleted?: boolean
  isHead?: boolean
  copyFromPath?: string
  copyFromRev?: number
}

interface GraphEdge {
  from: number
  to: number
  isCopy?: boolean
  color?: string
}

interface BranchColumn {
  name: string
  color: string
  x: number
}

const BRANCH_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
]

export function RevisionGraph({ isOpen, path, onClose }: RevisionGraphProps) {
  const [zoom, setZoom] = useState(1)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [filterBranch, setFilterBranch] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isExporting, setIsExporting] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  
  // Fetch log data with extended info
  const { data: logData, isLoading, refetch } = useQuery({
    queryKey: ['svn:log', path, 200],
    queryFn: () => window.api.svn.log(path, 200),
    enabled: isOpen && !!path
  })
  
  // Convert log to graph nodes with branch tracking
  const { nodes, edges, branches } = useMemo(() => {
    if (!logData?.entries) return { nodes: [], edges: [], branches: [] }
    
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const branchMap = new Map<string, number>() // branch name -> column index
    const branches: BranchColumn[] = []
    
    // Detect branches from paths
    const detectBranch = (paths: { path: string; action: string; copyFromPath?: string; copyFromRev?: number }[]): string => {
      for (const p of paths) {
        const pathParts = p.path.split('/')
        const branchIndex = pathParts.findIndex(part => 
          part === 'trunk' || part === 'branches' || part === 'tags'
        )
        if (branchIndex >= 0) {
          if (pathParts[branchIndex] === 'trunk') return 'trunk'
          if (pathParts[branchIndex + 1]) {
            return `${pathParts[branchIndex]}/${pathParts[branchIndex + 1]}`
          }
          return pathParts[branchIndex]
        }
      }
      return 'trunk'
    }
    
    // Assign branches to columns
    let nextColumn = 0
    const getBranchColumn = (branchName: string): number => {
      if (!branchMap.has(branchName)) {
        branchMap.set(branchName, nextColumn)
        branches.push({
          name: branchName,
          color: BRANCH_COLORS[nextColumn % BRANCH_COLORS.length],
          x: nextColumn * 120 + 100
        })
        nextColumn++
      }
      return branchMap.get(branchName) ?? 0
    }
    
    // Process entries
    logData.entries.forEach((entry, index) => {
      const branch = detectBranch(entry.paths)
      const column = getBranchColumn(branch)
      const branchInfo = branches[column]
      
      // Check for copy (branch creation)
      let copyFromPath: string | undefined
      let copyFromRev: number | undefined
      for (const p of entry.paths) {
        if (p.copyFromPath) {
          copyFromPath = p.copyFromPath
          copyFromRev = p.copyFromRev
        }
      }
      
      nodes.push({
        revision: entry.revision,
        author: entry.author,
        date: entry.date,
        message: entry.message,
        branch,
        x: branchInfo?.x || 100,
        y: index * 60 + 50,
        isHead: index === 0,
        copyFromPath,
        copyFromRev
      })
    })
    
    // Create edges
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const branchInfo = branches.find(b => b.name === node.branch)
      
      // Regular parent-child edge
      if (i < nodes.length - 1) {
        const nextNode = nodes[i + 1]
        // Check if same branch or if this is a continuation
        if (node.branch === nextNode.branch || node.copyFromRev === nextNode.revision) {
          edges.push({
            from: nextNode.revision,
            to: node.revision,
            color: branchInfo?.color
          })
        }
      }
      
      // Copy edge (branch creation)
      if (node.copyFromRev && node.copyFromPath) {
        const sourceNode = nodes.find(n => n.revision === node.copyFromRev)
        if (sourceNode) {
          edges.push({
            from: node.copyFromRev,
            to: node.revision,
            isCopy: true,
            color: branchInfo?.color
          })
        }
      }
    }
    
    return { nodes, edges, branches }
  }, [logData])
  
  // Filtered nodes
  const filteredNodes = useMemo(() => {
    if (!filterBranch) return nodes
    return nodes.filter(n => n.branch === filterBranch)
  }, [nodes, filterBranch])
  
  // Calculate viewBox
  const viewBox = useMemo(() => {
    if (nodes.length === 0) return '0 0 800 600'
    const maxX = Math.max(...branches.map(b => b.x)) + 100
    const maxY = Math.max(...nodes.map(n => n.y)) + 100
    return `0 0 ${Math.max(800, maxX)} ${Math.max(600, maxY)}`
  }, [nodes, branches])
  
  // Mouse handlers for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [pan])
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
  }, [isDragging, dragStart])
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom(prev => Math.min(2, Math.max(0.3, prev + delta)))
  }, [])
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        setZoom(prev => Math.min(2, prev + 0.1))
      } else if (e.key === '-') {
        setZoom(prev => Math.max(0.3, prev - 0.1))
      } else if (e.key === '0') {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }
    }
    
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])
  
  const handleExport = useCallback(async () => {
    const svg = svgRef.current
    if (!svg) return
    
    setIsExporting(true)
    
    try {
      const serializer = new XMLSerializer()
      let svgString = serializer.serializeToString(svg)
      
      if (!svgString.includes('xmlns')) {
        svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
      }
      
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      
      const link = document.createElement('a')
      link.href = url
      link.download = `revision-graph-${new Date().toISOString().slice(0, 10)}.svg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export graph:', error)
    } finally {
      setIsExporting(false)
    }
  }, [])
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[1000px] max-h-[90vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <GitBranch className="w-5 h-5 text-accent" />
            Revision Graph
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary border-b border-border">
          <button
            onClick={() => setZoom(Math.max(0.3, zoom - 0.1))}
            className="btn btn-secondary btn-sm"
            title="Zoom out (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          
          <span className="text-sm text-text-secondary w-16 text-center">{Math.round(zoom * 100)}%</span>
          
          <button
            onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            className="btn btn-secondary btn-sm"
            title="Zoom in (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
            className="btn btn-secondary btn-sm"
            title="Reset view (0)"
          >
            1:1
          </button>
          
          <div className="w-px h-6 bg-border" />
          
          <button
            onClick={() => refetch()}
            className="btn btn-secondary btn-sm"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          {/* Branch filter */}
          <div className="relative">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="btn btn-secondary btn-sm"
            >
              <Filter className="w-4 h-4" />
              {filterBranch ? `: ${filterBranch}` : ''}
              <ChevronDown className="w-3 h-3" />
            </button>
            
            {showFilters && (
              <div className="absolute left-0 top-full mt-1 w-48 bg-bg-elevated border border-border rounded-lg shadow-lg z-10">
                <button
                  onClick={() => { setFilterBranch(null); setShowFilters(false) }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-tertiary first:rounded-t-lg ${!filterBranch ? 'text-accent' : ''}`}
                >
                  All branches
                </button>
                {branches.map((branch) => (
                  <button
                    key={branch.name}
                    onClick={() => { setFilterBranch(branch.name); setShowFilters(false) }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-tertiary flex items-center gap-2 ${filterBranch === branch.name ? 'text-accent' : ''}`}
                  >
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: branch.color }} />
                    {branch.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex-1" />
          
          {/* Branch legend */}
          <div className="flex items-center gap-2">
            {branches.slice(0, 4).map((branch) => (
              <div key={branch.name} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: branch.color }} />
                <span className="text-xs text-text-faint">{branch.name}</span>
              </div>
            ))}
            {branches.length > 4 && (
              <span className="text-xs text-text-faint">+{branches.length - 4} more</span>
            )}
          </div>
          
          <button 
            onClick={handleExport}
            disabled={isExporting}
            className="btn btn-secondary btn-sm"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Export
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body overflow-hidden p-0" style={{ height: '500px' }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 text-text-muted animate-spin" />
            </div>
          ) : nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <GitBranch className="w-12 h-12 text-text-muted mb-4" />
              <p className="text-text-secondary">No revision history found</p>
            </div>
          ) : (
            <div 
              className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing bg-bg-secondary"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            >
              <svg 
                ref={svgRef}
                viewBox={viewBox}
                style={{ 
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                  transformOrigin: '0 0',
                  minWidth: '100%',
                  minHeight: '100%'
                }}
              >
                {/* Branch columns (background) */}
                {branches.map((branch) => (
                  <rect
                    key={branch.name}
                    x={branch.x - 50}
                    y={0}
                    width={100}
                    height={Math.max(...nodes.map(n => n.y)) + 100}
                    fill={branch.color}
                    opacity={0.05}
                  />
                ))}
                
                {/* Branch labels */}
                {branches.map((branch) => (
                  <text
                    key={`label-${branch.name}`}
                    x={branch.x}
                    y={25}
                    textAnchor="middle"
                    className="fill-text-secondary text-xs font-medium"
                  >
                    {branch.name}
                  </text>
                ))}
                
                {/* Edges */}
                {edges.map((edge, i) => {
                  const fromNode = nodes.find(n => n.revision === edge.from)
                  const toNode = nodes.find(n => n.revision === edge.to)
                  if (!fromNode || !toNode) return null
                  
                  // Skip if filtered
                  if (filterBranch && fromNode.branch !== filterBranch && toNode.branch !== filterBranch) {
                    return null
                  }
                  
                  const isFiltered = filterBranch && (fromNode.branch !== filterBranch || toNode.branch !== filterBranch)
                  
                  return (
                    <g key={i}>
                      <path
                        d={edge.isCopy 
                          ? `M ${fromNode.x} ${fromNode.y} Q ${(fromNode.x + toNode.x) / 2} ${fromNode.y - 30} ${toNode.x} ${toNode.y}`
                          : `M ${fromNode.x} ${fromNode.y} L ${toNode.x} ${toNode.y}`
                        }
                        stroke={edge.color || 'currentColor'}
                        strokeWidth={edge.isCopy ? 2 : 2}
                        fill="none"
                        strokeDasharray={edge.isCopy ? '4,4' : undefined}
                        opacity={isFiltered ? 0.2 : 0.8}
                        className="text-border"
                      />
                    </g>
                  )
                })}
                
                {/* Nodes */}
                {filteredNodes.map((node) => {
                  const branchInfo = branches.find(b => b.name === node.branch)
                  const isSelected = selectedNode?.revision === node.revision
                  
                  return (
                    <g 
                      key={node.revision}
                      onClick={() => setSelectedNode(node)}
                      className="cursor-pointer"
                      style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                    >
                      {/* Node circle */}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={isSelected ? 12 : 8}
                        fill={node.isHead ? branchInfo?.color : isSelected ? branchInfo?.color : 'var(--bg-primary)'}
                        stroke={branchInfo?.color || 'currentColor'}
                        strokeWidth={2}
                        className="transition-all duration-150"
                      />
                      
                      {/* Copy indicator */}
                      {node.copyFromRev && (
                        <circle
                          cx={node.x + 6}
                          cy={node.y - 6}
                          r={4}
                          fill="var(--bg-primary)"
                          stroke={branchInfo?.color}
                          strokeWidth={1.5}
                        />
                      )}
                      
                      {/* Revision label */}
                      <text
                        x={node.x + 15}
                        y={node.y + 4}
                        className="fill-text-secondary text-xs font-mono"
                      >
                        r{node.revision}
                      </text>
                      
                      {/* Author on hover */}
                      {isSelected && (
                        <text
                          x={node.x + 60}
                          y={node.y + 4}
                          className="fill-text-faint text-xs"
                        >
                          {node.author}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          )}
        </div>
        
        {/* Selected node details */}
        {selectedNode && (
          <div className="px-4 py-3 bg-bg-tertiary border-t border-border">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-accent">r{selectedNode.revision}</span>
                  <span className="text-text-secondary">{selectedNode.author}</span>
                  <span className="text-text-faint text-sm">
                    {new Date(selectedNode.date).toLocaleString()}
                  </span>
                </div>
                {selectedNode.copyFromRev && (
                  <p className="text-xs text-info mb-1">
                    Branched from r{selectedNode.copyFromRev}
                    {selectedNode.copyFromPath && ` (${selectedNode.copyFromPath})`}
                  </p>
                )}
                <p className="text-sm text-text line-clamp-2">
                  {selectedNode.message || '(no message)'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.api.svn.log(path, 1, selectedNode.revision, selectedNode.revision)}
                  className="btn btn-secondary btn-sm"
                >
                  View Log
                </button>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="btn btn-secondary btn-sm"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Footer */}
        <div className="modal-footer">
          <div className="flex-1 text-sm text-text-faint">
            {nodes.length} revisions across {branches.length} branches
          </div>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
