import {
  ArrowUp,
  RefreshCw,
  Upload,
  Download,
  Undo2,
  Plus,
  Trash2,
  List,
  ChevronDown,
  Check,
  Columns3,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  Columns2,
  Eye,
  EyeOff,
  Star,
  StarOff,
  HardDrive,
  Globe,
  Stethoscope,
  Wrench,
  CheckCircle2,
  Move,
  Copy,
  Pencil,
} from 'lucide-react';
import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

/**
 * Toolbar — the prototype's single `.navbar` (`prototypes/12-browser.html`),
 * and the file explorer's only header bar.
 *
 * It is built in the idiom of `features/repo-browser/components/RepoNavBar`, so
 * the two browsing routes read as one product: `px-3.5 py-2` around a row of
 * 32px controls on 8px radii, hairline borders, 12.5px labels, and the `svn`
 * command spelled out under every action in the menus. Left to right:
 *
 *   [tree · up · refresh]  [address ……… @branch]  [Local|Online]  [filter]
 *   [Update] [Commit] [Actions ▾]  [☆] [List|Columns] [filters] [dual] [preview]
 *   [View ▾] [diagnostics]   — collapsing into [More ▾] when the bar is narrow.
 *
 * No modes: what a control runs is always visible. Nothing is reachable by
 * hover alone, and nothing is dropped when the bar runs out of room — the
 * secondary controls move, whole and named, into the "More controls" menu.
 *
 * `[Local|Online]` is a pair of *destinations*, not a mode switch: this bar
 * belongs to a working copy, so Local is always where you are, and Online is
 * the repository browser — the one screen that lists the server.
 */

/**
 * Below this bar width the secondary controls fold into the overflow menu.
 *
 * Chosen from the measured widths, not by taste: showing every control inline
 * costs ~1170px, so below ~1420px the address field — the one part of the bar
 * that is content rather than chrome — would be squeezed under 250px. The
 * settings give way before the path does.
 */
const OVERFLOW_BELOW_PX = 1420;

/** Below this the two primary buttons drop their labels and keep their icons. */
const ICON_ONLY_BELOW_PX = 900;

/** `.btn` — 32px high, 8px radius, hairline border, 12.5px semibold label. */
const BTN_BASE =
  'inline-flex h-control flex-none items-center gap-[7px] rounded-8 border px-3 text-12.5 font-semibold transition-fast active:translate-y-px disabled:pointer-events-none disabled:opacity-40';

const BTN_TONE =
  'border-border-strong bg-bg-secondary text-text shadow-card hover:border-text-faint hover:bg-bg-tertiary';

/** `.btn.pri` — the one action the toolbar is for. */
const BTN_PRIMARY_TONE =
  'border-accent bg-accent text-white shadow-card hover:border-accent-hover hover:bg-accent-hover';

/** `.btn.ghost` — no chrome until you touch it. */
const BTN_GHOST_TONE =
  'border-transparent bg-transparent text-text hover:border-border hover:bg-bg-tertiary';

const BTN = `${BTN_BASE} ${BTN_TONE}`;

/** `.btn` with the label dropped — the glyph and the accessible name remain. */
const BTN_ICON_BASE =
  'inline-flex h-control w-control flex-none items-center justify-center rounded-8 border transition-fast active:translate-y-px disabled:pointer-events-none disabled:opacity-40';
const BTN_ICON = `${BTN_ICON_BASE} ${BTN_TONE}`;
const BTN_PRIMARY = `${BTN_BASE} ${BTN_PRIMARY_TONE}`;
const BTN_GHOST = `${BTN_BASE} ${BTN_GHOST_TONE}`;

/** `.btn.pri.icon` — a square primary button. */
const BTN_PRIMARY_ICON = `inline-flex h-control w-control flex-none items-center justify-center rounded-8 border ${BTN_PRIMARY_TONE} transition-fast active:translate-y-px disabled:pointer-events-none disabled:opacity-40`;

/** `.btn.icon` — the bordered 30px square of the navigation group. */
const NAV_ICON_BTN =
  'flex h-control w-control-md flex-none items-center justify-center rounded-8 border border-border bg-bg text-text-secondary shadow-card transition-fast hover:border-text-faint hover:bg-bg-tertiary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-bg disabled:hover:text-text-secondary';

