/** Fixed-height revision timeline with shared topology and metadata rows. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, List, RefreshCw } from 'lucide-react';
import { readCachedLog } from '@renderer/utils/cachedSvnRead';
import { buildLogCacheScope } from '@renderer/hooks/useLogCache';
import { svnLogMergeHistory } from '@renderer/lib/queryKeys';
import {
  buildRevisionGraph,
  COMPACT_LANE_WIDTH,
  COMPACT_ROW_HEIGHT,
  DEFAULT_LANE_WIDTH,
  graphHeight,
  graphWidth,
  laneCenterX,
  laneConnectorPath,
  revisionY,
  windowRevisionGraph,
  type RevisionGraphLane,
  type RevisionGraphNode,
} from '@renderer/lib/revisionGraph';
import type { SvnLogEntry } from '@shared/types';
import { SkeletonList } from '@renderer/components/ui/Skeleton';

const PANEL_MAX_LANES = 14;
const WINDOW_OVERSCAN_ROWS = 8;
const LOG_LIMIT = 100;
const EMPTY_ENTRIES: SvnLogEntry[] = [];

/** Lane 0 follows the user's accent; the rest use the lib's fixed palette. */
function laneStroke(lane: RevisionGraphLane): string {
  return lane.colorIndex === 0 ? 'rgb(var(--color-accent-rgb, 88 166 255))' : lane.color;
}

export interface RevisionGraphPanelProps {
  /** Working-copy path whose log is graphed (same read as the commit list). */
  path: string;
  selectedRevision?: number | null;
  onSelectRevision?: (revision: number) => void;
  /** `full` for the History surface, `compact` for narrow sidebars. */
  variant?: 'full' | 'compact';
  className?: string;
  onShowChanges?: (revision: number) => void;
}

