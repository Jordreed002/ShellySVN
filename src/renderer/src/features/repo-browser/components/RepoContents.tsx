/**
 * The contents pane: a directory listing, or repository-wide search results.
 *
 * The footer always names which truth is on screen — "working copy · status
 * from disk" or "repository listing · nothing checked out here" — because the
 * columns mean different things in each case, and a client that leaves that
 * ambiguous is lying by omission.
 *
 * Presentational only: entries, sort state, selection and every handler arrive
 * as props. The list body is virtualized (`@tanstack/react-virtual`) because a
 * directory can hold thousands of entries; the ARIA grid stays valid because
 * `aria-rowcount`/`aria-rowindex` describe the full list while only a window of
 * rows exists in the DOM.
 *
 * Design source: `prototypes/12-browser.html` (`.chead`, `.crow`, `.cfoot`,
 * `.selbar`, `.scopechip`, `.empty`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowUp,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Package,
  Search,
} from 'lucide-react';

import type { RepoEntry, RepoScope, RepoSort, SearchScope } from '../types';
import {
  REPO_CONTENTS_ROW_HEIGHT,
  RepoContentsRow,
  repoContentsGridTemplate,
} from './RepoContentsRow';
import { useRepoBrowserLayout } from './RepoBrowserShell';

type SortKey = RepoSort['key'];

interface ColumnDef {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  /** Dropped when the pane is narrow, rather than letting the grid collide. */
  compactHidden: boolean;
}

/** Header columns after the checkbox and kind-icon gutters. */
const COLUMNS: readonly ColumnDef[] = [
  { key: 'name', label: 'Name', align: 'left', compactHidden: false },
  { key: 'revision', label: 'Rev', align: 'right', compactHidden: false },
  { key: 'author', label: 'Author', align: 'left', compactHidden: true },
  { key: 'date', label: 'Date', align: 'left', compactHidden: false },
  { key: 'size', label: 'Size', align: 'right', compactHidden: true },
  { key: 'status', label: 'Status', align: 'right', compactHidden: false },
];