/** `.ibtn` — 32px square, quiet until hovered. */
const ICON_BTN_BASE =
  'relative inline-grid h-control w-control flex-none place-items-center rounded-8 border transition-fast disabled:pointer-events-none disabled:opacity-40';

const ICON_BTN_QUIET =
  'border-transparent text-text-secondary hover:border-border hover:bg-bg-tertiary hover:text-text';

/** `.ibtn[aria-pressed=true]` — an engaged toggle. */
const ICON_BTN_ON = 'border-accent/40 bg-accent/10 text-accent';

const ICON_BTN = `${ICON_BTN_BASE} ${ICON_BTN_QUIET}`;

/** `.ibtn` with room for a label or a chevron. */
const ICON_BTN_WIDE_BASE =
  'relative inline-flex h-control flex-none items-center gap-1 rounded-8 border px-2 transition-fast disabled:pointer-events-none disabled:opacity-40';

/** A segmented control — `.scopetog`'s big brother, used for the Local/Online pair. */
const SEGMENT_GROUP =
  'flex flex-none items-center gap-0.5 rounded-8 border border-border bg-bg-secondary p-0.5';

const SEGMENT_ON = 'bg-accent/15 text-accent';
const SEGMENT_OFF = 'text-text-secondary hover:bg-bg-tertiary hover:text-text';

const SEGMENT_BASE =
  'flex h-control-sm flex-none items-center gap-1.5 rounded-6 px-2.5 text-12.5 font-semibold transition-fast';

/** `.ctx` — menus share the context menu's surface. */
const MENU_SURFACE =
  'absolute top-full z-50 mt-1.5 min-w-[248px] rounded-11 border border-border-strong bg-bg-secondary p-[5px] shadow-overlay';

/** `.ci` — a menu row. */
const MENU_ITEM =
  'group flex w-full items-center gap-2.5 rounded-7 px-[9px] py-[7px] text-left text-12.5 leading-tight disabled:pointer-events-none disabled:opacity-40';

/** `.ci:hover` — fills with the accent and inverts the label. */
const MENU_ITEM_TONE = 'text-text hover:bg-accent hover:text-white';

/** `.ci.danger:hover` — fills red instead. */
const MENU_ITEM_DANGER = 'text-svn-conflict hover:bg-svn-conflict hover:text-white';

/** The row whose setting is currently in force. */
const MENU_ITEM_ON = 'bg-accent/10';

/** `.ctx .lbl` — an uppercase section label. */
const MENU_EYEBROW = 'eyebrow px-[9px] pb-[3px] pt-1.5 text-9.5';

/** `.ci .cmd` — the `svn` command a row runs. Decorative for assistive tech. */
const MENU_COMMAND =
  'mt-px block font-mono text-9.5 font-normal text-text-faint group-hover:text-white/80';

const MENU_ICON = 'h-[15px] w-[15px] flex-none text-text-muted group-hover:text-white/80';

const MENU_CHECK = 'h-3.5 w-3.5 flex-none text-accent group-hover:text-white';

interface ToolbarActionItem {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** The `svn` command this action runs. */
  command?: string;
  onClick: () => void;
  danger?: boolean;
}

/**
 * One row of the overflow menu. Every control that folds away keeps the exact
 * accessible name it has in the bar, so nothing is renamed by being moved.
 */
function MenuRow({
  icon: Icon,
  label,
  kind,
  checked,
  disabled,
  title,
  command,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Menu-item role. Named `kind` so it is not mistaken for a DOM `role`. */
  kind: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  command?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={kind}
      aria-checked={kind === 'menuitem' ? undefined : !!checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title ?? label}
      onClick={onSelect}
      className={`${MENU_ITEM} ${MENU_ITEM_TONE} ${checked && kind !== 'menuitem' ? MENU_ITEM_ON : ''}`}
    >
      <Icon className={MENU_ICON} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {label}
        {command && (
          <span className={MENU_COMMAND} aria-hidden="true">
            {command}
          </span>
        )}
      </span>
      {checked && <Check className={MENU_CHECK} aria-hidden="true" />}
    </button>
  );
}

