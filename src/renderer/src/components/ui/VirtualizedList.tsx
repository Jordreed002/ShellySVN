import { useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import type { SvnStatusEntry, SvnStatusChar } from '@shared/types';
import { getStatusDisplay } from '../../hooks/useIncrementalStatus';

// Module-level constant for default Set props to avoid new instances on every render
const EMPTY_SET = new Set<string>();

/** Item key type used by @tanstack/react-virtual (Key = string | number | bigint). */
type AnchorKey = string | number | bigint;

/** Minimal shape of a virtualizer needed for scroll anchoring (structural, version-tolerant). */
interface AnchorableVirtualizer {
  measurementsCache: ReadonlyArray<{ key: AnchorKey; start: number; size: number }>;
}

interface AnchorableVirtualItem {
  key: AnchorKey;
  start: number;
  size: number;
  end: number;
}

interface ScrollAnchor {
  /** Key of the row the viewport is pinned to. */
  key: AnchorKey;
  /** Distance from the top of the anchored row to the top of the viewport (>= 0). */
  offset: number;
  /** The anchored row's start offset at capture time (used when the row disappears). */
  start: number;
}

/**
 * Preserves the user's scroll position when the underlying data is refreshed
 * (e.g. SVN statuses arrive mid-scroll and replace the row array with new
 * object identities, or rows are inserted/removed above the viewport).
 *
 * TanStack Virtual keeps the scroll offset only while the scroll element and
 * item keys survive; it does not compensate for rows shifting positions, nor
 * for the browser clamping scrollTop when the total content height shrinks.
 * Both manifest as the list "jumping". This hook implements scroll anchoring:
 * on data-only updates the first in-viewport row is re-pinned to its original
 * position, and if that row was removed, whichever row now occupies the
 * anchored position is pinned instead.
 */
function useScrollPositionAnchor(
  parentRef: React.RefObject<HTMLDivElement | null>,
  virtualizer: AnchorableVirtualizer,
  virtualItems: ReadonlyArray<AnchorableVirtualItem>,
  dataVersion: unknown
): void {
  const anchorRef = useRef<ScrollAnchor | null>(null);
  const prevDataVersionRef = useRef<unknown>(dataVersion);

  useLayoutEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement || virtualItems.length === 0) {
      return;
    }

    const scrollTop = scrollElement.scrollTop;
    const firstVisible = virtualItems.find((item) => item.end > scrollTop) ?? virtualItems[0];

    const dataChanged = prevDataVersionRef.current !== dataVersion;
    prevDataVersionRef.current = dataVersion;

    if (!dataChanged) {
      // Regular commit (e.g. scroll event): keep the anchor in sync with the
      // row currently at the top of the viewport.
      anchorRef.current = {
        key: firstVisible.key,
        offset: scrollTop - firstVisible.start,
        start: firstVisible.start,
      };
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const measurements = virtualizer.measurementsCache;
    if (!measurements) {
      // No measurement info available (e.g. a mocked virtualizer); nothing to
      // pin against, so leave the scroll offset untouched.
      return;
    }

    const pinTo = (item: { key: AnchorKey; start: number; size: number }, offset: number) => {
      const desired = Math.max(0, item.start + offset);
      if (Math.abs(scrollElement.scrollTop - desired) > 1) {
        // Browsers fire a (async) scroll event for programmatic scrollTop
        // assignments, which lets the virtualizer resync its visible range.
        scrollElement.scrollTop = desired;
      }
      anchorRef.current = { key: item.key, offset, start: item.start };
    };

    const anchored = measurements.find((item) => item.key === anchor.key);
    if (anchored) {
      pinTo(anchored, anchor.offset);
      return;
    }

    // The anchored row is gone (refresh removed it). Pin the last row that
    // still starts at or before the anchored position so the viewport stays
    // put instead of being clamped around by the shrunken content.
    let replacement: { key: AnchorKey; start: number; size: number } | undefined;
    for (const item of measurements) {
      if (item.start > anchor.start) {
        break;
      }
      replacement = item;
    }
    if (replacement) {
      pinTo(replacement, Math.min(Math.max(0, anchor.offset), replacement.size));
    }
  });
}

