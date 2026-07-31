/**
 * Row renderers for the repository tree.
 *
 * Three kinds of row exist, and all three are `role="treeitem"` so the ARIA
 * tree stays well formed (a `role="tree"` may only contain `treeitem` and
 * `group` children):
 *
 * - `RepoTreeNode`      — a real `RepoEntry`.
 * - `RepoTreeMoreRow`   — "… N more — search instead"; the scale-honesty
 *                          affordance for directories larger than the display cap.
 * - `RepoTreeStatusRow` — "listing N entries…" with a spinner, or "no entries".
 *                          An expanded directory is never rendered as nothing.
 *
 * Everything here is presentational: no `window.api`, no fetching, no router.
 * Layout mirrors `prototypes/12-browser.html` (`.tnode`, `.twist`, `.tico`,
 * `.tbadge`, `.tmore`, `.tloading`).
 */

import { ChevronRight, File, Folder, FolderOpen, Loader2 } from 'lucide-react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

import type { RepoEntry } from '../types';

/** Height of an entry row, in px. Matches `.tnode` in the prototype. */
export const TREE_ROW_HEIGHT = 27;
/** Height of a "more"/"listing…" row, in px. Matches `.tmore` / `.tloading`. */
export const TREE_AUX_ROW_HEIGHT = 24;
/** Indentation added per depth level, in px. */
export const TREE_INDENT_STEP = 14;
/** Left padding of a depth-0 row, in px. */
export const TREE_BASE_INDENT = 5;
/** Width of the twist chevron slot, in px. */
export const TREE_TWIST_WIDTH = 17;
/** Gap between twist and icon, in px. */
export const TREE_TWIST_GAP = 6;

/** Left padding for an entry row at `depth`. */
export function treeRowIndent(depth: number): number {
  return TREE_BASE_INDENT + depth * TREE_INDENT_STEP;
}

