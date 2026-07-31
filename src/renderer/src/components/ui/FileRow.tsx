/**
 * One row of the working-copy file list, and the list's column header.
 *
 * Design source: `prototypes/12-browser.html` (`.chead`, `.crow`, `.cname`,
 * `.cnum`, `.ctxt`, `.cst`, `.rowtools`) — the same density the repository
 * browser already renders in `features/repo-browser/components/RepoContentsRow`.
 * Status chips are that feature's `RepoStatusFlag`, imported rather than
 * re-invented, so a modified file reads `Modified M` wherever it appears.
 */

import { memo, useRef } from 'react';
import {
  Folder,
  File,
  FileCode,
  FileImage,
  FileText,
  FileArchive,
  FileSpreadsheet,
  FileJson,
  ArrowUp,
  ChevronRight,
  CloudOff,
} from 'lucide-react';
import type { CodeEditorInfo, SvnStatusChar, SvnStatusEntry } from '@shared/types';
import {
  RepoLockFlag,
  RepoStatusFlag,
} from '../../features/repo-browser/components/RepoStatusFlag';
import type { RepoStatusCode } from '../../features/repo-browser/types';
import { useContextMenu, getSvnContextMenuItems, ContextMenu } from './ContextMenu';
import { FileThumbnail } from './FileThumbnail';

/** Row heights, from the prototype's `.crow`. Exported for the virtualizer. */
export const FILE_ROW_HEIGHT = 38;
export const FILE_ROW_HEIGHT_COMPACT = 30;

/**
 * Every `svn status` code that has a spelled-out flag. `' '` (clean) and `'O'`
 * (in the repository, not in this working copy) are ours, not Subversion's, and
 * are handled separately — a made-up letter in a status column would be a lie.
 */
const FLAGGED_STATUS = new Set<string>(['M', 'A', 'D', 'C', 'R', 'X', '?', 'I', '!', '~']);

function toRepoStatusCode(status: SvnStatusChar): RepoStatusCode | null {
  return FLAGGED_STATUS.has(status) ? (status as RepoStatusCode) : null;
}

/**
 * The prototype's `.flag` shell. `RepoStatusFlag` owns the status chips; this
 * is only for the two marks that are not `svn status` codes (a folder's
 * roll-up count, and "not in this working copy"), so they sit on the same
 * baseline as the real ones.
 */
const FLAG_SHELL =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-1.5 py-px text-xs font-bold leading-5';

/**
 * The grid track list shared by `FileListHeader` and every `FileRow`, from the
 * prototype's `.chead, .crow` rule. Widths past the name come from the
 * resizable column state so dragging a header edge still works.
 */
export function fileRowGridTemplate(
  columnWidths: NonNullable<FileRowProps['columnWidths']>,
  showColumns = true
): string {
  const lead = '22px 20px minmax(120px, 1fr)';
  if (!showColumns) return lead;
  return [
    lead,
    `${columnWidths.revision}px`,
    `${columnWidths.author}px`,
    `${columnWidths.date}px`,
    `${columnWidths.size}px`,
    `${columnWidths.status}px`,
  ].join(' ');
}

// Module-level constants for default props to avoid new instances on every render
const EMPTY_FOLDER_SIZES: Record<string, number> = {};
const EMPTY_ACTIONS: FileRowActions = {};
const DEFAULT_COLUMN_WIDTHS: NonNullable<FileRowProps['columnWidths']> = {
  name: 300,
  status: 80,
  revision: 70,
  author: 100,
  date: 100,
  size: 80,
};