interface VirtualizedFileListProps {
  files: SvnStatusEntry[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
  selectedPaths?: Set<string>;
  onSelectionChange?: (paths: Set<string>) => void;
  onFileClick?: (file: SvnStatusEntry) => void;
  onFileDoubleClick?: (file: SvnStatusEntry) => void;
  estimatedRowHeight?: number;
  overscan?: number;
  loadThreshold?: number;
  className?: string;
}

/**
 * Virtualized file list optimized for 100k+ files
 */
export function VirtualizedFileList({
  files,
  onLoadMore,
  hasMore = false,
  isLoading = false,
  selectedPaths = EMPTY_SET,
  onSelectionChange,
  onFileClick,
  onFileDoubleClick,
  estimatedRowHeight = 32,
  overscan = 10,
  loadThreshold = 20,
  className = '',
}: VirtualizedFileListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Create virtualizer
  const rowVirtualizer = useVirtualizer({
    count: hasMore ? files.length + 1 : files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    getItemKey: (index) => files[index]?.path ?? `loading-${index}`,
    overscan,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Keep the viewport anchored when `files` is replaced by a status refresh.
  useScrollPositionAnchor(parentRef, rowVirtualizer, virtualItems, files);

  const lastItem = virtualItems.at(-1);

  // Trigger load more when approaching end
  const shouldLoadMore = useMemo(() => {
    return hasMore && !isLoading && lastItem && lastItem.index >= files.length - loadThreshold;
  }, [hasMore, isLoading, lastItem, files.length, loadThreshold]);

  // Handle load more in useEffect to avoid side effects during render
  useEffect(() => {
    if (shouldLoadMore && onLoadMore) {
      onLoadMore();
    }
  }, [shouldLoadMore, onLoadMore]);

  // Toggle selection
  const toggleSelection = useCallback(
    (file: SvnStatusEntry) => {
      if (!onSelectionChange) return;

      const newSelection = new Set(selectedPaths);
      if (newSelection.has(file.path)) {
        newSelection.delete(file.path);
      } else {
        newSelection.add(file.path);
      }
      onSelectionChange(newSelection);
    },
    [selectedPaths, onSelectionChange]
  );

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className}`}
      style={{ height: '100%', width: '100%' }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          // Loading placeholder
          if (virtualRow.index >= files.length) {
            return (
              <div
                key="loading"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex items-center justify-center"
              >
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                <span className="ml-2 text-sm text-slate-400">Loading more…</span>
              </div>
            );
          }

          const file = files[virtualRow.index];
          const isSelected = selectedPaths.has(file.path);
          const { icon, color, label } = getStatusDisplay(file.status);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={`
                flex items-center px-2 border-b border-slate-100 dark:border-slate-800
                hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer
                ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
              `}
              onClick={() => onFileClick?.(file)}
              onDoubleClick={() => onFileDoubleClick?.(file)}
            >
              {/* Selection checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSelection(file)}
                onClick={(e) => e.stopPropagation()}
                className="mr-2 w-4 h-4"
              />

              {/* Icon */}
              <span className="mr-2">
                {file.isDirectory ? (
                  <Folder className="w-4 h-4 text-amber-500" />
                ) : (
                  <File className="w-4 h-4 text-slate-400" />
                )}
              </span>

              {/* Filename */}
              <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300">
                {file.path.split(/[/\\]/).pop()}
              </span>

              {/* Status */}
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${color}`} title={label}>
                {icon} {file.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface CheckboxSelectionProps {
  /** Set of currently selected node paths */
  selectedKeys: Set<string>;
  /** Callback when selection changes */
  onSelectionChange: (keys: Set<string>) => void;
  /** Optional custom checkbox renderer */
  renderCheckbox?: (props: {
    checked: boolean | 'indeterminate';
    onChange: () => void;
    node: TreeNode;
  }) => React.ReactNode;
}

interface VirtualizedTreeProps {
  nodes: TreeNode[];
  onToggleExpand?: (node: TreeNode) => void;
  expandedPaths?: Set<string>;
  loadingPaths?: Set<string>;
  selectedPath?: string;
  onSelect?: (node: TreeNode) => void;
  estimatedRowHeight?: number;
  className?: string;
  /** Enable checkbox selection with tri-state support */
  checkboxSelection?: CheckboxSelectionProps;
}

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  hasChildren?: boolean;
  status?: SvnStatusChar;
  children?: TreeNode[];
}

type TriState = boolean | 'indeterminate';

interface FlattenedTreeNode {
  node: TreeNode;
  depth: number;
}

interface TreeSelectionMetadata {
  descendantPaths: string[];
}

interface TreeViewModel {
  flattenedNodes: FlattenedTreeNode[];
  selectionMetadata: Map<string, TreeSelectionMetadata>;
}

function buildTreeViewModel(nodes: TreeNode[], expandedPaths: Set<string>): TreeViewModel {
  const flattenedNodes: FlattenedTreeNode[] = [];
  const selectionMetadata = new Map<string, TreeSelectionMetadata>();

  const visit = (node: TreeNode, depth: number, includeInFlattenedRows: boolean): string[] => {
    if (includeInFlattenedRows) {
      flattenedNodes.push({ node, depth });
    }

    const descendantPaths: string[] = [];
    if (node.children) {
      for (const child of node.children) {
        descendantPaths.push(child.path);
        const childIsVisible = includeInFlattenedRows && expandedPaths.has(node.path);
        descendantPaths.push(...visit(child, depth + 1, childIsVisible));
      }
    }

    selectionMetadata.set(node.path, { descendantPaths });
    return descendantPaths;
  };

  for (const node of nodes) {
    visit(node, 0, true);
  }

  return { flattenedNodes, selectionMetadata };
}

function getDescendantPaths(
  node: TreeNode,
  selectionMetadata: Map<string, TreeSelectionMetadata>
): string[] {
  return selectionMetadata.get(node.path)?.descendantPaths ?? [];
}

function getTriState(
  node: TreeNode,
  selectedKeys: Set<string>,
  selectionMetadata: Map<string, TreeSelectionMetadata>
): TriState {
  const descendantPaths = getDescendantPaths(node, selectionMetadata);
  if (descendantPaths.length === 0) {
    return selectedKeys.has(node.path);
  }

  let selectedCount = 0;
  for (const path of descendantPaths) {
    if (selectedKeys.has(path)) {
      selectedCount++;
    }
  }

  if (selectedCount === 0) {
    return false;
  }
  if (selectedCount === descendantPaths.length) {
    return true;
  }
  return 'indeterminate';
}

function getSelectionStates(
  flattenedNodes: FlattenedTreeNode[],
  selectedKeys: Set<string>,
  selectionMetadata: Map<string, TreeSelectionMetadata>
): Map<string, TriState> {
  const selectionStates = new Map<string, TriState>();
  for (const { node } of flattenedNodes) {
    selectionStates.set(node.path, getTriState(node, selectedKeys, selectionMetadata));
  }
  return selectionStates;
}

/**
 * Virtualized tree view for large directory structures
 */
export function VirtualizedTree({
  nodes,
  onToggleExpand,
  expandedPaths = EMPTY_SET,
  loadingPaths = EMPTY_SET,
  selectedPath,
  onSelect,
  estimatedRowHeight = 28,
  className = '',
  checkboxSelection,
}: VirtualizedTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const { flattenedNodes, selectionMetadata } = useMemo(
    () => buildTreeViewModel(nodes, expandedPaths),
    [nodes, expandedPaths]
  );

  const checkboxSelectionStates = useMemo(() => {
    if (!checkboxSelection) {
      return undefined;
    }
    return getSelectionStates(flattenedNodes, checkboxSelection.selectedKeys, selectionMetadata);
  }, [checkboxSelection, flattenedNodes, selectionMetadata]);

  const rowVirtualizer = useVirtualizer({
    count: flattenedNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    getItemKey: (index) => flattenedNodes[index]?.node.id ?? index,
    overscan: 15,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // `flattenedNodes` gets a new identity whenever `nodes` is replaced (status
  // refresh delivering new objects) or the expansion state changes; keep the
  // viewport anchored to the same row across those updates.
  useScrollPositionAnchor(parentRef, rowVirtualizer, virtualItems, flattenedNodes);

  const toggleNodeSelection = useCallback(
    (node: TreeNode) => {
      if (!checkboxSelection) return;

      const { selectedKeys, onSelectionChange } = checkboxSelection;
      const newSelection = new Set(selectedKeys);
      const descendantPaths = getDescendantPaths(node, selectionMetadata);
      const triState = getTriState(node, selectedKeys, selectionMetadata);

      if (triState === true || triState === 'indeterminate') {
        newSelection.delete(node.path);
        for (const p of descendantPaths) {
          newSelection.delete(p);
        }
      } else {
        newSelection.add(node.path);
        for (const p of descendantPaths) {
          newSelection.add(p);
        }
      }

      onSelectionChange(newSelection);
    },
    [checkboxSelection, selectionMetadata]
  );

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className}`}
      style={{ height: '100%', width: '100%' }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const { node, depth } = flattenedNodes[virtualRow.index];
          const isExpanded = expandedPaths.has(node.path);
          const isLoading = loadingPaths.has(node.path);
          const isSelected = selectedPath === node.path;
          const checkboxState = checkboxSelectionStates?.get(node.path);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                paddingLeft: `${depth * 16}px`,
              }}
              className={`
                flex items-center px-2 border-b border-slate-100 dark:border-slate-800
                hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer
                ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
              `}
              onClick={() => onSelect?.(node)}
            >
              {checkboxSelection &&
                (checkboxSelection.renderCheckbox ? (
                  checkboxSelection.renderCheckbox({
                    checked: checkboxState ?? false,
                    onChange: () => toggleNodeSelection(node),
                    node,
                  })
                ) : (
                  <input
                    type="checkbox"
                    checked={checkboxState === true}
                    ref={(el) => {
                      if (el) el.indeterminate = checkboxState === 'indeterminate';
                    }}
                    onChange={() => toggleNodeSelection(node)}
                    onClick={(e) => e.stopPropagation()}
                    className="mr-2 w-4 h-4 flex-shrink-0"
                  />
                ))}

              {node.isDirectory && (
                <button
                  type="button"
                  className="mr-1 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand?.(node);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleExpand?.(node);
                    }
                  }}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                  ) : isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-500" />
                  )}
                </button>
              )}

              <span className="mr-2">
                {node.isDirectory ? (
                  isExpanded ? (
                    <FolderOpen className="w-4 h-4 text-amber-500" />
                  ) : (
                    <Folder className="w-4 h-4 text-amber-500" />
                  )
                ) : (
                  <File className="w-4 h-4 text-slate-400" />
                )}
              </span>

              <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300">
                {node.name}
              </span>

              {node.status && <span className="text-xs text-slate-400">{node.status}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LargeRepoIndicatorProps {
  fileCount: number;
  loadedCount: number;
  isLoading: boolean;
  className?: string;
}

/**
 * Progress indicator for large repos
 */
export function LargeRepoIndicator({
  fileCount,
  loadedCount,
  isLoading,
  className = '',
}: LargeRepoIndicatorProps) {
  const percentage = fileCount > 0 ? Math.round((loadedCount / fileCount) * 100) : 0;
  const formattedTotal = fileCount.toLocaleString();
  const formattedLoaded = loadedCount.toLocaleString();

  if (!isLoading && loadedCount >= fileCount) {
    return (
      <div className={`text-sm text-slate-500 dark:text-slate-400 ${className}`}>
        {formattedTotal} files
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-300">
          {isLoading ? (
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading {formattedLoaded} of {formattedTotal} files...
            </span>
          ) : (
            <span>
              {formattedLoaded} of {formattedTotal} files loaded
            </span>
          )}
        </span>
        <span className="text-slate-400">{percentage}%</span>
      </div>

      <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default VirtualizedFileList;
