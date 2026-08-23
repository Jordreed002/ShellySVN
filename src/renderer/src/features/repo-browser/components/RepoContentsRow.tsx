/**
 * One row of the repository-browser contents list.
 *
 * Two rules govern this file and neither is negotiable:
 *
 * 1. **Status only inside a working copy.** `svn list` describes the server;
 *    `svn status` describes your disk. Outside a checkout the status cell stays
 *    empty rather than implying the server knows about local edits. The single
 *    exception is `svn:externals`, which is a repository fact.
 * 2. **Paths never break the layout.** The directory portion of a path truncates
 *    from the left so the filename survives; the filename only truncates once
 *    the directory has nothing left to give.
 *
 * Design source: `prototypes/12-browser.html` (`.crow`, `.cname`, `.cst`,
 * `.rowtools`).
 */

import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement, Ref } from 'react';
import { File, FileImage, Folder } from 'lucide-react';

import type { RepoEntry, RepoScope } from '../types';
import type { RepoDragEventLike } from '../lib/repoDragDrop';
import { RepoLockFlag, RepoPresenceFlag, RepoRollupFlags, RepoStatusFlag } from './RepoStatusFlag';

/** Row height in pixels. Exported so the virtualizer can estimate without measuring. */
export const REPO_CONTENTS_ROW_HEIGHT = 38;

/**
 * The grid track list shared by the header and every row.
 *
 * The pane is narrow whenever the detail pane is open, so `compact` drops the
 * author and size columns rather than letting the grid collide. The name track
 * keeps a `minmax()` floor in both layouts — an earlier version let it collapse
 * to zero width, which is the one failure this list cannot have.
 */
export function repoContentsGridTemplate(compact: boolean): string {
  return compact
    ? '22px 20px minmax(120px, 1fr) 52px 84px 78px'
    : '22px 20px minmax(160px, 1fr) 62px 100px 112px 80px 92px';
}

const CELL_TEXT = 'overflow-hidden text-ellipsis whitespace-nowrap text-xs text-text-secondary';
const CELL_NUM = 'overflow-hidden text-right font-mono text-xs text-text-muted';

function KindIcon({ entry }: { entry: RepoEntry }): ReactElement {
  if (entry.kind === 'dir') {
    return <Folder className="h-4 w-4 text-accent" aria-hidden="true" />;
  }
  if (/\.(png|jpe?g|gif|svg|webp|psd|ico)$/i.test(entry.name)) {
    return <FileImage className="h-4 w-4 text-text-muted" aria-hidden="true" />;
  }
  return <File className="h-4 w-4 text-text-muted" aria-hidden="true" />;
}

