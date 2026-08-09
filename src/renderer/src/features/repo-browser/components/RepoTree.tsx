/**
 * Lazily-expanded repository tree — the left pane of the repository browser.
 *
 * Design source: `prototypes/12-browser.html` (`.treepane` / `renderTree`).
 *
 * The component is purely presentational. Expanded state, loading state and
 * children all arrive as props; the only way out is `onToggleExpand(path)`.
 * It knows nothing about `window.api`, TanStack Query or the router.
 *
 * Two rules from the spec are enforced here:
 *
 * 1. **`svn ls` is not `svn status`.** Roll-up badges render only for entries
 *    that carry a `rollup` — i.e. entries inside a working copy. Outside a
 *    checkout the tree shows repository facts (entry counts) and nothing else.
 * 2. **Scale honesty.** A directory bigger than the display cap renders
 *    "… N more — search instead"; an expanded directory whose children have not
 *    arrived renders a spinner and "listing N entries…". Never an empty node.
 *
 * The pane is the prototype's `.treepane`: a `--card2` surface (`bg-bg-secondary`)
 * with an optional 30px `.treehead` above the scroller. The header is opt-in —
 * pass `showHeader` — and lives OUTSIDE the `role="tree"` element so the tree's
 * only ARIA children stay `treeitem`s.
 */

import { ChevronsDownUp } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { RepoEntry } from '../types';
import {
  RepoTreeMoreRow,
  RepoTreeNode,
  RepoTreeStatusRow,
  TREE_AUX_ROW_HEIGHT,
  TREE_ROW_HEIGHT,
} from './RepoTreeNode';

/** Identity of the synthetic top level, kept separate from any real entry path (which may be `''`). */
const ROOT_KEY = '#root';
const MORE_SUFFIX = '#more';
const STATUS_SUFFIX = '#status';

/** One rendered line of the tree, after the recursive structure has been flattened. */
export type RepoTreeRow =
  | {
      kind: 'entry';
      id: string;
      depth: number;
      level: number;
      posInSet: number;
      setSize: number;
      parentId: string | null;
      entry: RepoEntry;
      expandable: boolean;
      expanded: boolean;
      loadingChildren: boolean;
      childCount?: number;
    }
  | {
      kind: 'more';
      id: string;
      depth: number;
      level: number;
      posInSet: number;
      setSize: number;
      parentId: string | null;
      containerPath: string;
      hiddenCount: number;
    }
  | {
      kind: 'status';
      id: string;
      depth: number;
      level: number;
      posInSet: number;
      setSize: number;
      parentId: string | null;
      containerPath: string;
      label: string;
      busy: boolean;
    };

export interface RepoTreeProps {
  /** Top-level entries. Pass a single synthetic root entry to mirror the prototype's `/` node. */
  roots: RepoEntry[];
  /**
   * Loaded children keyed by the parent's repository-relative path.
   * `undefined` means "not fetched yet" and produces a "listing…" row when expanded.
   */
  childrenByPath?: Readonly<Record<string, RepoEntry[] | undefined>>;
  /** Repository-relative paths that are currently expanded. */
  expandedPaths: ReadonlySet<string>;
  /** Paths whose children are being fetched right now. */
  loadingPaths?: ReadonlySet<string>;
  /**
   * Entries each directory holds on the server, when known (from `svn list`).
   * Drives the count badge, the "listing N entries…" copy and the hidden-count maths.
   */
  childCountByPath?: Readonly<Record<string, number | undefined>>;
  /** Repository-relative path of the highlighted node. */
  selectedPath?: string | null;
  /** The top level itself is still loading. */
  isLoading?: boolean;
  /** Maximum children rendered per directory before the "… N more" affordance. */
  childDisplayCap?: number;
  /** Rows above this count are virtualized; below it every row stays in the DOM. */
  virtualizeThreshold?: number;
  /** Accessible name for the tree. */
  label?: string;
  /**
   * Render the prototype's `.treehead` above the scroller. Opt-in: without it the
   * component is exactly the scroll container it has always been, so existing
   * callers that supply their own header are unaffected.
   */
  showHeader?: boolean;
  /** Eyebrow text in the header. Only read when `showHeader` is set. */
  headerTitle?: string;
  /**
   * Collapse-all handler. When supplied *and* the header is shown, the header
   * gets the prototype's icon-only "Collapse all" button. The tree owns no
   * expansion state, so collapsing is the caller's job.
   */
  onCollapseAll?: () => void;
  className?: string;
  onToggleExpand: (path: string) => void;
  onSelect?: (entry: RepoEntry) => void;
  onContextMenu?: (entry: RepoEntry, event: ReactMouseEvent<HTMLElement>) => void;
  /** Fired by "… N more — search instead" with the capped directory's path. */
  onSearchRequest?: (containerPath: string, hiddenCount: number) => void;
}