// Context menu actions interface
export interface FileRowActions {
  onUpdate?: (entry: SvnStatusEntry) => void;
  onDownload?: (entry: SvnStatusEntry) => void;
  onCommit?: (entry: SvnStatusEntry) => void;
  onRevert?: (entry: SvnStatusEntry) => void;
  onUnversion?: (entry: SvnStatusEntry) => void;
  onExclude?: (entry: SvnStatusEntry) => void;
  onAdd?: (entry: SvnStatusEntry) => void;
  onDelete?: (entry: SvnStatusEntry) => void;
  onMove?: (entry: SvnStatusEntry) => void;
  onCopy?: (entry: SvnStatusEntry) => void;
  onRename?: (entry: SvnStatusEntry) => void;
  onShowLog?: (entry: SvnStatusEntry) => void;
  onDiff?: (entry: SvnStatusEntry) => void;
  onOpenInExplorer?: (entry: SvnStatusEntry) => void;
  onCopyPath?: (entry: SvnStatusEntry) => void;
  onPreview?: (entry: SvnStatusEntry) => void;
  onGetLock?: (entry: SvnStatusEntry) => void;
  onReleaseLock?: (entry: SvnStatusEntry) => void;
  onManageLocks?: (entry: SvnStatusEntry) => void;
  onExport?: (entry: SvnStatusEntry) => void;
  onImport?: (entry: SvnStatusEntry) => void;
  onRepoBrowser?: (entry: SvnStatusEntry) => void;
  onRevisionGraph?: (entry: SvnStatusEntry) => void;
  onCleanup?: (entry: SvnStatusEntry) => void;
  onCreatePatch?: (entry: SvnStatusEntry) => void;
  onApplyPatch?: (entry: SvnStatusEntry) => void;
  onBlame?: (entry: SvnStatusEntry) => void;
  onShelve?: (entry: SvnStatusEntry) => void;
  onChangelist?: (entry: SvnStatusEntry) => void;
  onBranchTag?: (entry: SvnStatusEntry) => void;
  onTag?: (entry: SvnStatusEntry) => void;
  onSwitch?: (entry: SvnStatusEntry) => void;
  onMerge?: (entry: SvnStatusEntry) => void;
  onRelocate?: (entry: SvnStatusEntry) => void;
  onProperties?: (entry: SvnStatusEntry) => void;
  onResolve?: (entry: SvnStatusEntry) => void;
  onAddToIgnore?: (entry: SvnStatusEntry) => void;
  onCheckForModifications?: (entry: SvnStatusEntry) => void;
  /** Editors found on `PATH`; the menu lists only these. */
  editors?: readonly CodeEditorInfo[];
  onOpenInEditor?: (entry: SvnStatusEntry, editorId: string) => void;
  /** Opens Settings at the list of applications. */
  onConfigureOpenWith?: () => void;
}

/**
 * Build the SVN context-menu items for an entry, binding each FileRowActions
 * callback to that entry. Shared by the list view and the Miller columns.
 */