interface ToolbarProps {
  onRefresh?: () => void;
  onUpdate?: () => void;
  onCommit?: () => void;
  onRevert?: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  onCleanup?: () => void;
  onResolve?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onRename?: () => void;
  onSettings?: () => void;
  onSettingsPreload?: () => void;
  onCommitPreload?: () => void;
  onDiagnostics?: () => void;
  isUpdating?: boolean;
  hasChanges?: boolean;
  hasSelection?: boolean;
  isVersioned?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
  hasActiveFilters?: boolean;
  isDualPane?: boolean;
  onToggleDualPane?: () => void;
  showPreview?: boolean;
  onTogglePreview?: () => void;
  hasSelectionForPreview?: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  /**
   * Leave the disk and browse the server.
   *
   * There is one online browser — the repository browser — so this is a
   * destination, not a mode: `svn ls` describes the server and `svn status`
   * describes your disk, and the two are different screens. Omit (or leave
   * `canBrowseOnline` false) when no repository URL could be resolved.
   */
  onBrowseOnline?: () => void;
  canBrowseOnline?: boolean;
  /**
   * Include repository entries with nothing on disk here — presence `none` in
   * the repository browser's vocabulary. They carry no `svn status`.
   */
  showNotCheckedOut?: boolean;
  onToggleNotCheckedOut?: () => void;
  onShowNotes?: () => void;

  /* ── navigation, folded in from the old second header bar ── */
  /**
   * The address field — `PathAddressBar` for the disk path this bar addresses.
   * Injected so the bar stays free of path logic, exactly as `RepoNavBar` takes
   * its `addressBar`.
   */
  addressBar?: ReactNode;
  /** Go to the parent directory. Omit when there is no parent. */
  onNavigateUp?: () => void;
  /** Show/hide the working-copy folder tree. Omit when there is no tree. */
  onToggleTree?: () => void;
  isTreeCollapsed?: boolean;

  /* ── explorer layout, folded in from the old third header bar ── */
  /** Flat list vs Miller columns. A stored setting, not a session toggle. */
  explorerViewMode?: 'list' | 'miller';
  onExplorerViewModeChange?: (mode: 'list' | 'miller') => void;

  className?: string;
}