/**
 * `.treepane`'s `background:var(--card2)`.
 *
 * The prototype orders its surfaces `--sunk < --bg < --card2 < --card`. The app
 * has one panel surface between the canvas and the raised fills — `bg-secondary`
 * — and already spends it on every `--card2` element that has been ported
 * (`RepoAddressBar`, `RepoNavBar`'s search field, the shell's sidebar and detail
 * slots). The tree pane joins them rather than earning a token of its own.
 */
const PANE_SURFACE = 'bg-bg-secondary';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

interface BuildRowsInput {
  roots: RepoEntry[];
  childrenByPath: Readonly<Record<string, RepoEntry[] | undefined>>;
  expandedPaths: ReadonlySet<string>;
  loadingPaths: ReadonlySet<string>;
  childCountByPath: Readonly<Record<string, number | undefined>>;
  cap: number;
  isLoading: boolean;
}

/** Flatten the visible part of the tree into rows, adding the honesty rows as we go. */
function buildRows(input: BuildRowsInput): RepoTreeRow[] {
  const { roots, childrenByPath, expandedPaths, loadingPaths, childCountByPath, cap, isLoading } =
    input;
  const rows: RepoTreeRow[] = [];

  const emitLevel = (
    entries: RepoEntry[] | undefined,
    containerPath: string,
    containerKey: string,
    parentId: string | null,
    depth: number,
    loading: boolean,
    /** Server-side entry count for this level, when known. Never inferred for the top level. */
    declaredTotal: number | undefined
  ): void => {
    const loaded = entries ?? [];
    const shown = loaded.length > cap ? loaded.slice(0, cap) : loaded;
    const total = declaredTotal ?? loaded.length;
    const pending = entries === undefined || loading;

    let statusLabel: string | null = null;
    let statusBusy = false;
    if (shown.length === 0) {
      if (pending) {
        statusLabel = total > 0 ? `listing ${formatCount(total)} entries…` : 'listing entries…';
        statusBusy = true;
      } else {
        statusLabel = 'no entries';
      }
    }

    // Never claim "N more" while we are still listing — nothing has been hidden yet.
    const hiddenCount = statusBusy ? 0 : Math.max(0, total - shown.length);
    const setSize = shown.length + (statusLabel === null ? 0 : 1) + (hiddenCount > 0 ? 1 : 0);
    const level = depth + 1;

    shown.forEach((entry, index) => {
      const loadedChildren = childrenByPath[entry.path];
      const declaredChildCount = childCountByPath[entry.path];
      const childCount = declaredChildCount ?? loadedChildren?.length;
      const expandable = entry.kind === 'dir' && childCount !== 0;
      const expanded = expandable && expandedPaths.has(entry.path);
      const loadingChildren = loadingPaths.has(entry.path);

      rows.push({
        kind: 'entry',
        id: entry.path,
        depth,
        level,
        posInSet: index + 1,
        setSize,
        parentId,
        entry,
        expandable,
        expanded,
        loadingChildren,
        childCount,
      });

      if (expanded) {
        emitLevel(
          loadedChildren,
          entry.path,
          entry.path,
          entry.path,
          depth + 1,
          loadingChildren,
          declaredChildCount
        );
      }
    });

    if (statusLabel !== null) {
      rows.push({
        kind: 'status',
        id: `${containerKey}${STATUS_SUFFIX}`,
        depth,
        level,
        posInSet: shown.length + 1,
        setSize,
        parentId,
        containerPath,
        label: statusLabel,
        busy: statusBusy,
      });
    }

    if (hiddenCount > 0) {
      rows.push({
        kind: 'more',
        id: `${containerKey}${MORE_SUFFIX}`,
        depth,
        level,
        posInSet: setSize,
        setSize,
        parentId,
        containerPath,
        hiddenCount,
      });
    }
  };

  // The top level never reads `childCountByPath`: the caller may pass a single
  // synthetic root entry whose own path is `''`, and borrowing its child count
  // here would invent a phantom "… N more" row.
  emitLevel(
    isLoading && roots.length === 0 ? undefined : roots,
    '',
    ROOT_KEY,
    null,
    0,
    isLoading,
    undefined
  );
  return rows;
}

