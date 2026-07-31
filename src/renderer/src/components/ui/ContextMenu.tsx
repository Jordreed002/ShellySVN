import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Upload,
  Undo2,
  Plus,
  Trash2,
  FileText,
  FolderOpen,
  Copy,
  RotateCcw,
  History,
  ChevronRight,
  Lock,
  Unlock,
  GitBranch,
  RefreshCw,
  Settings,
  Eye,
  User,
  GitMerge,
  ArrowRightLeft,
  Wrench,
  FileCode,
  Layers,
  ClipboardList,
  Shield,
  Archive,
  Move,
  Pencil,
  FileX,
  FolderMinus,
  Code2,
} from 'lucide-react';
import type { CodeEditorInfo, SvnStatusChar } from '@shared/types';

/**
 * Context menu — the prototype's `.ctx` / `.ci` / `.csep`.
 *
 * Design source: `prototypes/12-browser.html`. The signature of this menu is the
 * second line under an item: the **exact `svn` command** the item runs. Nothing
 * in this app asks you to trust a verb you cannot check, so every entry that maps
 * onto a Subversion command says which one.
 *
 * An optional `header` (the prototype's `.hd`) names the entry the menu was
 * opened on. It is context rather than an item: not focusable, not in the item
 * list, and omitted entirely by callers that do not pass one.
 */

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  /**
   * The `svn` command this item runs, rendered as a mono second line under the
   * label. Decorative for assistive tech — the label carries the meaning.
   */
  command?: string;
  disabled?: boolean;
  danger?: boolean;
  /**
   * Renders a hairline separator instead of an item. When `label` is non-empty
   * the separator becomes an uppercase section heading (the prototype's `.lbl`).
   */
  divider?: boolean;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
}

/**
 * The prototype's `.hd` — the entry the menu was opened on, named once at the
 * top so every item below it is unambiguous.
 *
 * It is context, not a command: it is never focusable, never appears in the
 * item list, and clicking it does nothing.
 */
export interface ContextMenuHeader {
  /** Icon for the entry — a folder or a file, matching the listing. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Primary line: the entry's name, e.g. `package.json`. */
  name: string;
  /**
   * Secondary mono line: where it lives, e.g. `^/clients/acme/trunk/package.json`.
   * Truncated from the **left**, so the leaf survives — see the repo browser's
   * SPEC, "Paths must never break the layout".
   */
  path: string;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  /** Optional `.hd` block above the first item. Omit for a plain menu. */
  header?: ContextMenuHeader;
  position: { x: number; y: number };
  onClose: () => void;
  className?: string;
}

/**
 * Long paths truncate from the left so the filename is the last thing to give
 * way. `<bdi>` keeps the string itself reading left-to-right inside the
 * right-to-left box, so `^/` stays at the front and only the ellipsis moves.
 */
const leftTruncate = { direction: 'rtl', textAlign: 'left' } as const;

/** `.ctx` — hairline surface, 5px padding, heavy shadow. */
const SURFACE = 'border border-border-strong bg-bg-secondary p-[5px] shadow-overlay';

/** `.ci` — 12.5px label, 15px icon, 10px gap. */
const ITEM_BASE =
  'group flex w-full items-center gap-2.5 rounded-[7px] px-[9px] py-[7px] text-left text-[12.5px] leading-tight';

const ITEM_ENABLED = 'cursor-pointer text-text hover:bg-accent hover:text-white';
const ITEM_DANGER = 'cursor-pointer text-svn-conflict hover:bg-svn-conflict hover:text-white';
const ITEM_DISABLED = 'cursor-not-allowed text-text opacity-40';

function itemClasses(item: Pick<ContextMenuItem, 'danger' | 'disabled'>): string {
  if (item.disabled) return `${ITEM_BASE} ${ITEM_DISABLED}`;
  return `${ITEM_BASE} ${item.danger ? ITEM_DANGER : ITEM_ENABLED}`;
}

function iconClasses(item: Pick<ContextMenuItem, 'danger' | 'disabled'>): string {
  const base = 'h-[15px] w-[15px] flex-none';
  if (item.disabled) return `${base} text-text-muted`;
  return item.danger
    ? `${base} text-svn-conflict group-hover:text-white`
    : `${base} text-text-muted group-hover:text-white/80`;
}