export function Toolbar({
  onRefresh,
  onUpdate,
  onCommit,
  onRevert,
  onAdd,
  onDelete,
  onCleanup,
  onResolve,
  onMove,
  onCopy,
  onRename,
  onCommitPreload,
  onDiagnostics,
  isUpdating = false,
  hasChanges = false,
  hasSelection = false,
  isVersioned = true,
  searchQuery = '',
  onSearchChange,
  showFilters = true,
  onToggleFilters,
  hasActiveFilters = false,
  isDualPane = false,
  onToggleDualPane,
  showPreview = false,
  onTogglePreview,
  hasSelectionForPreview = false,
  isBookmarked = false,
  onToggleBookmark,
  onBrowseOnline,
  canBrowseOnline = false,
  showNotCheckedOut = false,
  onToggleNotCheckedOut,
  addressBar,
  onNavigateUp,
  onToggleTree,
  isTreeCollapsed = false,
  explorerViewMode,
  onExplorerViewModeChange,
  className = '',
}: ToolbarProps) {
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /*
   * How much of the bar fits is a question about the bar, not about the window:
   * the sidebar and the folder tree both eat into it. Measure the element.
   * Where there is no ResizeObserver (jsdom, SSR) the bar stays expanded, which
   * is also the state every control is directly reachable in.
   */
  const [barWidth, setBarWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = barRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // A zero width means "not laid out yet", not "very narrow".
      if (width > 0) setBarWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const isOverflowing = barWidth !== null && barWidth < OVERFLOW_BELOW_PX;
  const isIconOnly = barWidth !== null && barWidth < ICON_ONLY_BELOW_PX;

  // Secondary file actions, collapsed into a single "Actions" menu to keep the
  // toolbar uncluttered. Only handlers that were provided are shown.
  const actionItems: ToolbarActionItem[] = [];
  if (onRevert)
    actionItems.push({
      key: 'revert',
      icon: Undo2,
      label: 'Revert',
      command: 'svn revert',
      onClick: onRevert,
    });
  if (onAdd)
    actionItems.push({
      key: 'add',
      icon: Plus,
      label: 'Add to version control',
      command: 'svn add',
      onClick: onAdd,
    });
  if (onResolve)
    actionItems.push({
      key: 'resolve',
      icon: CheckCircle2,
      label: 'Resolve conflict',
      command: 'svn resolve --accept …',
      onClick: onResolve,
    });
  if (onMove)
    actionItems.push({
      key: 'move',
      icon: Move,
      label: 'Move…',
      command: 'svn move',
      onClick: onMove,
    });
  if (onCopy)
    actionItems.push({
      key: 'copy',
      icon: Copy,
      label: 'Copy…',
      command: 'svn copy',
      onClick: onCopy,
    });
  if (onRename)
    actionItems.push({
      key: 'rename',
      icon: Pencil,
      label: 'Rename…',
      command: 'svn move',
      onClick: onRename,
    });
  if (onCleanup)
    actionItems.push({
      key: 'cleanup',
      icon: Wrench,
      label: 'Cleanup',
      command: 'svn cleanup',
      onClick: onCleanup,
    });
  if (onDelete)
    actionItems.push({
      key: 'delete',
      icon: Trash2,
      label: 'Delete',
      command: 'svn delete',
      onClick: onDelete,
      danger: true,
    });

  // Close view menu on escape
  const handleViewMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowViewMenu(false);
    }
  }, []);

  // Focus management for view menu
  useEffect(() => {
    if (showViewMenu && viewMenuRef.current) {
      const firstButton = viewMenuRef.current.querySelector('button');
      firstButton?.focus();
    }
  }, [showViewMenu]);

  /* Accessible names, shared by a control and its overflow-menu twin. */
  const bookmarkLabel = isBookmarked ? 'Remove bookmark' : 'Add bookmark';
  const filtersLabel = `${showFilters ? 'Hide' : 'Show'} filters${
    hasActiveFilters ? ' (filters active)' : ''
  }`;
  const dualPaneLabel = isDualPane ? 'Close dual pane view' : 'Open dual pane view';
  const previewLabel = showPreview ? 'Hide file preview' : 'Preview selected file';
  const treeLabel = isTreeCollapsed ? 'Show folder tree' : 'Hide folder tree';

  const showExplorerLayout = !!onExplorerViewModeChange && !!explorerViewMode;
  const showBrowseMode = canBrowseOnline && !!onBrowseOnline;
  const showNotCheckedOutRow = isVersioned && !!onToggleNotCheckedOut;

  /*
   * What folds away when the bar is narrow. These are the settings and the
   * secondary destinations; navigation, the address, update/commit and the
   * filter field never move.
   */
  const overflowCount =
    (onToggleBookmark ? 1 : 0) +
    (showBrowseMode ? 1 : 0) +
    (showExplorerLayout ? 1 : 0) +
    (onToggleFilters ? 1 : 0) +
    (onToggleDualPane ? 1 : 0) +
    (onTogglePreview ? 1 : 0) +
    (isVersioned && onDiagnostics ? 1 : 0);
  const hasOverflowMenu = isOverflowing && overflowCount > 0;
  const showInline = !hasOverflowMenu;
  /* At the narrowest sizes even the view menu folds in, so there is one menu. */
  const foldViewIntoOverflow = isIconOnly && hasOverflowMenu && showExplorerLayout;

  return (
    <div
      ref={barRef}
      className={`toolbar flex h-auto flex-none items-center gap-2 border-b border-border bg-bg px-3.5 py-2 ${className}`}
      role="toolbar"
      aria-label="Main toolbar"
    >
      {/* Navigation — the prototype's `.navgroup` */}
      <div className="flex flex-none gap-[3px]" role="group" aria-label="Navigation">
        {onToggleTree && (
          <button
            type="button"
            onClick={onToggleTree}
            className={NAV_ICON_BTN}
            title={treeLabel}
            aria-label={treeLabel}
            aria-pressed={!isTreeCollapsed}
          >
            {isTreeCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
        {onNavigateUp && (
          <button
            type="button"
            onClick={onNavigateUp}
            className={NAV_ICON_BTN}
            title="Go to parent directory"
            aria-label="Go to parent directory"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isUpdating}
          className={NAV_ICON_BTN}
          title="Refresh (F5) — svn status"
          aria-label={isUpdating ? 'Refreshing...' : 'Refresh files (F5)'}
          aria-busy={isUpdating}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isUpdating ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Address — crumbs and the branch chip, or the repository URL online */}
      {addressBar}

      {/* Bookmark */}
      {onToggleBookmark && showInline && (
        <button
          type="button"
          onClick={onToggleBookmark}
          className={`${ICON_BTN_BASE} ${
            isBookmarked
              ? 'border-svn-modified/40 bg-svn-modified/10 text-svn-modified'
              : ICON_BTN_QUIET
          }`}
          title={bookmarkLabel}
          aria-label={bookmarkLabel}
          aria-pressed={isBookmarked}
        >
          {isBookmarked ? (
            <StarOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Star className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      )}

      {/*
       * Local / Online. This bar is a working copy's bar, so Local is always the
       * view you are in; Online is the repository browser — the one screen that
       * lists the server — and choosing it goes there. Both stay real controls
       * with their own names, and neither is reachable by hover alone.
       */}
      {showBrowseMode && showInline && (
        <div className={SEGMENT_GROUP} role="radiogroup" aria-label="Browse mode">
          <button
            type="button"
            className={`${SEGMENT_BASE} ${SEGMENT_ON}`}
            title="Local files — this view · svn status"
            role="radio"
            aria-checked={true}
            aria-label="Local files"
          >
            <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Local</span>
          </button>
          <button
            type="button"
            onClick={onBrowseOnline}
            className={`${SEGMENT_BASE} ${SEGMENT_OFF}`}
            title="Browse the repository on the server — svn list (opens the repository browser)"
            role="radio"
            aria-checked={false}
            aria-label="Online repository"
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Online</span>
          </button>
        </div>
      )}

      {/* Search — the prototype's `.foldersearch` */}
      {onSearchChange && (
        <div
          className={`relative min-w-[110px] shrink ${
            isIconOnly ? 'basis-[150px]' : isOverflowing ? 'basis-[190px]' : 'basis-[236px]'
          }`}
          role="search"
        >
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <label htmlFor="toolbar-search" className="sr-only">
            Search files
          </label>
          <input
            id="toolbar-search"
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files…"
            className="h-control w-full rounded-8 border border-border bg-bg-secondary pl-[30px] pr-2.5 font-mono text-12 text-text placeholder:font-sans placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
      )}

      {isVersioned && (
        <>
          <div
            className="toolbar-divider mx-1 h-5 w-px flex-none bg-border"
            role="separator"
            aria-orientation="vertical"
          />

          <div
            className="toolbar-group flex flex-none items-center gap-1.5"
            role="group"
            aria-label="Version control actions"
          >
            <button
              onClick={onUpdate}
              disabled={isUpdating}
              className={isIconOnly ? BTN_ICON : BTN}
              title="Update working copy — svn update"
              aria-label="Update working copy from repository"
              aria-disabled={isUpdating}
            >
              <Download className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
              {!isIconOnly && <span>Update</span>}
            </button>

            <button
              onPointerEnter={onCommitPreload}
              onFocus={onCommitPreload}
              onClick={onCommit}
              disabled={!hasChanges}
              className={isIconOnly ? BTN_PRIMARY_ICON : BTN_PRIMARY}
              title="Commit changes — svn commit"
              aria-label={`Commit changes${!hasChanges ? ' (no changes to commit)' : ''}`}
              aria-disabled={!hasChanges}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {!isIconOnly && <span>Commit</span>}
            </button>
          </div>

          {actionItems.length > 0 && (
            /* Context actions, collapsed into a single menu */
            <div className="relative flex-none">
              <button
                type="button"
                onClick={() => setShowActionsMenu((value) => !value)}
                className={BTN_GHOST}
                title="File actions"
                aria-label="File actions"
                aria-haspopup="menu"
                aria-expanded={showActionsMenu}
              >
                <span>Actions</span>
                <ChevronDown className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
              </button>

              {showActionsMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowActionsMenu(false)}
                    aria-hidden="true"
                  />
                  <div
                    className={`${MENU_SURFACE} left-0`}
                    role="menu"
                    aria-label="File actions"
                    onKeyDown={(e) => e.key === 'Escape' && setShowActionsMenu(false)}
                  >
                    <p className={MENU_EYEBROW}>Working copy</p>
                    {!hasSelection && (
                      <p className="px-[9px] pb-1 pt-0.5 text-10 leading-snug text-text-muted">
                        Select an item to act on it
                      </p>
                    )}
                    {actionItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="menuitem"
                          disabled={!hasSelection}
                          onClick={() => {
                            item.onClick();
                            setShowActionsMenu(false);
                          }}
                          title={item.command ? `${item.label} — ${item.command}` : item.label}
                          className={`${MENU_ITEM} ${
                            item.danger ? MENU_ITEM_DANGER : MENU_ITEM_TONE
                          }`}
                        >
                          <Icon
                            className={`h-[15px] w-[15px] flex-none ${
                              item.danger
                                ? 'text-svn-conflict group-hover:text-white'
                                : 'text-text-muted group-hover:text-white/80'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            {item.label}
                            {item.command && (
                              <span className={MENU_COMMAND} aria-hidden="true">
                                {item.command}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Filter Toggle */}
      {onToggleFilters && showInline && (
        <button
          onClick={onToggleFilters}
          className={`${ICON_BTN_BASE} ${
            showFilters || hasActiveFilters ? ICON_BTN_ON : ICON_BTN_QUIET
          }`}
          title={showFilters ? 'Hide filters' : 'Show filters'}
          aria-label={filtersLabel}
          aria-pressed={showFilters}
          aria-haspopup="true"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {hasActiveFilters && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-pill bg-accent ring-2 ring-bg"
              aria-label="Filters active"
            />
          )}
        </button>
      )}

      {/* Dual Pane Toggle */}
      {onToggleDualPane && showInline && (
        <button
          onClick={onToggleDualPane}
          className={`${ICON_BTN_BASE} ${isDualPane ? ICON_BTN_ON : ICON_BTN_QUIET}`}
          title={isDualPane ? 'Close dual pane' : 'Open dual pane view'}
          aria-label={dualPaneLabel}
          aria-pressed={isDualPane}
        >
          <Columns2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {/* Preview Toggle */}
      {onTogglePreview && showInline && (
        <button
          onClick={onTogglePreview}
          disabled={!hasSelectionForPreview}
          className={`${ICON_BTN_BASE} ${showPreview ? ICON_BTN_ON : ICON_BTN_QUIET}`}
          title={showPreview ? 'Hide preview' : 'Preview selected file — svn cat'}
          aria-label={previewLabel}
          aria-pressed={showPreview}
          aria-disabled={!hasSelectionForPreview}
        >
          {showPreview ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      )}

      {/* View options — layout, and what the listing includes */}
      {(showExplorerLayout || showNotCheckedOutRow) && !foldViewIntoOverflow && (
        <div className="relative flex-none">
          <button
            onClick={() => setShowViewMenu(!showViewMenu)}
            className={`${ICON_BTN_WIDE_BASE} ${showViewMenu ? ICON_BTN_ON : ICON_BTN_QUIET}`}
            title="View options"
            aria-label="View options"
            aria-expanded={showViewMenu}
            aria-haspopup="menu"
          >
            {explorerViewMode === 'miller' ? (
              <Columns3 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <List className="h-4 w-4" aria-hidden="true" />
            )}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>

          {showViewMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowViewMenu(false)}
                aria-hidden="true"
              />
              <div
                ref={viewMenuRef}
                className={`${MENU_SURFACE} right-0`}
                role="menu"
                aria-label="View options"
                onKeyDown={handleViewMenuKeyDown}
              >
                {showExplorerLayout && (
                  <>
                    <p className={MENU_EYEBROW}>Layout</p>
                    <MenuRow
                      icon={List}
                      kind="menuitemradio"
                      checked={explorerViewMode === 'list'}
                      label="List"
                      title="One directory as a flat, sortable table with status, revision, author and size."
                      onSelect={() => {
                        onExplorerViewModeChange?.('list');
                        setShowViewMenu(false);
                      }}
                    />
                    <MenuRow
                      icon={Columns3}
                      kind="menuitemradio"
                      checked={explorerViewMode === 'miller'}
                      label="Columns"
                      title="The path as a column per level, so you can see where you are and step sideways."
                      onSelect={() => {
                        onExplorerViewModeChange?.('miller');
                        setShowViewMenu(false);
                      }}
                    />
                  </>
                )}

                {showNotCheckedOutRow && (
                  <>
                    <div className="mx-[7px] my-1 h-px bg-border-muted" />
                    <p className={MENU_EYEBROW}>Repository</p>
                    <MenuRow
                      icon={HardDrive}
                      kind="menuitemcheckbox"
                      checked={showNotCheckedOut}
                      label="Show items not checked out"
                      command="svn list --depth immediates"
                      title="List directories the repository has here that are not on disk. They have presence, not status — svn status knows nothing about them."
                      onSelect={() => {
                        onToggleNotCheckedOut?.();
                        setShowViewMenu(false);
                      }}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Diagnostics - only show for versioned paths */}
      {isVersioned && onDiagnostics && showInline && (
        <button
          onClick={onDiagnostics}
          className={ICON_BTN}
          title="Repository Diagnostics — svn info"
          aria-label="Open repository diagnostics"
        >
          <Stethoscope className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {/*
       * Overflow. Everything above that folded away is here, whole and named —
       * one labelled button, never a silently dropped control.
       */}
      {hasOverflowMenu && (
        <div className="relative flex-none">
          <button
            type="button"
            onClick={() => setShowOverflowMenu((value) => !value)}
            className={`${ICON_BTN_WIDE_BASE} ${showOverflowMenu ? ICON_BTN_ON : ICON_BTN_QUIET}`}
            title="More controls"
            aria-label="More controls"
            aria-haspopup="menu"
            aria-expanded={showOverflowMenu}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>

          {showOverflowMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowOverflowMenu(false)}
                aria-hidden="true"
              />
              <div
                className={`${MENU_SURFACE} right-0`}
                role="menu"
                aria-label="More controls"
                onKeyDown={(e) => e.key === 'Escape' && setShowOverflowMenu(false)}
              >
                {foldViewIntoOverflow && (
                  <>
                    <p className={MENU_EYEBROW}>Layout</p>
                    <MenuRow
                      icon={List}
                      kind="menuitemradio"
                      checked={explorerViewMode === 'list'}
                      label="List"
                      onSelect={() => {
                        onExplorerViewModeChange?.('list');
                        setShowOverflowMenu(false);
                      }}
                    />
                    <MenuRow
                      icon={Columns3}
                      kind="menuitemradio"
                      checked={explorerViewMode === 'miller'}
                      label="Columns"
                      onSelect={() => {
                        onExplorerViewModeChange?.('miller');
                        setShowOverflowMenu(false);
                      }}
                    />
                    {showNotCheckedOutRow && (
                      <MenuRow
                        icon={HardDrive}
                        kind="menuitemcheckbox"
                        checked={showNotCheckedOut}
                        label="Show items not checked out"
                        command="svn list --depth immediates"
                        title="List directories the repository has here that are not on disk. They have presence, not status — svn status knows nothing about them."
                        onSelect={() => {
                          onToggleNotCheckedOut?.();
                          setShowOverflowMenu(false);
                        }}
                      />
                    )}
                  </>
                )}

                {showBrowseMode && (
                  <>
                    <p className={MENU_EYEBROW}>Browse</p>
                    <MenuRow
                      icon={HardDrive}
                      kind="menuitemradio"
                      checked={true}
                      label="Local files"
                      command="svn status"
                      title="Local files — this view · svn status"
                      onSelect={() => setShowOverflowMenu(false)}
                    />
                    <MenuRow
                      icon={Globe}
                      kind="menuitemradio"
                      checked={false}
                      label="Online repository"
                      command="svn list"
                      title="Browse the repository on the server — svn list (opens the repository browser)"
                      onSelect={() => {
                        onBrowseOnline?.();
                        setShowOverflowMenu(false);
                      }}
                    />
                  </>
                )}

                {(onToggleFilters || onToggleDualPane || onTogglePreview) && (
                  <p className={MENU_EYEBROW}>This view</p>
                )}
                {onToggleFilters && (
                  <MenuRow
                    icon={SlidersHorizontal}
                    kind="menuitemcheckbox"
                    checked={showFilters}
                    label={filtersLabel}
                    onSelect={() => {
                      onToggleFilters();
                      setShowOverflowMenu(false);
                    }}
                  />
                )}
                {onToggleDualPane && (
                  <MenuRow
                    icon={Columns2}
                    kind="menuitemcheckbox"
                    checked={isDualPane}
                    label={dualPaneLabel}
                    onSelect={() => {
                      onToggleDualPane();
                      setShowOverflowMenu(false);
                    }}
                  />
                )}
                {onTogglePreview && (
                  <MenuRow
                    icon={showPreview ? EyeOff : Eye}
                    kind="menuitemcheckbox"
                    checked={showPreview}
                    disabled={!hasSelectionForPreview}
                    label={previewLabel}
                    command="svn cat"
                    onSelect={() => {
                      onTogglePreview();
                      setShowOverflowMenu(false);
                    }}
                  />
                )}

                {(onToggleBookmark || (isVersioned && onDiagnostics)) && (
                  <>
                    <div className="mx-[7px] my-1 h-px bg-border-muted" />
                    <p className={MENU_EYEBROW}>This folder</p>
                  </>
                )}
                {onToggleBookmark && (
                  <MenuRow
                    icon={isBookmarked ? StarOff : Star}
                    kind="menuitemcheckbox"
                    checked={isBookmarked}
                    label={bookmarkLabel}
                    onSelect={() => {
                      onToggleBookmark();
                      setShowOverflowMenu(false);
                    }}
                  />
                )}
                {isVersioned && onDiagnostics && (
                  <MenuRow
                    icon={Stethoscope}
                    kind="menuitem"
                    label="Open repository diagnostics"
                    command="svn info"
                    onSelect={() => {
                      onDiagnostics();
                      setShowOverflowMenu(false);
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Compact toolbar for minimal space
export function ToolbarCompact({
  onRefresh,
  onUpdate,
  onCommit,
  onCommitPreload,
  isUpdating = false,
  hasChanges = false,
  className = '',
}: Pick<
  ToolbarProps,
  | 'onRefresh'
  | 'onUpdate'
  | 'onCommit'
  | 'onCommitPreload'
  | 'isUpdating'
  | 'hasChanges'
  | 'className'
>) {
  return (
    <div
      className={`flex h-10 items-center gap-1.5 border-b border-border bg-bg-secondary px-3 ${className}`}
      role="toolbar"
      aria-label="Compact toolbar"
    >
      <button
        onClick={onRefresh}
        disabled={isUpdating}
        className={ICON_BTN}
        title="Refresh — svn status"
        aria-label={isUpdating ? 'Refreshing...' : 'Refresh files'}
        aria-busy={isUpdating}
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
      </button>

      <div
        className="toolbar-divider mx-1 h-5 w-px flex-none bg-border"
        role="separator"
        aria-orientation="vertical"
      />

      <button
        onClick={onUpdate}
        disabled={isUpdating}
        className={ICON_BTN}
        title="Update — svn update"
        aria-label="Update working copy"
        aria-disabled={isUpdating}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      <button
        onPointerEnter={onCommitPreload}
        onFocus={onCommitPreload}
        onClick={onCommit}
        disabled={!hasChanges}
        className={BTN_PRIMARY_ICON}
        title="Commit — svn commit"
        aria-label={`Commit changes${!hasChanges ? ' (no changes)' : ''}`}
        aria-disabled={!hasChanges}
      >
        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
