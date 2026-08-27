import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Popover } from './Popover';
import { useQuery } from '@tanstack/react-query';
import { assertSuccessfulSvnRead } from '../../utils/svnReadResult';
import { buildRevisionGraph } from '../../lib/revisionGraph';
import {
  X,
  GitBranch,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Download,
  Loader2,
  Filter,
  ChevronDown,
} from 'lucide-react';

interface RevisionGraphProps {
  isOpen: boolean;
  path: string;
  onClose: () => void;
}

interface GraphNode {
  revision: number;
  author: string;
  date: string;
  message: string;
  branch: string;
  x: number;
  y: number;
  isCopySource?: boolean;
  isDeleted?: boolean;
  isHead?: boolean;
  isMerge?: boolean;
  mergeSources?: string[];
  copyFromPath?: string;
  copyFromRev?: number;
}

interface GraphEdge {
  from: number;
  to: number;
  isCopy?: boolean;
  isMerge?: boolean;
  color?: string;
}

interface BranchColumn {
  name: string;
  color: string;
  x: number;
}

const LANE_COLUMN_WIDTH = 120;
const LANE_ORIGIN_X = 100;

export function RevisionGraph({ isOpen, path, onClose }: RevisionGraphProps) {
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  /* Menu anchor — the popover portals out, so it needs its trigger. */
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Fetch log data with extended info
  const {
    data: logData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['svn:log', path, 200],
    queryFn: async ({ signal }) =>
      assertSuccessfulSvnRead(
        await window.api.svn.log(path, 200, undefined, undefined, false, { signal })
      ),
    enabled: isOpen && !!path,
  });

  // Convert log to graph nodes with branch tracking via the shared pure model
  // (lib/revisionGraph.ts): stable branch lanes, copy-from markers, merge
  // heuristics and lane column recycling all live there.
  const { nodes, edges, branches } = useMemo(() => {
    if (!logData?.entries) return { nodes: [], edges: [], branches: [] };

    const model = buildRevisionGraph(logData.entries, { maxLanes: 12 });
    const xForColumn = (columnIndex: number) => LANE_ORIGIN_X + columnIndex * LANE_COLUMN_WIDTH;

    const graphNodes: GraphNode[] = model.nodes.map((node) => ({
      revision: node.revision,
      author: node.author,
      date: node.date,
      message: node.message,
      branch: node.branch,
      x: xForColumn(model.laneById.get(node.laneId)?.columnIndex ?? 0),
      y: node.rowIndex * 60 + 50,
      isHead: node.isHead,
      isMerge: node.merges.length > 0,
      mergeSources: node.merges.map((merge) => merge.branch),
      copyFromPath: node.copyPoint?.fromPath,
      copyFromRev: node.copyPoint?.fromRev,
    }));

    // One column label per branch path, even if a branch was re-created.
    const seenBranches = new Set<string>();
    const graphBranches: BranchColumn[] = [];
    for (const lane of model.lanes) {
      if (seenBranches.has(lane.branch)) continue;
      seenBranches.add(lane.branch);
      graphBranches.push({
        name: lane.branch,
        color: lane.color,
        x: xForColumn(lane.columnIndex),
      });
    }

    const graphEdges: GraphEdge[] = model.edges.map((edge) => ({
      from: edge.from.revision,
      to: edge.to.revision,
      isCopy: edge.kind === 'branch',
      isMerge: edge.kind === 'merge',
      color: model.laneById.get(edge.laneId)?.color,
    }));

    return { nodes: graphNodes, edges: graphEdges, branches: graphBranches };
  }, [logData]);

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    if (!filterBranch) return nodes;
    return nodes.filter((n) => n.branch === filterBranch);
  }, [nodes, filterBranch]);

  // Calculate viewBox
  const viewBox = useMemo(() => {
    if (nodes.length === 0) return '0 0 800 600';
    const maxX = Math.max(...branches.map((b) => b.x)) + 100;
    const maxY = Math.max(...nodes.map((n) => n.y)) + 100;
    return `0 0 ${Math.max(800, maxX)} ${Math.max(600, maxY)}`;
  }, [nodes, branches]);

  // Mouse handlers for panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => Math.min(2, Math.max(0.3, prev + delta)));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        setZoom((prev) => Math.min(2, prev + 0.1));
      } else if (e.key === '-') {
        setZoom((prev) => Math.max(0.3, prev - 0.1));
      } else if (e.key === '0') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [isOpen]);

  const handleExport = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;

    setIsExporting(true);

    try {
      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(svg);

      if (!svgString.includes('xmlns')) {
        svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `revision-graph-${new Date().toISOString().slice(0, 10)}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export graph:', error);
    } finally {
      setIsExporting(false);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[1000px] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
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

          <span className="text-sm text-text-secondary w-16 text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            className="btn btn-secondary btn-sm"
            title="Zoom in (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="btn btn-secondary btn-sm"
            title="Reset view (0)"
          >
            1:1
          </button>

          <div className="w-px h-6 bg-border" />

          <button onClick={() => refetch()} className="btn btn-secondary btn-sm">
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Branch filter */}
          <div className="relative">
            <button
              ref={filterButtonRef}
              onClick={() => setShowFilters(!showFilters)}
              className="btn btn-secondary btn-sm"
            >
              <Filter className="w-4 h-4" />
              {filterBranch ? `: ${filterBranch}` : ''}
              <ChevronDown className="w-3 h-3" />
            </button>

            {showFilters && (
              <Popover
                anchorRef={filterButtonRef}
                onClose={() => setShowFilters(false)}
                role="menu"
                ariaLabel="Filter by branch"
                className="w-48 bg-bg-elevated border border-border rounded-lg shadow-lg"
              >
                <button
                  onClick={() => {
                    setFilterBranch(null);
                    setShowFilters(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-tertiary first:rounded-t-lg ${!filterBranch ? 'text-accent' : ''}`}
                >
                  All branches
                </button>
                {branches.map((branch) => (
                  <button
                    key={branch.name}
                    onClick={() => {
                      setFilterBranch(branch.name);
                      setShowFilters(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-tertiary flex items-center gap-2 ${filterBranch === branch.name ? 'text-accent' : ''}`}
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: branch.color }}
                    />
                    {branch.name}
                  </button>
                ))}
              </Popover>
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
                  minHeight: '100%',
                }}
              >
                {/* Branch columns (background) */}
                {branches.map((branch) => (
                  <rect
                    key={branch.name}
                    x={branch.x - 50}
                    y={0}
                    width={100}
                    height={Math.max(...nodes.map((n) => n.y)) + 100}
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
                  const fromNode = nodes.find((n) => n.revision === edge.from);
                  const toNode = nodes.find((n) => n.revision === edge.to);
                  if (!fromNode || !toNode) return null;

                  // Skip if filtered
                  if (
                    filterBranch &&
                    fromNode.branch !== filterBranch &&
                    toNode.branch !== filterBranch
                  ) {
                    return null;
                  }

                  const isFiltered =
                    filterBranch &&
                    (fromNode.branch !== filterBranch || toNode.branch !== filterBranch);

                  return (
                    <g key={i}>
                      <path
                        d={
                          edge.isCopy
                            ? `M ${fromNode.x} ${fromNode.y} Q ${(fromNode.x + toNode.x) / 2} ${fromNode.y - 30} ${toNode.x} ${toNode.y}`
                            : `M ${fromNode.x} ${fromNode.y} L ${toNode.x} ${toNode.y}`
                        }
                        stroke={edge.color || 'currentColor'}
                        strokeWidth={edge.isCopy ? 2 : 2}
                        fill="none"
                        strokeDasharray={edge.isMerge ? '2,3' : edge.isCopy ? '4,4' : undefined}
                        opacity={isFiltered ? 0.2 : 0.8}
                        className="text-border"
                      />
                    </g>
                  );
                })}

                {/* Nodes */}
                {filteredNodes.map((node) => {
                  const branchInfo = branches.find((b) => b.name === node.branch);
                  const isSelected = selectedNode?.revision === node.revision;

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
                        fill={
                          node.isHead
                            ? branchInfo?.color
                            : isSelected
                              ? branchInfo?.color
                              : 'var(--bg-primary)'
                        }
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

                      {node.isMerge && (
                        <path
                          d={`M ${node.x} ${node.y - 14} L ${node.x + 6} ${node.y - 8} L ${node.x} ${node.y - 2} L ${node.x - 6} ${node.y - 8} Z`}
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
                        <text x={node.x + 60} y={node.y + 4} className="fill-text-faint text-xs">
                          {node.author}
                        </text>
                      )}
                    </g>
                  );
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
                {selectedNode.isMerge && (
                  <p className="text-xs text-info mb-1">
                    Merge from {selectedNode.mergeSources?.join(', ')}
                  </p>
                )}
                <p className="text-sm text-text line-clamp-2">
                  {selectedNode.message || '(no message)'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedNode(null)} className="btn btn-secondary btn-sm">
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
  );
}