export function RevisionGraphPanel({
  path,
  selectedRevision,
  onSelectRevision,
  variant = 'full',
  className = '',
  onShowChanges,
}: RevisionGraphPanelProps) {
  const isCompact = variant === 'compact';
  const rowHeight = isCompact ? COMPACT_ROW_HEIGHT : 56;
  const laneWidth = isCompact ? COMPACT_LANE_WIDTH : DEFAULT_LANE_WIDTH;
  const dotRadius = isCompact ? 3 : 4.2;

  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [hovered, setHovered] = useState<{ node: RevisionGraphNode; x: number; y: number } | null>(
    null
  );

  // Merge-history log (-g): nested merged revisions are flattened into the
  // merge commit's paths by the shared parser, giving revisionGraph exact
  // merge edges. The cache scope intentionally differs from CommitHistory's —
  // -g output is a superset, so sharing the key would serve the panel the
  // non-merged variant (or vice versa).
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: svnLogMergeHistory(path),
    queryFn: async ({ signal }) =>
      readCachedLog(path, `${path}::${buildLogCacheScope(LOG_LIMIT, true, {})}`, () =>
        window.api.svn.log(path, LOG_LIMIT, undefined, undefined, true, { signal })
      ),
    enabled: !!path && path !== '/',
    refetchOnMount: 'always',
  });

  const entries = data?.data.entries ?? EMPTY_ENTRIES;
  const model = useMemo(
    () => buildRevisionGraph(entries, { maxLanes: PANEL_MAX_LANES }),
    [entries]
  );

  const hasRows = model.nodes.length > 0;
  const totalHeight = graphHeight(model.nodes.length, rowHeight);
  const laneAreaWidth = Math.max(
    graphWidth(model.columnCount, laneWidth) + 32,
    isCompact ? laneWidth : 96
  );

  // ── vertical virtualization ────────────────────────────────────────────────
  const firstVisibleRow = Math.max(0, Math.floor(scrollTop / rowHeight) - WINDOW_OVERSCAN_ROWS);
  const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + WINDOW_OVERSCAN_ROWS * 2 + 2;
  const visible = useMemo(
    () => windowRevisionGraph(model, { offset: firstVisibleRow, count: visibleRowCount }),
    [model, firstVisibleRow, visibleRowCount]
  );

  const handleScroll = useCallback(() => {
    setHovered(null);
    const el = scrollRef.current;
    if (!el || scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    },
    []
  );

  // Track the viewport height so the row window follows container resizes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight || 320));
    observer.observe(el);
    setViewportHeight(el.clientHeight || 320);
    return () => observer.disconnect();
  }, [hasRows]);

  // Keep the selected revision in view when the selection moves.
  const selectedNode = useMemo(
    () =>
      selectedRevision == null
        ? undefined
        : model.nodes.find((node) => node.revision === selectedRevision),
    [model, selectedRevision]
  );
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedNode) return;
    const y = selectedNode.rowIndex * rowHeight;
    if (y < el.scrollTop || y + rowHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = y - el.clientHeight / 2 + rowHeight / 2;
    }
  }, [selectedNode, rowHeight]);

  const showNodeTooltip = useCallback((node: RevisionGraphNode, element: HTMLElement) => {
    const panel = rootRef.current;
    if (!panel) return;
    const buttonRect = element.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const halfWidth = Math.min(110, panelRect.width / 2 - 4);
    const x = Math.min(
      Math.max(buttonRect.left - panelRect.left + buttonRect.width / 2, halfWidth + 4),
      Math.max(panelRect.width - halfWidth - 4, halfWidth + 4)
    );
    setHovered({ node, x, y: buttonRect.top - panelRect.top });
  }, []);

  const handleNodeClick = useCallback(
    (revision: number) => {
      onSelectRevision?.(revision);
    },
    [onSelectRevision]
  );

  const legendLanes = model.lanes.filter(
    (lane) => !lane.isOverflow && lane.revisionCount > 0 && lane.lastRowIndex >= lane.firstRowIndex
  );

  const laneColumn = (laneId: string): number =>
    model.laneById.get(laneId)?.columnIndex ?? model.columnCount - 1;

  const renderBody = () => {
    if (isLoading) {
      return (
        <SkeletonList
          rows={8}
          label="Loading revision graph"
          className="flex-1 min-h-0 py-1 overflow-hidden"
        />
      );
    }
    if (error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
          <p className="text-2xs text-text-secondary">Graph failed to load</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      );
    }
    if (model.nodes.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-3">
          <p className="text-2xs text-text-muted">No revisions</p>
        </div>
      );
    }
    return (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 min-h-0 min-w-0 overflow-auto scrollbar-overlay"
        data-testid="revision-graph-scroll"
      >
        <div
          className="relative w-full"
          style={{ minWidth: isCompact ? laneAreaWidth : laneAreaWidth + 440, height: totalHeight }}
        >
          <svg
            width={laneAreaWidth}
            height={totalHeight}
            viewBox={`0 0 ${laneAreaWidth} ${totalHeight}`}
            className="pointer-events-none absolute top-0 left-3 block"
            aria-hidden="true"
          >
            {/* Lane verticals — one continuous line per branch incarnation. */}
            {model.lanes.map((lane) => {
              const x = laneCenterX(lane.columnIndex, laneWidth);
              const y1 = revisionY(lane.firstRowIndex, rowHeight);
              const y2 = revisionY(lane.lastRowIndex, rowHeight);
              if (y2 <= y1 && lane.revisionCount < 2) {
                return null; // single-revision lane: dot only
              }
              return (
                <line
                  key={lane.id}
                  x1={x}
                  y1={y1}
                  x2={x}
                  y2={y2}
                  style={{ stroke: laneStroke(lane) }}
                  strokeWidth={isCompact ? 1.4 : 1.8}
                  strokeLinecap="round"
                  opacity={lane.isOverflow ? 0.35 : 0.7}
                />
              );
            })}

            {/* Branch (copy) and merge edges, windowed to visible rows. */}
            {visible.edges
              .filter((edge) => edge.kind !== 'parent')
              .map((edge) => {
                const toLane = model.laneById.get(edge.to.laneId);
                const from = {
                  x: laneCenterX(laneColumn(edge.from.laneId), laneWidth),
                  y: revisionY(edge.from.rowIndex, rowHeight),
                };
                const to = {
                  x: laneCenterX(laneColumn(edge.to.laneId), laneWidth),
                  y: revisionY(edge.to.rowIndex, rowHeight),
                };
                if (from.x === to.x && from.y === to.y) return null;
                const color = toLane ? laneStroke(toLane) : 'currentColor';
                const isMerge = edge.kind === 'merge';
                return (
                  <g
                    key={`${edge.kind}-${edge.from.revision}-${edge.to.revision}-${edge.to.laneId}`}
                  >
                    <path
                      d={laneConnectorPath(from, to)}
                      style={{ stroke: color }}
                      strokeWidth={isMerge ? 1.3 : 1.8}
                      fill="none"
                      strokeDasharray={isMerge ? '3,3' : undefined}
                      opacity={isMerge ? 0.75 : 0.9}
                    />
                    {isMerge && (
                      <path
                        d={`M ${to.x} ${to.y - dotRadius - 2.5} L ${to.x + 3.4} ${to.y - dotRadius - 8} L ${to.x - 3.4} ${to.y - dotRadius - 8} Z`}
                        style={{ fill: color }}
                        opacity={0.9}
                      />
                    )}
                  </g>
                );
              })}

            {/* Revision dots — one per touched lane, hollow + badge on copies. */}
            {visible.nodes.map((node) =>
              node.laneIds.map((laneId) => {
                const lane = model.laneById.get(laneId);
                if (!lane) return null;
                const cx = laneCenterX(lane.columnIndex, laneWidth);
                const cy = revisionY(node.rowIndex, rowHeight);
                const isPrimary = laneId === node.laneId;
                const isCopy = isPrimary && node.copyPoint !== undefined;
                const isMerge = isPrimary && node.merges.length > 0;
                const isSelected = selectedRevision === node.revision;
                const color = laneStroke(lane);
                return (
                  <g key={`${node.revision}-${laneId}`}>
                    {isMerge && !isCompact && (
                      <path
                        d={`M ${cx} ${cy - 7} L ${cx + 7} ${cy} L ${cx} ${cy + 7} L ${cx - 7} ${cy} Z`}
                        style={{ stroke: color }}
                        strokeWidth={1.1}
                        fill="none"
                        opacity={0.85}
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isPrimary ? dotRadius : dotRadius * 0.55}
                      style={isCopy ? { stroke: color, fill: 'var(--color-bg)' } : { fill: color }}
                      strokeWidth={isCopy ? 1.8 : undefined}
                      opacity={isPrimary ? 1 : 0.8}
                    />
                    {isCopy && (
                      <circle
                        cx={cx + dotRadius + 2.6}
                        cy={cy - dotRadius - 2.6}
                        r={1.7}
                        style={{ fill: color }}
                      />
                    )}
                    {node.isHead && isPrimary && !isCompact && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={dotRadius + 2.6}
                        style={{ stroke: color }}
                        strokeWidth={1.2}
                        fill="none"
                        opacity={0.6}
                      />
                    )}
                    {isSelected && isPrimary && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={dotRadius + 3.2}
                        style={{ stroke: 'rgb(var(--color-accent-rgb, 88 166 255))' }}
                        strokeWidth={2}
                        fill="none"
                      />
                    )}
                  </g>
                );
              })
            )}
          </svg>

          {/* Transparent per-revision buttons: a11y, hover tooltips, select. */}
          {visible.nodes.map((node) => {
            const isSelected = selectedRevision === node.revision;
            return (
              <button
                key={node.revision}
                type="button"
                data-testid={`revision-graph-node-r${node.revision}`}
                aria-label={`Revision ${node.revision} on ${node.branch}${node.copyPoint ? `, branched from r${node.copyPoint.fromRev}` : ''}${node.merges.length > 0 ? ', merge' : ''}`}
                aria-current={isSelected ? 'true' : undefined}
                className={`absolute left-0 flex w-full items-center border-b border-border/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${isSelected ? 'bg-accent/10' : 'bg-transparent hover:bg-bg-tertiary/40'}`}
                style={{
                  top: node.rowIndex * rowHeight,
                  height: rowHeight,
                  paddingLeft: laneAreaWidth,
                }}
                onMouseEnter={(event) => {
                  if (isCompact) showNodeTooltip(node, event.currentTarget);
                }}
                onFocus={(event) => {
                  if (isCompact) showNodeTooltip(node, event.currentTarget);
                }}
                onMouseLeave={() => setHovered(null)}
                onBlur={() => setHovered(null)}
                onClick={() => handleNodeClick(node.revision)}
                onDoubleClick={() => onShowChanges?.(node.revision)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const next = model.nodes[node.rowIndex + (event.key === 'ArrowDown' ? 1 : -1)];
                    if (next) {
                      handleNodeClick(next.revision);
                      requestAnimationFrame(() =>
                        rootRef.current
                          ?.querySelector<HTMLButtonElement>(
                            `[data-testid="revision-graph-node-r${next.revision}"]`
                          )
                          ?.focus()
                      );
                    }
                  }
                }}
              >
                {!isCompact && (
                  <>
                    <span className="w-20 flex-shrink-0 font-mono text-xs font-medium text-accent">
                      r{node.revision}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 pr-4">
                      <span className="truncate text-sm text-text" title={node.message}>
                        {node.message.split('\n')[0] || '(no commit message)'}
                      </span>
                      <span className="flex min-w-0 items-center gap-3 text-xs text-text-muted">
                        <span className="truncate" title={node.branch}>
                          {node.branch}
                        </span>
                        {node.copyPoint && (
                          <span className="flex-shrink-0 text-info">
                            Copy from r{node.copyPoint.fromRev}
                          </span>
                        )}
                        {node.merges.length > 0 && (
                          <span className="flex-shrink-0 text-info">Merge</span>
                        )}
                      </span>
                    </span>
                    <span
                      className="w-28 flex-shrink-0 truncate pr-3 text-xs text-text-secondary"
                      title={node.author}
                    >
                      {node.author || 'unknown'}
                    </span>
                    <span className="w-28 flex-shrink-0 pr-4 text-right text-xs tabular-nums text-text-muted">
                      {new Date(node.date).toLocaleDateString()}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <aside
      ref={rootRef}
      data-testid="revision-graph-panel"
      aria-label="Revision graph"
      className={`relative flex min-h-0 min-w-0 overflow-hidden flex-col bg-bg-secondary ${isCompact ? 'w-[120px] flex-shrink-0' : 'min-w-0 flex-1'} ${className}`}
    >
      {!isCompact && (
        <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-border px-3">
          <GitBranch className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-faint">
            Revision graph
          </span>
          <span className="ml-auto text-xs tabular-nums text-text-muted">
            {model.stats.revisions} rev · {model.stats.branches} br
          </span>
        </div>
      )}

      {renderBody()}

      {!isCompact && selectedNode && (
        <div
          className="flex flex-shrink-0 items-center gap-4 border-t border-border bg-bg px-4 py-3"
          data-testid="graph-selection-details"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs text-accent">
              r{selectedNode.revision} | {selectedNode.author || 'unknown'}
            </p>
            <p className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs text-text-secondary">
              {selectedNode.message || '(no commit message)'}
            </p>
          </div>
          {onShowChanges && (
            <button
              type="button"
              className="btn btn-secondary btn-sm flex-shrink-0"
              onClick={() => onShowChanges(selectedNode.revision)}
            >
              Show changes
            </button>
          )}
        </div>
      )}

      {!isCompact && model.nodes.length > 0 && (
        <div className="flex max-h-24 overflow-auto flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-2 py-1.5">
          {legendLanes.slice(0, 6).map((lane) => (
            <span
              key={lane.id}
              className="flex max-w-[200px] items-center gap-1 text-2xs text-text-secondary"
              title={lane.branch}
            >
              <span
                className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: laneStroke(lane) }}
              />
              <span className="truncate">{lane.branch}</span>
            </span>
          ))}
          {model.overflowBranches.length > 0 && (
            <span className="text-2xs text-text-faint" title={model.overflowBranches.join(', ')}>
              +{model.overflowBranches.length} more
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-2xs text-text-faint">
            <span title="Branch/tag created by copy">○ copy</span>
            <span title="Merge from SVN history or inferred from commit message">◇ merge</span>
          </span>
        </div>
      )}

      {hovered && (
        <div
          role="tooltip"
          data-testid="revision-graph-tooltip"
          className="pointer-events-none absolute z-20 w-52 rounded-md border border-border bg-bg-elevated p-2 shadow-lg"
          style={{
            left: hovered.x,
            top: hovered.y - 6,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium text-accent">
              r{hovered.node.revision}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-2xs text-text-secondary">
              <span
                className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                style={{
                  backgroundColor: model.laneById.get(hovered.node.laneId)?.color ?? '#58a6ff',
                }}
              />
              <span className="truncate">{hovered.node.branch}</span>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-2xs text-text-muted">
            <span className="truncate">{hovered.node.author || 'unknown'}</span>
            <span className="truncate">{new Date(hovered.node.date).toLocaleDateString()}</span>
          </div>
          {hovered.node.copyPoint && (
            <p className="mt-1 text-2xs text-info">
              Branched from r{hovered.node.copyPoint.fromRev} ({hovered.node.copyPoint.fromPath})
            </p>
          )}
          {hovered.node.merges.length > 0 && (
            <p className="mt-1 text-2xs text-info">
              Merged from {hovered.node.merges.map((merge) => merge.branch).join(', ')}
            </p>
          )}
          {hovered.node.message && (
            <p className="mt-1 line-clamp-2 text-2xs text-text-secondary">{hovered.node.message}</p>
          )}
        </div>
      )}
    </aside>
  );
}

/* ───────────────────────────── view toggle ──────────────────────────────── */

export type HistoryViewMode = 'list' | 'graph';

/**
 * Segmented list/graph toggle for the History route header (#45). Pure
 * controlled component so the route owns (and persists) the mode.
 */
export function HistoryViewToggle({
  value,
  onChange,
}: {
  value: HistoryViewMode;
  onChange: (mode: HistoryViewMode) => void;
}) {
  const modes: Array<{ id: HistoryViewMode; label: string; Icon: typeof List }> = [
    { id: 'list', label: 'List', Icon: List },
    { id: 'graph', label: 'Graph', Icon: GitBranch },
  ];
  return (
    <div
      role="group"
      aria-label="History view"
      className="flex items-center gap-0.5 rounded-md border border-border bg-bg-secondary p-0.5"
    >
      {modes.map(({ id, label, Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            data-testid={`history-view-${id}`}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium transition-colors motion-safe:hover:bg-bg-tertiary ${
              active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text'
            }`}
            title={`${label} view`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