export function buildSvnContextMenuItems(
  entry: SvnStatusEntry,
  actions: FileRowActions,
  workingCopyRoot?: string
) {
  const isWorkingCopyRoot = workingCopyRoot === entry.path;
  return getSvnContextMenuItems(
    entry.status,
    entry.isDirectory,
    {
      onUpdate: actions.onUpdate ? () => actions.onUpdate!(entry) : undefined,
      onDownload: actions.onDownload ? () => actions.onDownload!(entry) : undefined,
      onCommit: actions.onCommit ? () => actions.onCommit!(entry) : undefined,
      onRevert: actions.onRevert ? () => actions.onRevert!(entry) : undefined,
      onUnversion: actions.onUnversion ? () => actions.onUnversion!(entry) : undefined,
      onExclude: actions.onExclude ? () => actions.onExclude!(entry) : undefined,
      onAdd: actions.onAdd ? () => actions.onAdd!(entry) : undefined,
      onDelete: actions.onDelete ? () => actions.onDelete!(entry) : undefined,
      onMove: actions.onMove ? () => actions.onMove!(entry) : undefined,
      onCopy: actions.onCopy ? () => actions.onCopy!(entry) : undefined,
      onRename: actions.onRename ? () => actions.onRename!(entry) : undefined,
      onShowLog: actions.onShowLog ? () => actions.onShowLog!(entry) : undefined,
      onDiff: actions.onDiff ? () => actions.onDiff!(entry) : undefined,
      onOpenInExplorer: actions.onOpenInExplorer
        ? () => actions.onOpenInExplorer!(entry)
        : undefined,
      onCopyPath: actions.onCopyPath
        ? () => actions.onCopyPath!(entry)
        : () => navigator.clipboard.writeText(entry.path),
      onPreview: actions.onPreview ? () => actions.onPreview!(entry) : undefined,
      onGetLock: actions.onGetLock ? () => actions.onGetLock!(entry) : undefined,
      onReleaseLock: actions.onReleaseLock ? () => actions.onReleaseLock!(entry) : undefined,
      onManageLocks: actions.onManageLocks ? () => actions.onManageLocks!(entry) : undefined,
      onCleanup: actions.onCleanup ? () => actions.onCleanup!(entry) : undefined,
      onCreatePatch: actions.onCreatePatch ? () => actions.onCreatePatch!(entry) : undefined,
      onApplyPatch: actions.onApplyPatch ? () => actions.onApplyPatch!(entry) : undefined,
      onBlame: actions.onBlame ? () => actions.onBlame!(entry) : undefined,
      onExport: actions.onExport ? () => actions.onExport!(entry) : undefined,
      onImport: actions.onImport ? () => actions.onImport!(entry) : undefined,
      onRepoBrowser: actions.onRepoBrowser ? () => actions.onRepoBrowser!(entry) : undefined,
      onRevisionGraph: actions.onRevisionGraph ? () => actions.onRevisionGraph!(entry) : undefined,
      onBranchTag: actions.onBranchTag ? () => actions.onBranchTag!(entry) : undefined,
      onTag: actions.onTag ? () => actions.onTag!(entry) : undefined,
      onSwitch: actions.onSwitch ? () => actions.onSwitch!(entry) : undefined,
      onMerge: actions.onMerge ? () => actions.onMerge!(entry) : undefined,
      onRelocate: actions.onRelocate ? () => actions.onRelocate!(entry) : undefined,
      onProperties: actions.onProperties ? () => actions.onProperties!(entry) : undefined,
      onResolve: actions.onResolve ? () => actions.onResolve!(entry) : undefined,
      onAddToIgnore: actions.onAddToIgnore ? () => actions.onAddToIgnore!(entry) : undefined,
      editors: actions.editors,
      onOpenInEditor: actions.onOpenInEditor
        ? (editorId: string) => actions.onOpenInEditor!(entry, editorId)
        : undefined,
      onConfigureOpenWith: actions.onConfigureOpenWith,
      onCheckForModifications: actions.onCheckForModifications
        ? () => actions.onCheckForModifications!(entry)
        : undefined,
      onChangelist: actions.onChangelist ? () => actions.onChangelist!(entry) : undefined,
      onShelve: actions.onShelve ? () => actions.onShelve!(entry) : undefined,
    },
    isWorkingCopyRoot
  );
}

// File type to icon mapping
function getFileIcon(filename: string, isDirectory: boolean) {
  if (isDirectory) return Folder;

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    // Images
    png: FileImage,
    jpg: FileImage,
    jpeg: FileImage,
    gif: FileImage,
    webp: FileImage,
    ico: FileImage,
    svg: FileImage,
    // Code
    js: FileCode,
    jsx: FileCode,
    ts: FileCode,
    tsx: FileCode,
    py: FileCode,
    rb: FileCode,
    go: FileCode,
    rs: FileCode,
    java: FileCode,
    c: FileCode,
    cpp: FileCode,
    h: FileCode,
    cs: FileCode,
    swift: FileCode,
    kt: FileCode,
    php: FileCode,
    // Data
    json: FileJson,
    xml: FileJson,
    yaml: FileJson,
    yml: FileJson,
    toml: FileJson,
    // Documents
    md: FileText,
    txt: FileText,
    pdf: FileText,
    doc: FileText,
    docx: FileText,
    // Spreadsheets
    csv: FileSpreadsheet,
    xls: FileSpreadsheet,
    xlsx: FileSpreadsheet,
    // Archives
    zip: FileArchive,
    tar: FileArchive,
    gz: FileArchive,
    rar: FileArchive,
    '7z': FileArchive,
  };

  return iconMap[ext] || File;
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