/** Left padding for a "more"/"listing…" row at `depth` — aligned with the icons, past the twist. */
export function treeAuxIndent(depth: number): number {
  return treeRowIndent(depth) + TREE_TWIST_WIDTH + TREE_TWIST_GAP;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

const ROW_BASE =
  'group flex items-center gap-1.5 rounded-md pr-2 text-left text-xs outline-none transition-colors ' +
  'focus-visible:ring-1 focus-visible:ring-border-focus';

const BADGE_BASE =
  'flex h-[15px] flex-none items-center rounded-full border px-1.5 font-mono text-2xs font-semibold leading-none';

/* ────────────────────────────────────────────────────────────── entry row ── */

export interface RepoTreeNodeProps {
  entry: RepoEntry;
  /** Stable identity for this row; also used for focus lookup. Normally `entry.path`. */
  rowId: string;
  /** Zero-based indentation depth. */
  depth: number;
  /** 1-based `aria-level`. */
  level: number;
  /** 1-based `aria-posinset` within its sibling group. */
  posInSet: number;
  /** `aria-setsize` of its sibling group. */
  setSize: number;
  /** Directory that can be opened. Leaves render an invisible twist so labels stay aligned. */
  expandable: boolean;
  expanded: boolean;
  /** Children are being fetched right now — sets `aria-busy`. */
  loadingChildren?: boolean;
  selected: boolean;
  /** Roving tabindex: exactly one row in the whole tree receives `true`. */
  tabbable: boolean;
  /** Entries this directory holds on the server, when known. A repository fact — always safe to show. */
  childCount?: number;
  onToggleExpand: (path: string) => void;
  onSelect?: (entry: RepoEntry) => void;
  onContextMenu?: (entry: RepoEntry, event: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocus?: () => void;
  /** Positioning supplied by the virtualizer. */
  style?: CSSProperties;
}

export function RepoTreeNode({
  entry,
  rowId,
  depth,
  level,
  posInSet,
  setSize,
  expandable,
  expanded,
  loadingChildren = false,
  selected,
  tabbable,
  childCount,
  onToggleExpand,
  onSelect,
  onContextMenu,
  onKeyDown,
  onFocus,
  style,
}: RepoTreeNodeProps): JSX.Element {
  // Roll-up counts exist only inside a working copy: `svn status` describes your
  // disk, `svn ls` describes the server. No rollup => no badges, ever.
  const rollup = entry.rollup;
  const changed = rollup ? rollup.modified + rollup.added : 0;
  const conflicted = rollup ? rollup.conflicted : 0;
  const ghosted = entry.presence === 'none';

  const Icon = entry.kind === 'dir' ? (expanded ? FolderOpen : Folder) : File;

  return (
    <div
      role="treeitem"
      data-tree-row-id={rowId}
      aria-level={level}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-selected={selected}
      aria-expanded={expandable ? expanded : undefined}
      aria-busy={loadingChildren || undefined}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSelect?.(entry)}
      onDoubleClick={() => {
        if (expandable) onToggleExpand(entry.path);
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(entry, event);
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      style={{ height: TREE_ROW_HEIGHT, paddingLeft: treeRowIndent(depth), ...style }}
      className={cx(
        ROW_BASE,
        'cursor-pointer',
        selected ? 'bg-accent/10 font-semibold text-accent' : 'text-text-secondary hover:bg-bg-tertiary hover:text-text',
        ghosted && 'opacity-50',
      )}
    >
      <span
        role="presentation"
        onClick={(event) => {
          event.stopPropagation();
          if (expandable) onToggleExpand(entry.path);
        }}
        className={cx(
          'grid h-[17px] w-[17px] flex-none place-items-center rounded',
          expandable ? 'text-text-faint hover:bg-bg-elevated hover:text-text-secondary' : 'invisible',
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cx(
            'h-2.5 w-2.5 transition-transform duration-150 ease-out-quart',
            expanded ? 'rotate-90' : 'rotate-0',
          )}
        />
      </span>

      <Icon
        aria-hidden="true"
        className={cx('h-[15px] w-[15px] flex-none', selected ? 'text-accent' : 'text-text-muted')}
      />

      {/* Long names truncate from the LEFT so the meaningful tail survives. */}
      <span className="min-w-0 flex-1 truncate text-left [direction:rtl]" title={entry.path || entry.name}>
        <bdi>{entry.name}</bdi>
      </span>

      <span className="flex flex-none items-center gap-1.5">
        {changed > 0 && (
          <span
            className={cx(BADGE_BASE, 'border-svn-modified/40 bg-svn-modified/10 text-svn-modified')}
            title={
              rollup
                ? `${formatCount(rollup.modified)} modified, ${formatCount(rollup.added)} added below here`
                : undefined
            }
          >
            {formatCount(changed)}
            <span className="sr-only"> changed</span>
          </span>
        )}
        {/* Conflicts get their own badge — a conflict must never hide behind a change count. */}
        {conflicted > 0 && (
          <span
            className={cx(BADGE_BASE, 'border-svn-conflict/40 bg-svn-conflict/10 text-svn-conflict')}
            title={`${formatCount(conflicted)} conflicted below here`}
          >
            {formatCount(conflicted)}
            <span className="sr-only"> conflicted</span>
          </span>
        )}
        {entry.isExternal && (
          <span
            className={cx(BADGE_BASE, 'border-svn-external/40 bg-svn-external/10 text-svn-external')}
            title={
              entry.externalPegged === false
                ? 'svn:externals definition — floating, not pinned to a revision'
                : 'svn:externals definition'
            }
          >
            ext
          </span>
        )}
        {entry.kind === 'dir' && childCount !== undefined && (
          <span className="font-mono text-2xs text-text-faint" title={`${formatCount(childCount)} entries`}>
            {formatCount(childCount)}
            <span className="sr-only"> entries</span>
          </span>
        )}
      </span>

      {ghosted && <span className="sr-only">not checked out</span>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── more row ── */

export interface RepoTreeMoreRowProps {
  rowId: string;
  /** Repository-relative path of the directory whose children are capped. */
  containerPath: string;
  /** How many siblings are not rendered. */
  hiddenCount: number;
  depth: number;
  level: number;
  posInSet: number;
  setSize: number;
  tabbable: boolean;
  onSearchRequest?: (containerPath: string, hiddenCount: number) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocus?: () => void;
  style?: CSSProperties;
}

export function RepoTreeMoreRow({
  rowId,
  containerPath,
  hiddenCount,
  depth,
  level,
  posInSet,
  setSize,
  tabbable,
  onSearchRequest,
  onKeyDown,
  onFocus,
  style,
}: RepoTreeMoreRowProps): JSX.Element {
  return (
    <div
      role="treeitem"
      data-tree-row-id={rowId}
      aria-level={level}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSearchRequest?.(containerPath, hiddenCount)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      style={{ height: TREE_AUX_ROW_HEIGHT, paddingLeft: treeAuxIndent(depth), ...style }}
      className={cx(ROW_BASE, 'cursor-pointer text-text-muted hover:bg-bg-tertiary hover:text-accent')}
    >
      <span className="truncate">{`… ${formatCount(hiddenCount)} more — search instead`}</span>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── status row ── */

export interface RepoTreeStatusRowProps {
  rowId: string;
  /** e.g. `listing 4,812 entries…` or `no entries`. */
  label: string;
  /** Renders the spinner and sets `aria-busy`. */
  busy: boolean;
  depth: number;
  level: number;
  posInSet: number;
  setSize: number;
  tabbable: boolean;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocus?: () => void;
  style?: CSSProperties;
}

export function RepoTreeStatusRow({
  rowId,
  label,
  busy,
  depth,
  level,
  posInSet,
  setSize,
  tabbable,
  onKeyDown,
  onFocus,
  style,
}: RepoTreeStatusRowProps): JSX.Element {
  return (
    <div
      role="treeitem"
      data-tree-row-id={rowId}
      aria-level={level}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-disabled="true"
      aria-busy={busy || undefined}
      aria-live={busy ? 'polite' : undefined}
      tabIndex={tabbable ? 0 : -1}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      style={{ height: TREE_AUX_ROW_HEIGHT, paddingLeft: treeAuxIndent(depth), ...style }}
      className={cx(ROW_BASE, 'gap-2 text-text-faint')}
    >
      {busy && <Loader2 aria-hidden="true" className="h-2.5 w-2.5 flex-none animate-spin text-accent" />}
      <span className="truncate">{label}</span>
    </div>
  );
}