/**
 * `.hd` — 15px icon, 12.5px bold name, 10px mono path.
 *
 * A plain `div`: no `tabIndex`, no `button`, no `role`. Items are enumerated
 * from the `items` array, so this node cannot be reached by the menu's
 * keyboard handling however that grows.
 */
function ContextMenuHeaderBlock({ header }: { header: ContextMenuHeader }) {
  const Icon = header.icon;
  return (
    <div className="mb-1 flex items-center gap-[9px] border-b border-border-muted px-[9px] pb-2 pt-[7px]">
      {Icon && <Icon className="h-[15px] w-[15px] flex-none text-accent" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-12.5 font-bold text-text">{header.name}</span>
        <span
          className="block truncate font-mono text-10 font-normal text-text-faint"
          style={leftTruncate}
          title={header.path}
        >
          <bdi>{header.path}</bdi>
        </span>
      </span>
    </div>
  );
}

/**
 * Every actionable item in a menu, submenus included. Grouping moved most items
 * one level down, so anything asking "is this action reachable?" has to look at
 * the whole tree rather than the top row.
 */
/**
 * Place a submenu beside the row that owns it: to its right normally, flipped to
 * the left when there is no room, and lifted so its bottom stays on screen.
 */
export function getSubmenuPosition(
  anchor: { top: number; right: number; left: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 8
): { left: number; top: number } {
  const fitsRight = anchor.right + size.width + padding <= viewport.width;
  return {
    left: fitsRight
      ? anchor.right - 4
      : Math.max(padding, anchor.left - size.width + 4),
    top: Math.max(padding, Math.min(anchor.top - 5, viewport.height - size.height - padding)),
  };
}

export function flattenContextMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.flatMap((item) =>
    item.divider ? [] : item.submenu?.length ? [item, ...flattenContextMenuItems(item.submenu)] : [item]
  );
}

export function getAdjustedContextMenuPosition(
  position: { x: number; y: number },
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 16
) {
  return {
    x: Math.max(padding, Math.min(position.x, viewport.width - menuSize.width - padding)),
    y: Math.max(padding, Math.min(position.y, viewport.height - menuSize.height - padding)),
  };
}

export function ContextMenu({
  items,
  header,
  position,
  onClose,
  className = '',
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  /*
   * Submenus render in a portal rather than inside the menu, because the menu
   * scrolls when it is taller than the window — and a box that scrolls in one
   * axis clips the other, which would cut every submenu off at the menu's edge.
   * So the open submenu carries the screen rect of the row it belongs to.
   */
  const [submenu, setSubmenu] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const submenuOpen = submenu?.id ?? null;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  /** A grace period, so travelling from the row to its submenu does not close it. */
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setSubmenu(null), 140);
  }, [cancelClose]);

  const openSubmenu = useCallback(
    (id: string, element: HTMLElement) => {
      cancelClose();
      setSubmenu({ id, anchor: element.getBoundingClientRect() });
    },
    [cancelClose]
  );

  useEffect(() => cancelClose, [cancelClose]);

  /*
   * Placed beside its row, then corrected once measured — the same one-frame
   * settle the menu itself uses, and the only way to know whether a submenu fits
   * to the right is to have it rendered.
   */
  const submenuRef = useRef<HTMLDivElement>(null);
  const [submenuPosition, setSubmenuPosition] = useState<{ left: number; top: number } | null>(
    null
  );

  useLayoutEffect(() => {
    if (!submenu) {
      setSubmenuPosition(null);
      return;
    }
    const element = submenuRef.current;
    const size = element
      ? { width: element.offsetWidth, height: element.offsetHeight }
      : { width: 208, height: 0 };
    setSubmenuPosition(
      getSubmenuPosition(submenu.anchor, size, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
  }, [submenu]);

  const submenuStyle = (anchor: DOMRect) =>
    submenuPosition ?? { left: anchor.right - 4, top: anchor.top - 5 };

  // Adjust position to stay within viewport
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useLayoutEffect(() => {
    const updatePosition = () => {
      if (!menuRef.current) return;

      const rect = menuRef.current.getBoundingClientRect();
      setAdjustedPosition(
        getAdjustedContextMenuPosition(
          position,
          { width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight }
        )
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [items, position]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // The submenu lives in its own portal, so "inside the menu" has to include
      // it — otherwise mousedown on a submenu row closes the menu before its
      // click ever lands.
      const insideMenu = menuRef.current?.contains(target);
      const insideSubmenu = submenuRef.current?.contains(target);
      if (!insideMenu && !insideSubmenu) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      /* `max-h`/`overflow` are the backstop: grouping keeps the list short, but a
         short window (or a long "Open in") must still be reachable rather than
         running off the bottom edge. */
      className={`context-menu scrollbar-overlay fixed z-[800] max-h-[calc(100vh-24px)] min-w-[262px] overflow-y-auto rounded-[11px] ${SURFACE} ${className}`}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      {header ? <ContextMenuHeaderBlock header={header} /> : null}

      {items.map((item, index) => {
        if (item.divider) {
          // A separator that carries a label becomes a section heading.
          return item.label ? (
            <div
              key={`section-${item.id || index}`}
              className="px-[9px] pb-[3px] pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-text-faint"
            >
              {item.label}
            </div>
          ) : (
            <div key={`divider-${index}`} className="mx-[7px] my-1 h-px bg-border-muted" />
          );
        }

        const Icon = item.icon;
        const hasSubmenu = item.submenu && item.submenu.length > 0;

        return (
          <div
            key={item.id}
            className="relative"
            onMouseEnter={(event) => {
              if (hasSubmenu) openSubmenu(item.id, event.currentTarget);
              else scheduleClose();
            }}
            onMouseLeave={() => hasSubmenu && scheduleClose()}
          >
            <button
              type="button"
              onClick={() => {
                if (!item.disabled && item.onClick) {
                  item.onClick();
                  onClose();
                }
              }}
              disabled={item.disabled}
              title={item.command ? `${item.label} — ${item.command}` : item.label}
              className={itemClasses(item)}
            >
              {Icon && <Icon className={iconClasses(item)} />}
              <span className="min-w-0 flex-1 text-left">
                {item.label}
                {item.command && (
                  <span
                    className="mt-px block truncate font-mono text-[9.5px] font-normal text-text-faint group-hover:text-white/80"
                    aria-hidden="true"
                  >
                    {item.command}
                  </span>
                )}
              </span>
              {item.shortcut && (
                <span className="ml-auto flex-none font-mono text-[9.5px] text-text-faint group-hover:text-white/80">
                  {item.shortcut}
                </span>
              )}
              {hasSubmenu && (
                <ChevronRight
                  className="h-3.5 w-3.5 flex-none text-text-faint group-hover:text-white/80"
                  aria-hidden="true"
                />
              )}
            </button>

            {/* Submenu */}
            {hasSubmenu &&
              submenuOpen === item.id &&
              submenu &&
              createPortal(
                <div
                  ref={submenuRef}
                  className={`context-submenu scrollbar-overlay fixed z-[801] max-h-[calc(100vh-24px)] min-w-[208px] overflow-y-auto rounded-[10px] ${SURFACE}`}
                  style={submenuStyle(submenu.anchor)}
                  onMouseEnter={cancelClose}
                  onMouseLeave={scheduleClose}
                >
                  {item.submenu!.map((subItem, subIndex) => {
                    // Submenus group too: the prototype's `Copy to…` names what
                    // its choices are choices *of* before listing them.
                    if (subItem.divider) {
                      return subItem.label ? (
                        <div
                          key={`sub-section-${subItem.id || subIndex}`}
                          className="px-[9px] pb-[3px] pt-1.5 text-9.5 font-bold uppercase tracking-eyebrow text-text-faint"
                        >
                          {subItem.label}
                        </div>
                      ) : (
                        <div
                          key={`sub-divider-${subItem.id || subIndex}`}
                          className="mx-[7px] my-1 h-px bg-border-muted"
                        />
                      );
                    }

                    const SubIcon = subItem.icon;
                    return (
                      <button
                        key={subItem.id}
                        type="button"
                        onClick={() => {
                          if (!subItem.disabled && subItem.onClick) {
                            subItem.onClick();
                            onClose();
                          }
                        }}
                        disabled={subItem.disabled}
                        title={
                          subItem.command ? `${subItem.label} — ${subItem.command}` : subItem.label
                        }
                        className={itemClasses(subItem)}
                      >
                        {SubIcon && <SubIcon className={iconClasses(subItem)} />}
                        <span className="min-w-0 flex-1 text-left">
                          {subItem.label}
                          {subItem.command && (
                            <span
                              className="mt-px block truncate font-mono text-[9.5px] font-normal text-text-faint group-hover:text-white/80"
                              aria-hidden="true"
                            >
                              {subItem.command}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>,
                document.body
              )}
          </div>
        );
      })}
    </div>,
    document.body
  );
}

// Hook for context menu
export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    data?: unknown;
  } | null>(null);

  const showContextMenu = useCallback((e: React.MouseEvent, data?: unknown) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      position: { x: e.clientX, y: e.clientY },
      data,
    });
  }, []);

  const hideContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    contextMenu,
    showContextMenu,
    hideContextMenu,
  };
}

// Predefined SVN context menu items
export function getSvnContextMenuItems(
  status: SvnStatusChar,
  isDirectory: boolean,
  actions: {
    onUpdate?: () => void;
    onDownload?: () => void;
    onCommit?: () => void;
    onRevert?: () => void;
    onUnversion?: () => void;
    onExclude?: () => void;
    onAdd?: () => void;
    onDelete?: () => void;
    onMove?: () => void;
    onCopy?: () => void;
    onRename?: () => void;
    onResolve?: () => void;
    onGetLock?: () => void;
    onReleaseLock?: () => void;
    onManageLocks?: () => void;
    onShowLog?: () => void;
    onDiff?: () => void;
    onOpenInExplorer?: () => void;
    onCopyPath?: () => void;
    onPreview?: () => void;
    onBlame?: () => void;
    onProperties?: () => void;
    onAddToIgnore?: () => void;
    onBranchTag?: () => void;
    onTag?: () => void;
    onSwitch?: () => void;
    onMerge?: () => void;
    onExport?: () => void;
    onImport?: () => void;
    onRelocate?: () => void;
    onRepoBrowser?: () => void;
    onCreatePatch?: () => void;
    onApplyPatch?: () => void;
    onCleanup?: () => void;
    onChangelist?: () => void;
    onRevisionGraph?: () => void;
    onCheckForModifications?: () => void;
    onShelve?: () => void;
    /** Editors found on `PATH`. Empty or absent means no "Open in" section. */
    editors?: readonly CodeEditorInfo[];
    onOpenInEditor?: (editorId: string) => void;
    /** Opens Settings at the list of applications. */
    onConfigureOpenWith?: () => void;
  },
  isWorkingCopyRoot?: boolean
): ContextMenuItem[] {
  const isVersioned = status !== '?' && status !== 'I' && status !== 'O';
  const isModified = status === 'M';
  const isConflicted = status === 'C';
  const isUnversioned = status === '?';
  const isDeleted = status === 'D';
  const isAdded = status === 'A';
  const isRemoteOnly = status === 'O';
  const isFile = !isDirectory;

  /**
   * Everything Subversion can do to a path does not belong on one list — 27 rows
   * ran off the bottom of a laptop screen, and the item you wanted was as likely
   * to be off-screen as on it. So: the handful of things done daily stay at the
   * top level, and the rest group into hover submenus by what they are *for*,
   * the way Explorer's own menus do. A group that has nothing in it is omitted
   * rather than shown empty.
   */
  const primary: ContextMenuItem[] = [];
  const fileActions: ContextMenuItem[] = [];
  const branching: ContextMenuItem[] = [];
  const locks: ContextMenuItem[] = [];
  const patches: ContextMenuItem[] = [];
  const history: ContextMenuItem[] = [];
  const advanced: ContextMenuItem[] = [];
  const openIn: ContextMenuItem[] = [];

  /* ── Presence: is this path in the checkout at all? ── */

  if (isRemoteOnly && actions.onDownload) {
    primary.push({
      id: 'download',
      label: 'Add to working copy…',
      icon: Download,
      // The dialog picks the depth and whether it sticks, so the flag is not
      // fixed here — advertising `--set-depth` would misstate the default.
      command: 'svn update --depth infinity',
      onClick: actions.onDownload,
    });
  }

  /* ── The daily verbs ── */

  if (isVersioned && actions.onUpdate) {
    primary.push({
      id: 'update',
      label: 'Update',
      icon: Download,
      command: 'svn update',
      shortcut: 'Ctrl+U',
      onClick: actions.onUpdate,
    });
  }

  if ((isModified || isAdded || isDeleted || isUnversioned) && actions.onCommit) {
    primary.push({
      id: 'commit',
      label: 'Commit…',
      icon: Upload,
      command: 'svn commit -m "…"',
      shortcut: 'Ctrl+S',
      onClick: actions.onCommit,
    });
  }

  if ((isModified || isAdded || isDeleted) && actions.onRevert) {
    primary.push({
      id: 'revert',
      label: 'Revert',
      icon: Undo2,
      command: 'svn revert',
      shortcut: 'Ctrl+R',
      onClick: actions.onRevert,
    });
  }

  // A conflict blocks commit, so its cure is never buried in a submenu.
  if (isConflicted && actions.onResolve) {
    primary.push({
      id: 'resolve',
      label: 'Resolve…',
      icon: RotateCcw,
      command: 'svn resolve --accept …',
      onClick: actions.onResolve,
    });
  }

  if (isModified && isFile && actions.onDiff) {
    primary.push({
      id: 'diff',
      label: 'Diff',
      icon: FileText,
      command: 'svn diff',
      shortcut: 'Ctrl+D',
      onClick: actions.onDiff,
    });
  }

  if (isFile && actions.onPreview) {
    primary.push({
      id: 'preview',
      label: 'Preview',
      icon: Eye,
      command: 'svn cat',
      shortcut: 'Ctrl+P',
      onClick: actions.onPreview,
    });
  }

  if (isVersioned && actions.onShowLog) {
    primary.push({
      id: 'show-log',
      label: 'Show log',
      icon: History,
      command: 'svn log -v',
      onClick: actions.onShowLog,
    });
  }

  // The pair to "Add to working copy…": both sides of "is it on my disk" stay
  // together, and at the top level, because that is the question being answered.
  if (isVersioned && !isRemoteOnly && !isWorkingCopyRoot && actions.onExclude) {
    primary.push({
      id: 'exclude',
      label: 'Remove from working copy…',
      icon: FolderMinus,
      command: 'svn update --set-depth exclude',
      onClick: actions.onExclude,
    });
  }

  /* ── File actions: what this path *is* ── */

  if (isUnversioned && actions.onAdd) {
    fileActions.push({
      id: 'add',
      label: 'Add to version control',
      icon: Plus,
      command: 'svn add',
      onClick: actions.onAdd,
    });
  }

  if (isUnversioned && actions.onAddToIgnore) {
    fileActions.push({
      id: 'ignore',
      label: 'Add to ignore list',
      icon: Eye,
      command: 'svn propedit svn:ignore',
      onClick: actions.onAddToIgnore,
    });
  }

  if (isAdded && actions.onUnversion) {
    fileActions.push({
      id: 'unversion',
      label: isDirectory ? 'Unversion folder (undo add)' : 'Unversion (undo add)',
      icon: FileX,
      command: 'svn revert --depth infinity',
      onClick: actions.onUnversion,
    });
  }

  if (isVersioned) {
    if (actions.onMove) {
      fileActions.push({
        id: 'move',
        label: 'Move…',
        icon: Move,
        command: 'svn move',
        onClick: actions.onMove,
      });
    }

    if (actions.onCopy) {
      fileActions.push({
        id: 'copy',
        label: 'Copy…',
        icon: Copy,
        command: 'svn copy',
        onClick: actions.onCopy,
      });
    }

    if (actions.onRename) {
      fileActions.push({
        id: 'rename',
        label: 'Rename…',
        icon: Pencil,
        command: 'svn move',
        onClick: actions.onRename,
      });
    }
  }

  // Last in its group and marked danger: deleting from the repository is not the
  // same kind of act as renaming.
  if (actions.onDelete) {
    fileActions.push({
      id: 'delete',
      label: isVersioned ? 'Delete (versioned)' : 'Delete',
      icon: Trash2,
      command: isVersioned ? 'svn delete' : 'rm -r',
      danger: true,
      onClick: actions.onDelete,
    });
  }

  /* ── Branch & merge ── */

  if (isDirectory && isVersioned) {
    if (actions.onBranchTag) {
      branching.push({
        id: 'branch',
        label: 'Create branch…',
        icon: GitBranch,
        command: 'svn copy ^/trunk ^/branches/NAME',
        onClick: actions.onBranchTag,
      });
    }

    if (actions.onTag) {
      branching.push({
        id: 'tag',
        label: 'Create tag…',
        icon: GitBranch,
        command: 'svn copy ^/trunk ^/tags/NAME',
        onClick: actions.onTag,
      });
    }

    if (actions.onSwitch) {
      branching.push({
        id: 'switch',
        label: 'Switch…',
        icon: ArrowRightLeft,
        command: 'svn switch',
        onClick: actions.onSwitch,
      });
    }

    if (actions.onMerge) {
      branching.push({
        id: 'merge',
        label: 'Merge…',
        icon: GitMerge,
        command: 'svn merge --dry-run',
        onClick: actions.onMerge,
      });
    }

    if (actions.onRelocate) {
      branching.push({
        id: 'relocate',
        label: 'Relocate…',
        icon: ArrowRightLeft,
        command: 'svn relocate',
        onClick: actions.onRelocate,
      });
    }
  }

  /* ── Locks (files only: SVN locks a file, not a tree) ── */

  if (isVersioned && isFile) {
    if (actions.onGetLock) {
      locks.push({
        id: 'lock',
        label: 'Get lock',
        icon: Lock,
        command: 'svn lock',
        onClick: actions.onGetLock,
      });
    }
    if (actions.onReleaseLock) {
      locks.push({
        id: 'unlock',
        label: 'Release lock',
        icon: Unlock,
        command: 'svn unlock',
        onClick: actions.onReleaseLock,
      });
    }
    if (actions.onManageLocks) {
      locks.push({
        id: 'manage-locks',
        label: 'Manage locks…',
        icon: Shield,
        command: 'svn unlock --force',
        onClick: actions.onManageLocks,
      });
    }
  }

  /* ── Patches ── */

  if (((isDirectory && isVersioned) || (isModified && isFile)) && actions.onCreatePatch) {
    patches.push({
      id: 'create-patch',
      label: 'Create patch…',
      icon: FileCode,
      command: 'svn diff > changes.patch',
      onClick: actions.onCreatePatch,
    });
  }

  // Applying a patch needs a tree to apply it to.
  if (isDirectory && isVersioned && actions.onApplyPatch) {
    patches.push({
      id: 'apply-patch',
      label: 'Apply patch…',
      icon: Layers,
      command: 'svn patch changes.patch',
      onClick: actions.onApplyPatch,
    });
  }

  /* ── History ── */

  if (isVersioned && actions.onRevisionGraph) {
    history.push({
      id: 'revision-graph',
      label: 'Revision graph',
      icon: GitBranch,
      command: 'svn log -v --stop-on-copy',
      onClick: actions.onRevisionGraph,
    });
  }

  if (isVersioned && isFile && actions.onBlame) {
    history.push({
      id: 'blame',
      label: 'Blame…',
      icon: User,
      command: 'svn blame -v',
      onClick: actions.onBlame,
    });
  }

  if (isDirectory && isVersioned && actions.onCheckForModifications) {
    history.push({
      id: 'check-mods',
      label: 'Check for modifications…',
      icon: RefreshCw,
      command: 'svn status --show-updates',
      onClick: actions.onCheckForModifications,
    });
  }

  /* ── Advanced: correct, occasional, or repository-wide ── */

  if (isVersioned && actions.onProperties) {
    advanced.push({
      id: 'properties',
      label: 'Properties',
      icon: Settings,
      command: 'svn proplist -v',
      onClick: actions.onProperties,
    });
  }

  if (isVersioned && actions.onChangelist) {
    advanced.push({
      id: 'changelist',
      label: 'Add to changelist…',
      icon: ClipboardList,
      command: 'svn changelist NAME',
      onClick: actions.onChangelist,
    });
  }

  if (isDirectory && isVersioned) {
    if (actions.onShelve) {
      advanced.push({
        id: 'shelve',
        label: 'Shelve changes…',
        icon: Archive,
        command: 'svn shelve',
        onClick: actions.onShelve,
      });
    }

    if (actions.onCleanup) {
      advanced.push({
        id: 'cleanup',
        label: 'Clean up…',
        icon: Wrench,
        command: 'svn cleanup',
        onClick: actions.onCleanup,
      });
    }

    if (actions.onRepoBrowser) {
      advanced.push({
        id: 'repo-browser',
        label: 'Repository browser',
        icon: FolderOpen,
        command: 'svn list',
        onClick: actions.onRepoBrowser,
      });
    }

    if (actions.onExport) {
      advanced.push({
        id: 'export',
        label: 'Export…',
        icon: Download,
        command: 'svn export',
        onClick: actions.onExport,
      });
    }

    if (actions.onImport && isWorkingCopyRoot) {
      advanced.push({
        id: 'import',
        label: 'Import…',
        icon: Upload,
        command: 'svn import',
        onClick: actions.onImport,
      });
    }
  }

  /* ── Open in: the file manager and any editor found on PATH ── */

  if (actions.onOpenInExplorer) {
    openIn.push({
      id: 'open-in-explorer',
      label: 'Explorer',
      icon: FolderOpen,
      onClick: actions.onOpenInExplorer,
    });
  }

  if (actions.editors && actions.editors.length > 0 && actions.onOpenInEditor) {
    const openInEditor = actions.onOpenInEditor;
    const suitable = actions.editors.filter((editor) => {
      const appliesTo = editor.appliesTo ?? 'both';
      if (appliesTo === 'files') return isFile;
      if (appliesTo === 'folders') return isDirectory;
      return true;
    });

    openIn.push(
      ...suitable.map((editor) => ({
        id: `open-in-${editor.id}`,
        label: editor.label,
        icon: Code2,
        command: `${editor.command} <path>`,
        onClick: () => openInEditor(editor.id),
      }))
    );
  }

  // The way to add one, where you go looking for it: at the end of the list it
  // would appear in.
  if (actions.onConfigureOpenWith) {
    if (openIn.length > 0) {
      openIn.push({ id: 'open-in-divider', label: '', divider: true });
    }
    openIn.push({
      id: 'open-in-configure',
      label: 'Add an application…',
      icon: Settings,
      onClick: actions.onConfigureOpenWith,
    });
  }

  /* ── Assemble: primary rows, then the groups, then the clipboard ── */

  const items: ContextMenuItem[] = [...primary];

  const groups: ContextMenuItem[] = [];
  const addGroup = (
    id: string,
    label: string,
    icon: ContextMenuItem['icon'],
    entries: ContextMenuItem[]
  ) => {
    if (entries.length === 0) return;
    // A group of one is a click for nothing: promote it, keeping its own label.
    groups.push(
      entries.length === 1 ? entries[0] : { id, label, icon, submenu: entries }
    );
  };

  addGroup('group-file-actions', 'File actions', Pencil, fileActions);
  addGroup('group-branching', 'Branch & merge', GitBranch, branching);
  addGroup('group-locks', 'Locks', Lock, locks);
  addGroup('group-patches', 'Patches', FileCode, patches);
  addGroup('group-history', 'History', History, history);
  addGroup('group-advanced', 'Advanced', Wrench, advanced);
  addGroup(
    'open-in-editor',
    'Open in',
    FolderOpen,
    // Promoted on its own, "Explorer" or "VS Code" needs the verb back.
    openIn.length === 1 ? [{ ...openIn[0], label: `Open in ${openIn[0].label}` }] : openIn
  );

  if (items.length > 0 && groups.length > 0) {
    items.push({ id: 'divider-groups', label: '', divider: true });
  }
  items.push(...groups);

  if (actions.onCopyPath) {
    if (items.length > 0) {
      items.push({ id: 'divider-clipboard', label: '', divider: true });
    }
    items.push({
      id: 'copy-path',
      label: 'Copy Path',
      icon: Copy,
      shortcut: 'Ctrl+Shift+C',
      onClick: actions.onCopyPath,
    });
  }

  return items;
}