// Format date
function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }
}

export interface FileRowProps {
  entry: SvnStatusEntry;
  isSelected: boolean;
  isExpanded?: boolean;
  hasChildren?: boolean;
  depth?: number;
  compact?: boolean;
  showThumbnails?: boolean;
  showFolderSizes?: boolean;
  folderSizes?: Record<string, number>;
  workingCopyRoot?: string;
  onSelect: (
    entry: SvnStatusEntry,
    event?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }
  ) => void;
  onToggle?: (entry: SvnStatusEntry) => void;
  onNavigate?: (entry: SvnStatusEntry) => void;
  style?: React.CSSProperties;
  showColumns?: boolean;
  columnWidths?: {
    name: number;
    status: number;
    revision: number;
    author: number;
    date: number;
    size: number;
  };
  actions?: FileRowActions;
}

export const FileRow = memo(function FileRow({
  entry,
  isSelected,
  isExpanded = false,
  hasChildren = false,
  depth = 0,
  compact = false,
  showThumbnails = false,
  showFolderSizes = false,
  folderSizes = EMPTY_FOLDER_SIZES,
  workingCopyRoot,
  onSelect,
  onToggle,
  onNavigate,
  style,
  showColumns = true,
  columnWidths = DEFAULT_COLUMN_WIDTHS,
  actions = EMPTY_ACTIONS,
}: FileRowProps) {
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();

  const filename = entry.path.split(/[/\\]/).pop() || entry.path;
  const Icon = getFileIcon(filename, entry.isDirectory);

  const handleClick = (e: React.MouseEvent) => {
    // Prevent text selection on shift+click
    if (e.shiftKey) {
      e.preventDefault();
      // Clear any existing text selection
      window.getSelection()?.removeAllRanges();
    }
    onSelect(entry, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Prevent text selection on shift+click at the mousedown stage
    if (e.shiftKey) {
      e.preventDefault();
    }
  };

  const handleDoubleClick = () => {
    if (entry.isDirectory && onNavigate) {
      onNavigate(entry);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!isSelected) {
      onSelect(entry);
    }
    showContextMenu(e, entry);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggle) {
      onToggle(entry);
    }
  };

  // Context menu items with action callbacks
  const contextMenuItems = buildSvnContextMenuItems(entry, actions, workingCopyRoot);

  const statusCode = toRepoStatusCode(entry.status);

  /*
   * The status cell, in the prototype's order of precedence: the item's own
   * `svn status` first, then a folder's roll-up of what changed beneath it.
   */
  let statusCell: React.ReactNode = null;
  if (statusCode) {
    statusCell = <RepoStatusFlag code={statusCode} />;
  } else if (entry.status === 'O') {
    statusCell = (
      <span
        className={`${FLAG_SHELL} border-border bg-bg-tertiary text-text-muted`}
        title="In the repository but not in this working copy — svn update fetches it"
      >
        <CloudOff className="h-3 w-3 shrink-0" aria-hidden="true" />
        Not checked out
      </span>
    );
  } else if (entry.isDirectory && entry.childChangeCount) {
    statusCell = (
      <span
        className={`${FLAG_SHELL} border-svn-modified/40 bg-svn-modified/10 tabular-nums text-svn-modified`}
        title={`${entry.childChangeCount} changed item${
          entry.childChangeCount === 1 ? '' : 's'
        } below this directory`}
      >
        {entry.childChangeCount}
        <span className="sr-only">
          {' '}
          changed item{entry.childChangeCount === 1 ? '' : 's'} below this directory
        </span>
      </span>
    );
  }

  /*
   * Row tools take the status cell's place on hover — the row has no spare
   * column. `focus-within` keeps them reachable from the keyboard, which a
   * `display:none` button would not be.
   */
  const tools: Array<{ label: string; hint: string; run: () => void }> = [];
  if (!entry.isDirectory && actions.onDiff) {
    tools.push({ label: 'Diff', hint: 'svn diff', run: () => actions.onDiff?.(entry) });
  }
  if (actions.onShowLog) {
    tools.push({ label: 'Log', hint: 'svn log', run: () => actions.onShowLog?.(entry) });
  }
  const hasTools = showColumns && tools.length > 0;

  return (
    <>
      <div
        className={`
          file-row group/row grid items-center gap-[9px] mx-0 rounded-none border-b border-border-muted px-3 py-0
          outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent
          ${compact ? 'h-[30px]' : 'h-[38px]'}
          ${isSelected ? 'file-row-selected' : 'hover:bg-bg-secondary'}
          ${entry.isDirectory ? 'text-text' : 'text-text-secondary'}
          ${entry.status === 'O' ? 'opacity-60' : ''}
        `}
        style={{
          ...style,
          gridTemplateColumns: fileRowGridTemplate(columnWidths, showColumns),
          paddingLeft: depth > 0 ? depth * 16 + 12 : undefined,
        }}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        data-path={entry.path}
        /* Roving tab stop: the selected row is the list's way in from the
           keyboard, and focusing it reveals the row tools via `focus-within`. */
        tabIndex={isSelected ? 0 : -1}
      >
        {/* Expand/Collapse Toggle */}
        <div className="flex items-center justify-center">
          {entry.isDirectory && hasChildren && (
            <button
              type="button"
              onClick={handleToggle}
              aria-label={isExpanded ? `Collapse ${filename}` : `Expand ${filename}`}
              className="rounded p-0.5 transition-fast hover:bg-bg-elevated"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </button>
          )}
        </div>

        {/* Kind icon */}
        <div className="flex items-center justify-center">
          {showThumbnails ? (
            <FileThumbnail
              filePath={entry.path}
              isDirectory={entry.isDirectory}
              size={16}
              className="w-4 h-4"
            />
          ) : (
            <Icon
              className={`h-[17px] w-[17px] ${entry.isDirectory ? 'text-accent' : 'text-text-muted'}`}
            />
          )}
        </div>

        {/* Name */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-text" title={entry.path}>
            {filename}
          </span>
          {entry.lock && (
            <RepoLockFlag
              lock={{
                owner: entry.lock.owner,
                comment: entry.lock.comment,
                created: entry.lock.date,
              }}
            />
          )}
        </div>

        {/* Additional Columns */}
        {showColumns && (
          <>
            {/* Last changed revision */}
            <div
              className="overflow-hidden text-right font-mono text-[11px] text-text-muted"
              title={entry.revision ? `Last changed revision r${entry.revision}` : undefined}
            >
              {entry.revision ? `r${entry.revision}` : '—'}
            </div>

            {/* Author */}
            <div
              className="truncate text-[12.5px] text-text-secondary"
              title={entry.author || undefined}
            >
              {entry.author || '—'}
            </div>

            {/* Date */}
            <div className="truncate text-[12.5px] text-text-secondary" title={entry.date}>
              {formatDate(entry.date)}
            </div>

            {/* Size (files only) */}
            <div className="overflow-hidden text-right font-mono text-[11px] text-text-muted">
              {entry.isDirectory
                ? showFolderSizes && folderSizes[entry.path]
                  ? formatSize(folderSizes[entry.path])
                  : '—'
                : '—'}
            </div>

            {/* Status, swapped for the row tools on hover or focus */}
            <div className="flex min-w-0 items-center justify-end">
              <span
                className={`items-center justify-end gap-1 ${
                  hasTools
                    ? 'flex group-hover/row:hidden group-focus-within/row:hidden'
                    : 'flex'
                }`}
              >
                {statusCell}
              </span>
              {hasTools && (
                <span className="hidden items-center justify-end gap-1 group-hover/row:flex group-focus-within/row:flex">
                  {tools.map((tool) => (
                    <button
                      key={tool.label}
                      type="button"
                      className="rounded-md border border-border bg-bg-secondary px-2 py-0.5 text-2xs font-semibold text-text hover:border-accent hover:text-accent"
                      title={`${tool.label} — ${tool.hint}`}
                      aria-label={`${tool.label} ${filename}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        tool.run();
                      }}
                    >
                      {tool.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={hideContextMenu}
        />
      )}
    </>
  );
});

/**
 * The list's column header — the prototype's `.chead`: 32px, sticky, 10px
 * uppercase labels, and one sorted column marked with `aria-sort` as well as an
 * arrow. Column order matches the row: the status column sits last, where the
 * row tools appear on hover.
 */
export function FileListHeader({
  columnWidths = DEFAULT_COLUMN_WIDTHS,
  onColumnWidthChange,
  onSort,
  sortColumn,
  sortDirection,
}: {
  columnWidths?: FileRowProps['columnWidths'];
  onColumnWidthChange?: (column: string, width: number) => void;
  onSort?: (column: string) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}) {
  const columns: Array<{
    key: keyof NonNullable<FileRowProps['columnWidths']>;
    label: string;
    align: 'left' | 'right';
    resizable: boolean;
  }> = [
    { key: 'name', label: 'Name', align: 'left', resizable: false },
    { key: 'revision', label: 'Rev', align: 'right', resizable: true },
    { key: 'author', label: 'Author', align: 'left', resizable: true },
    { key: 'date', label: 'Date', align: 'left', resizable: true },
    { key: 'size', label: 'Size', align: 'right', resizable: true },
    { key: 'status', label: 'Status', align: 'right', resizable: false },
  ];

  return (
    <div
      role="row"
      className="sticky top-0 z-[2] grid h-8 flex-none select-none items-center gap-[9px] border-b border-border bg-bg-secondary px-3"
      style={{ gridTemplateColumns: fileRowGridTemplate(columnWidths) }}
    >
      <span />
      <span />
      {columns.map((column) => (
        <HeaderColumn
          key={column.key}
          label={column.label}
          align={column.align}
          width={columnWidths[column.key]}
          onWidthChange={
            column.resizable ? (w) => onColumnWidthChange?.(column.key, w) : undefined
          }
          onSort={() => onSort?.(column.key)}
          isSorted={sortColumn === column.key}
          sortDirection={sortDirection}
        />
      ))}
    </div>
  );
}

/** One header cell: a sort button, plus a drag handle when the column resizes. */
function HeaderColumn({
  label,
  width,
  onWidthChange,
  onSort,
  isSorted,
  sortDirection,
  align = 'left',
}: {
  label: string;
  width: number;
  onWidthChange?: (width: number) => void;
  onSort?: () => void;
  isSorted?: boolean;
  sortDirection?: 'asc' | 'desc';
  align?: 'left' | 'right';
}) {
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    startXRef.current = e.clientX;
    startWidthRef.current = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(40, startWidthRef.current + diff);
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  };

  return (
    <div
      role="columnheader"
      aria-sort={isSorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="relative flex h-8 min-w-0 items-center"
    >
      <button
        type="button"
        onClick={onSort}
        className={`flex w-full items-center gap-[5px] overflow-hidden whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.08em] transition-fast ${
          align === 'right' ? 'justify-end' : 'justify-start'
        } ${isSorted ? 'text-accent' : 'text-text-faint hover:text-text-secondary'}`}
      >
        {label}
        <ArrowUp
          aria-hidden="true"
          className={`h-[9px] w-[9px] shrink-0 transition-transform ${
            isSorted ? 'opacity-100' : 'opacity-0'
          } ${isSorted && sortDirection === 'desc' ? 'rotate-180' : ''}`}
        />
      </button>
      {onWidthChange && (
        <div
          aria-hidden="true"
          className="absolute -right-[5px] top-0 h-8 w-[9px] cursor-col-resize transition-fast hover:bg-accent/40 active:bg-accent"
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}
