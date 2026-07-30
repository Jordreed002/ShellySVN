import { useRef, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import type { SvnStatusEntry, SvnStatusChar } from '@shared/types';
import { getStatusDisplay } from '../../hooks/useIncrementalStatus';

// Module-level constant for default Set props to avoid new instances on every render
const EMPTY_SET = new Set<string>();

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