export function RepoTree({
  roots,
  childrenByPath,
  expandedPaths,
  loadingPaths,
  childCountByPath,
  selectedPath,
  isLoading = false,
  childDisplayCap = 40,
  virtualizeThreshold = 60,
  label = 'Repository tree',
  showHeader = false,
  headerTitle = 'Repository tree',
  onCollapseAll,
  className,
  onToggleExpand,
  onSelect,
  onContextMenu,
  onSearchRequest,
}: RepoTreeProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const emptyChildren = useMemo<Record<string, RepoEntry[] | undefined>>(() => ({}), []);
  const emptyCounts = useMemo<Record<string, number | undefined>>(() => ({}), []);
  const emptyPaths = useMemo<ReadonlySet<string>>(() => new Set<string>(), []);

  const rows = useMemo(
    () =>
      buildRows({
        roots,
        childrenByPath: childrenByPath ?? emptyChildren,
        expandedPaths,
        loadingPaths: loadingPaths ?? emptyPaths,
        childCountByPath: childCountByPath ?? emptyCounts,
        cap: childDisplayCap,
        isLoading,
      }),
    [
      roots,
      childrenByPath,
      expandedPaths,
      loadingPaths,
      childCountByPath,
      childDisplayCap,
      isLoading,
      emptyChildren,
      emptyCounts,
      emptyPaths,
    ]
  );

  /* ── roving tabindex: exactly one row is tabbable ── */
  const rowIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const activeId =
    focusedId !== null && rowIds.has(focusedId)
      ? focusedId
      : selectedPath != null && rowIds.has(selectedPath)
        ? selectedPath
        : (rows[0]?.id ?? null);
  const activeIndex = activeId === null ? -1 : rows.findIndex((row) => row.id === activeId);

  // Virtualize only once the pane has a measurable viewport. Without a height
  // the virtualizer would render a single row, so an unmeasured container (a
  // test renderer, a collapsed pane) falls back to rendering every row.
  const [viewportMeasured, setViewportMeasured] = useState(false);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = (): void => setViewportMeasured(element.clientHeight > 0);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shouldVirtualize = viewportMeasured && rows.length > virtualizeThreshold;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === 'entry' ? TREE_ROW_HEIGHT : TREE_AUX_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 12,
  });
  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];

  // The tabbable row can be scrolled out of the virtual window; keep one tab stop
  // by letting the scroll container take the tab and forwarding focus inwards.
  const activeRowRendered =
    !shouldVirtualize || virtualItems.some((item) => item.index === activeIndex);

  const focusRow = (index: number): void => {
    const row = rows[index];
    if (!row) return;
    setFocusedId(row.id);
    pendingFocusRef.current = row.id;
    if (shouldVirtualize) virtualizer.scrollToIndex(index, { align: 'auto' });
  };

  // Runs after every render: if a keyboard move is pending, put DOM focus on the
  // row once the virtualizer has actually rendered it.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    const container = scrollRef.current;
    if (!container) return;
    const candidates = container.querySelectorAll<HTMLElement>('[data-tree-row-id]');
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate && candidate.dataset.treeRowId === pending) {
        pendingFocusRef.current = null;
        candidate.focus();
        return;
      }
    }
  });

  const activate = (row: RepoTreeRow): void => {
    if (row.kind === 'entry') onSelect?.(row.entry);
    else if (row.kind === 'more') onSearchRequest?.(row.containerPath, row.hiddenCount);
  };

  /** WAI-ARIA tree keyboard model. */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
    const row = rows[index];
    if (!row) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(Math.min(index + 1, rows.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(Math.max(index - 1, 0));
        return;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        return;
      case 'End':
        event.preventDefault();
        focusRow(rows.length - 1);
        return;
      case 'ArrowRight': {
        event.preventDefault();
        if (row.kind !== 'entry' || !row.expandable) return;
        if (!row.expanded) {
          onToggleExpand(row.entry.path);
        } else if (rows[index + 1]?.parentId === row.id) {
          focusRow(index + 1);
        }
        return;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        if (row.kind === 'entry' && row.expandable && row.expanded) {
          onToggleExpand(row.entry.path);
          return;
        }
        if (row.parentId === null) return;
        const parentIndex = rows.findIndex((candidate) => candidate.id === row.parentId);
        if (parentIndex >= 0) focusRow(parentIndex);
        return;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(row);
        return;
      default:
        break;
    }

    // Type-ahead over entry names, as recommended by the tree pattern.
    if (
      event.key.length !== 1 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !/\S/.test(event.key)
    )
      return;
    const now = Date.now();
    const text =
      now - typeaheadRef.current.at > 700 ? event.key : typeaheadRef.current.text + event.key;
    typeaheadRef.current = { text, at: now };
    const needle = text.toLowerCase();
    for (let step = 1; step <= rows.length; step += 1) {
      const candidateIndex = (index + step) % rows.length;
      const candidate = rows[candidateIndex];
      if (candidate?.kind === 'entry' && candidate.entry.name.toLowerCase().startsWith(needle)) {
        event.preventDefault();
        focusRow(candidateIndex);
        return;
      }
    }
  };

  const handleContainerFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.target !== scrollRef.current) return;
    focusRow(activeIndex >= 0 ? activeIndex : 0);
  };

  const renderRow = (row: RepoTreeRow, index: number, style?: CSSProperties): JSX.Element => {
    const shared = {
      rowId: row.id,
      depth: row.depth,
      level: row.level,
      posInSet: row.posInSet,
      setSize: row.setSize,
      tabbable: row.id === activeId,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => handleKeyDown(event, index),
      onFocus: () => {
        // Keep the roving tabindex on whatever the pointer or Tab key focused,
        // but never re-set the same id (keyboard moves already set it).
        if (focusedId !== row.id) setFocusedId(row.id);
      },
      style,
    };

    if (row.kind === 'entry') {
      return (
        <RepoTreeNode
          key={row.id}
          {...shared}
          entry={row.entry}
          expandable={row.expandable}
          expanded={row.expanded}
          loadingChildren={row.loadingChildren}
          selected={selectedPath != null && row.entry.path === selectedPath}
          childCount={row.childCount}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      );
    }

    if (row.kind === 'more') {
      return (
        <RepoTreeMoreRow
          key={row.id}
          {...shared}
          containerPath={row.containerPath}
          hiddenCount={row.hiddenCount}
          onSearchRequest={onSearchRequest}
        />
      );
    }

    return <RepoTreeStatusRow key={row.id} {...shared} label={row.label} busy={row.busy} />;
  };

  // `.tree` — the scroller. Padding is the prototype's `5px 7px 14px`.
  // `min-h-0 flex-1 overflow-auto` keeps it scrolling inside a fixed-height
  // column, with the header (when present) pinned above it.
  const scroller = (
    <div
      ref={scrollRef}
      tabIndex={activeRowRendered ? -1 : 0}
      onFocus={handleContainerFocus}
      className={cx(
        'min-h-0 flex-1 overflow-auto px-[7px] pb-3.5 pt-[5px] outline-none',
        // Without a header this element *is* the pane, so it carries the surface
        // and the caller's className.
        !showHeader && cx(PANE_SURFACE, className)
      )}
    >
      <div
        role="tree"
        aria-label={label}
        aria-busy={isLoading || undefined}
        className="relative"
        style={shouldVirtualize ? { height: virtualizer.getTotalSize() } : undefined}
      >
        {shouldVirtualize
          ? virtualItems.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return renderRow(row, item.index, {
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              });
            })
          : rows.map((row, index) => renderRow(row, index))}
      </div>
    </div>
  );

  if (!showHeader) return scroller;

  // `.treepane` — header outside the tree, so `role="tree"` keeps only treeitems.
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', PANE_SURFACE, className)}>
      <div className="flex h-control-md flex-none items-center gap-2 border-b border-border px-[11px]">
        <span className="eyebrow min-w-0 flex-1 truncate">{headerTitle}</span>
        {onCollapseAll && (
          <button
            type="button"
            onClick={onCollapseAll}
            title="Collapse all"
            aria-label="Collapse all"
            // The prototype's button is icon-sized (12px). A 24px target is the
            // smallest that is comfortably clickable, so the box grows and is
            // pulled back by half the extra width — the 12px glyph still lands
            // 11px from the pane edge, exactly where the prototype puts it.
            className="-mr-1.5 grid h-control-xs w-control-xs flex-none place-items-center rounded-4 text-text-faint outline-none transition-colors hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-border-focus"
          >
            <ChevronsDownUp aria-hidden="true" className="h-3 w-3" />
          </button>
        )}
      </div>
      {scroller}
    </div>
  );
}