/** Bytes as Subversion-ish shorthand. Directories have no size. */
export function formatEntrySize(size: number | undefined): string {
  if (size === undefined) return '—';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Short relative age, with the exact timestamp available on hover. */
export function formatEntryDate(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} mo`;
  return `${Math.round(days / 365.25)} y`;
}

export interface RepoContentsRowProps {
  entry: RepoEntry;
  /**
   * Which truth on screen. `repository` suppresses every `svn status`
   * derived cell — there is no working copy to have a status.
   */
  scope: RepoScope;
  /** Drop the author and size columns when the pane is narrow. */
  compact?: boolean;
  /** Ticked in the selection checkbox. */
  selected?: boolean;
  /** The row that owns focus and drives the detail pane. */
  active?: boolean;
  /**
   * Roving tabindex: exactly one row in the list is reachable with Tab.
   * Defaults to `active`; set it separately when no row is active yet so the
   * keyboard still has a way into the list.
   */
  tabbable?: boolean;
  /**
   * Show the directory portion of `entry.path` beside the name. Used for
   * repository-wide search results, where the folder is the answer.
   */
  showPath?: boolean;
  /** 1-based position within the whole (unvirtualized) list, for `aria-rowindex`. */
  rowIndex: number;
  /** Absolute positioning supplied by the virtualizer. */
  style?: CSSProperties;
  rowRef?: Ref<HTMLDivElement>;
  onSelectedChange: (entry: RepoEntry, selected: boolean) => void;
  /** Single click — make this the current row. */
  onActivate: (entry: RepoEntry) => void;
  /**
   * Row click with modifiers intact (#68 multi-select): the list, not the
   * row, decides what shift/cmd-clicking means. Falls back to `onActivate`
   * when absent so the row stays usable in isolation.
   */
  onRowClick?: (entry: RepoEntry, modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  /** Double click or Enter — navigate into a directory, open a file. */
  onOpen: (entry: RepoEntry) => void;
  onContextMenu?: (entry: RepoEntry, event: ReactMouseEvent<HTMLDivElement>) => void;
  onDiff?: (entry: RepoEntry) => void;
  onBlame?: (entry: RepoEntry) => void;
  onLog?: (entry: RepoEntry) => void;
  onCheckout?: (entry: RepoEntry) => void;
  /**
   * Repository drag-and-drop (#68). When present the row is a drag source and
   * — for directories — a drop target; the list owns the validity rules, the
   * row only reports the DOM events and paints the state it is told to.
   * Handlers receive the React drag event so modifier keys survive.
   */
  dnd?: {
    /** This row is the directory a valid drag is hovering over. */
    dropActive?: boolean;
    /** Fires once at drag start; the list bundles the whole selection. */
    onDragStart?: (entry: RepoEntry, event: RepoDragEventLike) => void;
    onDragOver?: (entry: RepoEntry, event: RepoDragEventLike) => void;
    onDragLeave?: (entry: RepoEntry, event: RepoDragEventLike) => void;
    onDrop?: (entry: RepoEntry, event: RepoDragEventLike) => void;
    onDragEnd?: (entry: RepoEntry, event: RepoDragEventLike) => void;
  };
}

export function RepoContentsRow({
  entry,
  scope,
  compact = false,
  selected = false,
  active = false,
  tabbable,
  showPath = false,
  rowIndex,
  style,
  rowRef,
  onSelectedChange,
  onActivate,
  onRowClick,
  onOpen,
  onContextMenu,
  onDiff,
  onBlame,
  onLog,
  onCheckout,
  dnd,
}: RepoContentsRowProps): ReactElement {
  const isDir = entry.kind === 'dir';
  const directoryPart = showPath ? entry.path.split('/').slice(0, -1).join('/') : '';
  const notOnDisk = scope === 'working-copy' && entry.presence === 'none';

  /*
   * The status cell. `svn:externals` is a repository property so it shows in
   * both scopes; everything else below this line requires a working copy.
   */
  let statusCell: ReactElement | null = null;
  if (entry.isExternal) {
    statusCell = <RepoStatusFlag code="X" />;
  } else if (scope === 'working-copy') {
    if (entry.status) {
      statusCell = <RepoStatusFlag code={entry.status} />;
    } else if (entry.rollup) {
      statusCell = <RepoRollupFlags rollup={entry.rollup} />;
    }
  } else if (isDir && entry.presence && entry.presence !== 'none') {
    // Mark the exception, not the rule: only directories that are on disk.
    statusCell = <RepoPresenceFlag presence={entry.presence} />;
  }

  const tools: Array<{ label: string; hint: string; run: (target: RepoEntry) => void }> = [];
  if (isDir) {
    if (onLog) tools.push({ label: 'Log', hint: 'svn log', run: onLog });
    if (onCheckout) tools.push({ label: 'Checkout', hint: 'svn checkout', run: onCheckout });
  } else {
    if (onDiff) tools.push({ label: 'Diff', hint: 'svn diff', run: onDiff });
    if (onBlame) tools.push({ label: 'Blame', hint: 'svn blame', run: onBlame });
  }

  /*
   * Row tools replace the status cell rather than sitting beside it — the pane
   * has no spare column. `focus-within` covers the row itself, so a keyboard
   * user reaches the tools by focusing the row and then tabbing; a
   * `display:none` button would not be focusable at all.
   */
  const hasTools = tools.length > 0;
  const statusVisibility = hasTools
    ? 'flex group-hover/row:hidden group-focus-within/row:hidden'
    : 'flex';
  const toolsVisibility = 'hidden group-hover/row:flex group-focus-within/row:flex';

  return (
    <div
      ref={rowRef}
      role="row"
      aria-rowindex={rowIndex}
      aria-selected={selected}
      tabIndex={(tabbable ?? active) ? 0 : -1}
      data-path={entry.path}
      style={{ ...style, gridTemplateColumns: repoContentsGridTemplate(compact) }}
      className={[
        'group/row absolute left-0 top-0 grid w-full items-center gap-[9px] border-b border-border-muted px-3',
        'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent',
        active ? 'bg-accent/10' : 'hover:bg-bg-secondary',
        notOnDisk ? 'opacity-60' : '',
        // A valid drop target announces itself the way the working-copy file
        // rows do (hooks/useDragDrop idioms): inset accent ring + tint.
        dnd?.dropActive ? 'bg-accent/20 ring-2 ring-inset ring-accent' : '',
        dnd ? 'cursor-grab active:cursor-grabbing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        if (onRowClick) {
          onRowClick(entry, {
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
          });
          return;
        }
        onActivate(entry);
      }}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(entry, event);
      }}
      {...(dnd
        ? {
            draggable: true,
            onDragStart: (event: RepoDragEventLike) => dnd.onDragStart?.(entry, event),
            onDragEnd: (event: RepoDragEventLike) => dnd.onDragEnd?.(entry, event),
            onDragOver: (event: RepoDragEventLike) => dnd.onDragOver?.(entry, event),
            onDragLeave: (event: RepoDragEventLike) => dnd.onDragLeave?.(entry, event),
            onDrop: (event: RepoDragEventLike) => dnd.onDrop?.(entry, event),
          }
        : {})}
    >
      <span role="gridcell" className="flex items-center">
        <input
          type="checkbox"
          className="h-[15px] w-[15px] cursor-pointer accent-accent"
          checked={selected}
          aria-label={`Select ${entry.name}`}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onSelectedChange(entry, event.target.checked)}
        />
      </span>

      <span role="gridcell" className="flex items-center">
        <KindIcon entry={entry} />
        <span className="sr-only">{isDir ? 'Directory' : 'File'}</span>
      </span>

      {/*
        Name. The directory prefix shrinks first (and truncates from the left via
        `direction: rtl`) so the filename is the last thing to give way.
      */}
      <span role="gridcell" className="flex min-w-0 items-center gap-2">
        <span className="shrink truncate text-sm font-semibold text-text" title={entry.path}>
          {entry.name}
        </span>
        {entry.lock && <RepoLockFlag lock={entry.lock} />}
        {directoryPart && (
          <span
            className="min-w-0 shrink-[9999] truncate font-mono text-2xs text-text-faint"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={entry.path}
          >
            {directoryPart}/
          </span>
        )}
      </span>

      <span role="gridcell" className={CELL_NUM} title={`Last changed revision r${entry.revision}`}>
        r{entry.revision}
      </span>

      {!compact && (
        <span role="gridcell" className={CELL_TEXT} title={entry.author}>
          {entry.author || '—'}
        </span>
      )}

      <span role="gridcell" className={CELL_TEXT} title={entry.date}>
        {formatEntryDate(entry.date)}
      </span>

      {!compact && (
        <span role="gridcell" className={CELL_NUM}>
          {isDir ? '—' : formatEntrySize(entry.size)}
        </span>
      )}

      <span role="gridcell" className="flex min-w-0 items-center justify-end">
        <span className={`${statusVisibility} items-center justify-end gap-1`}>{statusCell}</span>
        <span className={`${toolsVisibility} items-center justify-end gap-1`}>
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className="rounded-md border border-border bg-bg-secondary px-2 py-0.5 text-2xs font-semibold text-text hover:border-accent hover:text-accent"
              title={`${tool.label} — ${tool.hint}`}
              aria-label={`${tool.label} ${entry.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onActivate(entry);
                tool.run(entry);
              }}
            >
              {tool.label}
            </button>
          ))}
        </span>
      </span>
    </div>
  );
}