/** Above this many entries the list body is windowed. */
const VIRTUALIZE_ABOVE = 120;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Coarse on purpose: the point is "not current", not a stopwatch. */
export function formatCacheAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function safeTime(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Sorting by status puts flagged entries first and unflagged ones last. */
function statusRank(entry: RepoEntry): string {
  if (entry.status) return `0${entry.status}`;
  if (entry.rollup && entry.rollup.conflicted > 0) return '0C';
  if (entry.rollup && entry.rollup.modified + entry.rollup.added > 0) return '0M';
  if (entry.isExternal) return '0X';
  return '9';
}

export interface RepoContentsProps {
  entries: readonly RepoEntry[];
  /** Which source of truth this listing came from. Gates every status column. */
  scope: RepoScope;
  /** Repo-relative path being listed, shown in the footer. */
  path?: string;
  /**
   * The live read failed and these entries came from the offline cache.
   *
   * Worth a footer of its own: every number in the listing is then as old as the
   * cache, and a stale revision presented as current is the kind of wrong that
   * makes someone commit against the wrong BASE.
   */
  fromCache?: boolean;
  /** Age of that cached read in milliseconds, for "cached 4 min ago". */
  cacheAgeMs?: number;
  /**
   * How many entries the directory really holds, when `entries` has been capped
   * upstream. Drives "Showing 200 of 4,812 — filter or search to narrow".
   */
  totalCount?: number;
  sort: RepoSort;
  onSortChange: (sort: RepoSort) => void;
  /** Repo-relative paths of checked rows. */
  selectedPaths?: readonly string[];
  onSelectionChange?: (paths: string[]) => void;
  /**
   * The current row. Pass it (even as `null`) to control the selection;
   * omit it and the list tracks its own.
   */
  activePath?: string | null;
  onActivate?: (entry: RepoEntry) => void;
  /** Enter / double click: navigate into a directory, open a file. */
  onOpen?: (entry: RepoEntry) => void;
  /** Backspace / Left arrow at the top of the list. */
  onNavigateUp?: () => void;
  /**
   * Narrow pane: drops the author and size columns rather than letting the grid
   * collide. Defaults to the shell's `contentsDensity` (narrow whenever the
   * detail pane is open), so the route only passes this to override.
   */
  compact?: boolean;
  /** The active filter text, used for the no-match copy. */
  filterText?: string;
  /** Whether the filter searched this folder or the whole repository. */
  searchScope?: SearchScope;
  /** Offered from the no-match state when the search was folder-scoped. */
  onWidenSearchScope?: () => void;
  /** Show each entry's directory beside its name. Defaults on for repository-wide results. */
  showPaths?: boolean;
  onCheckoutSelection?: (entries: RepoEntry[]) => void;
  onExportSelection?: (entries: RepoEntry[]) => void;
  onCopyUrls?: (entries: RepoEntry[]) => void;
  onDiff?: (entry: RepoEntry) => void;
  onBlame?: (entry: RepoEntry) => void;
  onLog?: (entry: RepoEntry) => void;
  onCheckout?: (entry: RepoEntry) => void;
  onContextMenu?: (entry: RepoEntry, event: ReactMouseEvent<HTMLDivElement>) => void;
  className?: string;
}

export function RepoContents({
  entries,
  scope,
  path,
  fromCache = false,
  cacheAgeMs = 0,
  totalCount,
  sort,
  onSortChange,
  selectedPaths,
  onSelectionChange,
  activePath,
  onActivate,
  onOpen,
  onNavigateUp,
  compact: compactProp,
  filterText = '',
  searchScope = 'folder',
  onWidenSearchScope,
  showPaths,
  onCheckoutSelection,
  onExportSelection,
  onCopyUrls,
  onDiff,
  onBlame,
  onLog,
  onCheckout,
  onContextMenu,
  className,
}: RepoContentsProps): ReactElement {
  /*
   * The shell publishes how much width this pane actually has. Reading it here
   * means the column budget stays correct without the route threading a flag
   * through; an explicit `compact` prop still wins.
   */
  const layout = useRepoBrowserLayout();
  const compact = compactProp ?? layout.contentsDensity === 'narrow';

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<string | null>(null);

  const [uncontrolledActive, setUncontrolledActive] = useState<string | null>(null);
  const effectiveActivePath = activePath !== undefined ? activePath : uncontrolledActive;

  const selectedSet = useMemo(() => new Set(selectedPaths ?? []), [selectedPaths]);
  const visibleColumns = useMemo(
    () => COLUMNS.filter((column) => !(compact && column.compactHidden)),
    [compact]
  );

  /*
   * Directories always sort first, whatever the key. A directory and a file are
   * different kinds of thing, and mixing them by size or author makes a listing
   * that nobody can scan.
   */
  const sorted = useMemo(() => {
    const direction = sort.direction === 'asc' ? 1 : -1;

    return [...entries].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;

      let comparison: number;
      switch (sort.key) {
        case 'revision':
          comparison = a.revision - b.revision;
          break;
        case 'author':
          comparison = collator.compare(a.author, b.author);
          break;
        case 'date':
          comparison = safeTime(a.date) - safeTime(b.date);
          break;
        case 'size':
          comparison = (a.size ?? 0) - (b.size ?? 0);
          break;
        case 'status':
          comparison = collator.compare(statusRank(a), statusRank(b));
          break;
        default:
          comparison = collator.compare(a.name, b.name);
      }

      if (comparison === 0 && sort.key !== 'name') {
        comparison = collator.compare(a.name, b.name);
      }
      return comparison * direction;
    });
  }, [entries, sort]);

  /**
   * Directories of a few dozen entries render as plain rows: cheap, and free of
   * any dependency on the pane having been measured. Only genuinely large
   * directories pay for windowing.
   */
  const virtualized = sorted.length > VIRTUALIZE_ABOVE;

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => REPO_CONTENTS_ROW_HEIGHT,
    getItemKey: (index) => sorted[index]?.path ?? index,
    overscan: 12,
    /* A plausible first window before the pane has been measured. */
    initialRect: { width: 0, height: 480 },
  });

  const activeIndex = useMemo(
    () =>
      effectiveActivePath ? sorted.findIndex((entry) => entry.path === effectiveActivePath) : -1,
    [sorted, effectiveActivePath]
  );
  /** Exactly one row is tabbable at a time (roving tabindex). */
  const tabbableIndex = activeIndex >= 0 ? activeIndex : 0;

  // Move focus onto a row the keyboard just navigated to, once it is mounted.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const node = rowNodes.current.get(target);
    if (node) {
      node.focus();
      pendingFocus.current = null;
    }
  });

  const handleActivate = useCallback(
    (entry: RepoEntry) => {
      setUncontrolledActive(entry.path);
      onActivate?.(entry);
    },
    [onActivate]
  );

  const handleSelectedChange = useCallback(
    (entry: RepoEntry, next: boolean) => {
      if (!onSelectionChange) return;
      const paths = new Set(selectedSet);
      if (next) paths.add(entry.path);
      else paths.delete(entry.path);
      onSelectionChange([...paths]);
    },
    [onSelectionChange, selectedSet]
  );

  const moveTo = useCallback(
    (index: number) => {
      if (sorted.length === 0) return;
      const clamped = Math.max(0, Math.min(sorted.length - 1, index));
      const entry = sorted[clamped];
      if (!entry) return;
      pendingFocus.current = entry.path;
      // Unwindowed rows are already in the DOM; focusing them scrolls them in.
      if (virtualized) rowVirtualizer.scrollToIndex(clamped, { align: 'auto' });
      handleActivate(entry);
    },
    [sorted, virtualized, rowVirtualizer, handleActivate]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Let controls inside a row (checkbox, row tools) keep their own keys.
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, input, a, select')) return;

      const current = activeIndex >= 0 ? activeIndex : -1;
      const entry = current >= 0 ? sorted[current] : undefined;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveTo(current + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveTo(current <= 0 ? 0 : current - 1);
          break;
        case 'Home':
          event.preventDefault();
          moveTo(0);
          break;
        case 'End':
          event.preventDefault();
          moveTo(sorted.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          if (entry) onOpen?.(entry);
          break;
        case 'ArrowRight':
          if (entry?.kind === 'dir') {
            event.preventDefault();
            onOpen?.(entry);
          }
          break;
        case 'ArrowLeft':
        case 'Backspace':
          if (onNavigateUp) {
            event.preventDefault();
            onNavigateUp();
          }
          break;
        case ' ':
          event.preventDefault();
          if (entry) handleSelectedChange(entry, !selectedSet.has(entry.path));
          break;
        default:
          break;
      }
    },
    [activeIndex, sorted, moveTo, onOpen, onNavigateUp, handleSelectedChange, selectedSet]
  );

  const handleSort = useCallback(
    (key: SortKey) => {
      onSortChange({
        key,
        direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
      });
    },
    [onSortChange, sort]
  );

  const selectedEntries = useMemo(
    () => sorted.filter((entry) => selectedSet.has(entry.path)),
    [sorted, selectedSet]
  );

  const shown = sorted.length;
  const total = totalCount ?? shown;
  const truncated = total > shown && filterText.length === 0;
  const searchingRepository = searchScope === 'repository' && filterText.length > 0;
  const showEntryPaths = showPaths ?? searchingRepository;
  const isEmpty = shown === 0;
  const gridTemplate = repoContentsGridTemplate(compact);

  const renderRow = (entry: RepoEntry, index: number, style: CSSProperties): ReactElement => (
    <RepoContentsRow
      key={entry.path}
      rowRef={(node) => {
        if (node) rowNodes.current.set(entry.path, node);
        else rowNodes.current.delete(entry.path);
      }}
      entry={entry}
      scope={scope}
      compact={compact}
      selected={selectedSet.has(entry.path)}
      active={index === activeIndex}
      tabbable={index === tabbableIndex}
      showPath={showEntryPaths}
      /* Row 1 is the header, so data rows start at 2 — and the index is the
         position in the whole list, not in the rendered window. */
      rowIndex={index + 2}
      style={style}
      onSelectedChange={handleSelectedChange}
      onActivate={handleActivate}
      onOpen={(target) => onOpen?.(target)}
      onContextMenu={onContextMenu}
      onDiff={onDiff}
      onBlame={onBlame}
      onLog={onLog}
      onCheckout={onCheckout}
    />
  );

  return (
    <section
      /* h-full + flex-1 so the pane fills its column and the footer pins to the
         bottom — without them the listing collapses to content height and the
         footer floats in the middle of an empty pane. */
      className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg${className ? ` ${className}` : ''}`}
    >
      {/* The checked-out subtree is a different kind of truth — mark its edge. */}
      {scope === 'working-copy' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-[3] w-[3px] bg-accent/40"
        />
      )}

      {selectedEntries.length > 0 && (
        <div
          role="region"
          aria-label="Selection actions"
          className="flex flex-none items-center gap-2 bg-text px-3.5 py-1.5 text-bg"
        >
          <b className="text-xs" aria-live="polite">
            {selectedEntries.length} selected
          </b>
          <span className="flex-1" />
          {onCheckoutSelection && (
            <SelectionButton
              icon={<Download className="h-3 w-3" aria-hidden="true" />}
              label="Checkout"
              onClick={() => onCheckoutSelection([...selectedEntries])}
            />
          )}
          {onExportSelection && (
            <SelectionButton
              icon={<ExternalLink className="h-3 w-3" aria-hidden="true" />}
              label="Export"
              onClick={() => onExportSelection([...selectedEntries])}
            />
          )}
          {onCopyUrls && (
            <SelectionButton
              icon={<Copy className="h-3 w-3" aria-hidden="true" />}
              label="Copy URLs"
              onClick={() => onCopyUrls([...selectedEntries])}
            />
          )}
          <SelectionButton label="Clear" onClick={() => onSelectionChange?.([])} />
        </div>
      )}

      <div
        role="grid"
        aria-label={scope === 'working-copy' ? 'Working copy contents' : 'Repository contents'}
        aria-multiselectable="true"
        aria-rowcount={shown + 1}
        aria-colcount={visibleColumns.length + 2}
        className={`flex min-h-0 flex-col ${isEmpty ? 'flex-none' : 'flex-1'}`}
        onKeyDown={handleKeyDown}
      >
        <div role="rowgroup" className="sticky top-0 z-[2] flex-none">
          <div
            role="row"
            aria-rowindex={1}
            className="grid h-8 items-center gap-[9px] border-b border-border bg-bg-secondary px-3"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <span role="columnheader" aria-label="Select" />
            <span role="columnheader" aria-label="Kind" />
            {visibleColumns.map((column) => {
              const isSorted = sort.key === column.key;
              return (
                <span
                  key={column.key}
                  role="columnheader"
                  aria-sort={
                    isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className="min-w-0"
                >
                  <button
                    type="button"
                    onClick={() => handleSort(column.key)}
                    className={`flex w-full items-center gap-1 overflow-hidden whitespace-nowrap text-2xs font-bold uppercase tracking-widest ${
                      column.align === 'right' ? 'justify-end' : 'justify-start'
                    } ${isSorted ? 'text-accent' : 'text-text-faint hover:text-text-secondary'}`}
                  >
                    {column.label}
                    <ArrowUp
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 shrink-0 transition-transform ${
                        isSorted ? 'opacity-100' : 'opacity-0'
                      } ${isSorted && sort.direction === 'desc' ? 'rotate-180' : ''}`}
                    />
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        {!isEmpty && (
          <div role="rowgroup" ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            {virtualized ? (
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = sorted[virtualRow.index];
                  if (!entry) return null;
                  return renderRow(entry, virtualRow.index, {
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  });
                })}
              </div>
            ) : (
              <div className="relative">
                {sorted.map((entry, index) =>
                  renderRow(entry, index, {
                    position: 'relative',
                    height: `${REPO_CONTENTS_ROW_HEIGHT}px`,
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isEmpty && (
        <div className="flex-1 overflow-auto px-4 py-8 text-center text-xs leading-relaxed text-text-secondary">
          {filterText ? (
            <>
              <Search className="mx-auto mb-2 h-6 w-6 text-text-faint" aria-hidden="true" />
              <p>
                Nothing matches <b className="font-mono text-text">{filterText}</b>
                {searchingRepository ? ' anywhere in the repository.' : ' in this folder.'}
              </p>
              {!searchingRepository && (
                <p className="mt-1 text-text-muted">
                  Try widening the scope to the whole repository.
                </p>
              )}
              {!searchingRepository && onWidenSearchScope && (
                <button
                  type="button"
                  onClick={onWidenSearchScope}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs font-semibold text-text hover:border-accent hover:text-accent"
                >
                  <Search className="h-3 w-3" aria-hidden="true" />
                  Search the whole repository
                </button>
              )}
            </>
          ) : (
            <>
              <FolderOpen className="mx-auto mb-2 h-6 w-6 text-text-faint" aria-hidden="true" />
              <p>Empty directory.</p>
              <p className="mt-1 text-text-muted">
                {scope === 'working-copy'
                  ? 'Nothing here in the repository and nothing on disk.'
                  : 'Nothing at this path in the repository at this revision.'}
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex h-[30px] flex-none items-center gap-3 border-t border-border bg-bg-secondary px-3.5 text-xs text-text-secondary">
        <span>
          {searchingRepository ? (
            <>
              <b className="font-semibold text-text">{shown.toLocaleString()}</b>{' '}
              {shown === 1 ? 'path matches' : 'paths match'}{' '}
              <span className="font-mono">&ldquo;{filterText}&rdquo;</span> across the repository
              {total > shown ? ` (first ${shown.toLocaleString()})` : ''}
            </>
          ) : filterText ? (
            <>
              <b className="font-semibold text-text">{shown.toLocaleString()}</b> of{' '}
              {total.toLocaleString()} in this folder
            </>
          ) : truncated ? (
            <>
              Showing <b className="font-semibold text-text">{shown.toLocaleString()}</b> of{' '}
              {total.toLocaleString()} — filter or search to narrow
            </>
          ) : (
            <>
              <b className="font-semibold text-text">{shown.toLocaleString()}</b>{' '}
              {shown === 1 ? 'entry' : 'entries'}
            </>
          )}
        </span>
        <span className="flex-1" />
        {fromCache && (
          <span
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-svn-modified/40 bg-svn-modified/10 px-2 py-px text-2xs font-bold text-svn-modified"
            title="The server could not be reached, so this listing was read from the offline cache. Refresh to try again."
          >
            <CloudOff className="h-3 w-3" aria-hidden="true" />
            cached {formatCacheAge(cacheAgeMs)}
          </span>
        )}
        <RepoScopeChip scope={scope} />
        {path !== undefined && (
          <span
            className="min-w-0 max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs text-text-faint"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={`^/${path}`}
          >
            ^/{path}
          </span>
        )}
      </div>
    </section>
  );
}

function SelectionButton({
  icon,
  label,
  onClick,
}: {
  icon?: ReactElement;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-bg/20 bg-bg/10 px-2.5 text-xs font-semibold text-bg hover:bg-bg/20"
    >
      {icon}
      {label}
    </button>
  );
}

export interface RepoScopeChipProps {
  scope: RepoScope;
}

/**
 * Names the source of truth on screen. Without this the same columns mean two
 * different things depending on where you happen to be standing.
 */
export function RepoScopeChip({ scope }: RepoScopeChipProps): ReactElement {
  if (scope === 'working-copy') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 bg-accent/10 px-2 py-px text-2xs font-bold text-accent">
        <HardDrive className="h-3 w-3" aria-hidden="true" />
        working copy · status from disk
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-bg-tertiary px-2 py-px text-2xs font-bold text-text-muted">
      <Package className="h-3 w-3" aria-hidden="true" />
      repository listing · nothing checked out here
    </span>
  );
}
