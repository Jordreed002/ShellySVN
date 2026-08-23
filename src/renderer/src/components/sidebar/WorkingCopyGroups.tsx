/**
 * Grouped working-copy list for the sidebar (#59 + #58 + #84 slice).
 *
 * Renders the sections `groupWorkingCopies` derives: one collapsible header per
 * user group (aggregate dirty badge, filter toggle, per-group "Update group",
 * rename/reorder/delete) plus the trailing "Ungrouped" section. Rows are
 * drag-reorderable and can be dropped onto group headers to move between
 * groups, using the same `application/x-shellysvn-paths` drag mime the file
 * explorer uses (`hooks/useDragDrop.tsx` idioms, kept read-only).
 *
 * With no groups defined the list falls back to the sidebar's historical flat
 * rendering (favorites first), so the feature is opt-in by creating a group.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';

import { m, variants, useMotionEnabled } from '@renderer/lib/motion';
import { UpdateAllButton } from '@renderer/features/working-copy-command-center/BatchUpdateControls';
import { promptAppInput } from '@renderer/utils/dialogs';
import type { UseWorkingCopyGroupsResult } from './useWorkingCopyGroups';
import type { UseSidebarUiStateResult } from './useSidebarUiState';
import type { WorkingCopySection } from '@renderer/lib/workingCopyGroups';
import { RailCount, WorkingCopyRow } from './RepoRow';
import { WorkingCopyPanel } from './WorkingCopyPanel';
import type { WorkingCopySummary } from './workingCopyOverview';
import { aggregateTone, aggregateWorkingCopyStatus, describeAggregate } from './groupAggregates';

/** The drag mime `hooks/useDragDrop.tsx` writes for internal path drags. */
const WC_DRAG_MIME = 'application/x-shellysvn-paths';
/** Group-header drags (reordering groups) use their own mime. */
const GROUP_DRAG_MIME = 'application/x-shellysvn-wc-group';

const UNGROUPED_ID = '__ungrouped__';

function readDragPaths(event: DragEvent): string[] {
  try {
    const raw = event.dataTransfer.getData(WC_DRAG_MIME);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      return parsed.filter((path): path is string => typeof path === 'string');
    }
  } catch {
    // A foreign payload is not ours to interpret.
  }
  return [];
}

interface WorkingCopyListProps {
  sections: WorkingCopySection[];
  overview: ReadonlyMap<string, WorkingCopySummary>;
  currentPath: string;
  /** Repo path whose context menu is open, to keep the row highlighted. */
  contextMenuRepo: string | null;
  isPinned: (repo: string) => boolean;
  groups: UseWorkingCopyGroupsResult;
  ui: UseSidebarUiStateResult;
  onOpen: (repo: string) => void;
  onMenu: (event: MouseEvent, repo: string) => void;
}

interface GroupMenuState {
  x: number;
  y: number;
  groupId: string;
}

export function WorkingCopyList({
  sections,
  overview,
  currentPath,
  contextMenuRepo,
  isPinned,
  groups,
  ui,
  onOpen,
  onMenu,
}: WorkingCopyListProps) {
  const motionEnabled = useMotionEnabled();
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const hasGroups = sections.some((section) => section.group !== null);

  /* ── drag plumbing ── */
  const handleRowDragStart = useCallback(
    (repo: string) => (event: DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(WC_DRAG_MIME, JSON.stringify([repo]));
      event.dataTransfer.setData('text/plain', repo);
      setDraggingPath(repo);
    },
    []
  );

  const handleRowDragEnd = useCallback(() => {
    setDraggingPath(null);
    setDropTarget(null);
  }, []);

  const handleRowDragOver = useCallback(
    (repo: string) => (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(WC_DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(`row:${repo}`);
    },
    []
  );

  const handleHeaderDragOver = useCallback(
    (key: string, acceptsGroups: boolean) => (event: DragEvent) => {
      const types = event.dataTransfer.types;
      if (!types.includes(WC_DRAG_MIME) && !(acceptsGroups && types.includes(GROUP_DRAG_MIME))) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    []
  );

  const clearDropTarget = useCallback((event: DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
  }, []);

  const handleRowDrop = useCallback(
    (repo: string) => (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const paths = readDragPaths(event);
      const dragged = paths.find((path) => path !== repo);
      if (dragged) groups.move(dragged, repo);
      setDraggingPath(null);
    },
    [groups]
  );

  const handleGroupHeaderDrop = useCallback(
    (section: WorkingCopySection) => (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      // Group reorder: dragged group header dropped onto another group header.
      const draggedGroupId = event.dataTransfer.getData(GROUP_DRAG_MIME);
      if (draggedGroupId && section.group && draggedGroupId !== section.group.id) {
        const ordered = groups.state.groups.map((group) => group.id);
        const from = ordered.indexOf(draggedGroupId);
        const to = ordered.indexOf(section.group.id);
        if (from >= 0 && to >= 0) {
          ordered.splice(to, 0, ...ordered.splice(from, 1));
          groups.reorder(ordered);
        }
        return;
      }
      // Working copy dropped into this section: assign + append to its order.
      const paths = readDragPaths(event);
      for (const dragged of paths) {
        groups.assign(dragged, section.group?.id ?? null);
        groups.move(dragged, null);
      }
      setDraggingPath(null);
    },
    [groups]
  );

  /* ── group menu ── */
  useEffect(() => {
    if (!groupMenu) return;
    const close = () => setGroupMenu(null);
    document.addEventListener('click', close);
    const frame = requestAnimationFrame(() => menuRef.current?.focus());
    return () => {
      document.removeEventListener('click', close);
      cancelAnimationFrame(frame);
    };
  }, [groupMenu]);

  const openGroupMenu = useCallback((event: MouseEvent, groupId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setGroupMenu({ x: event.clientX, y: event.clientY, groupId });
  }, []);

  const renameFromMenu = useCallback(
    async (groupId: string) => {
      const group = groups.state.groups.find((entry) => entry.id === groupId);
      if (!group) return;
      const name = await promptAppInput({
        title: 'Rename group',
        message: 'Group name',
        defaultValue: group.name,
        confirmLabel: 'Rename',
      });
      if (name) groups.rename(groupId, name);
    },
    [groups]
  );

  const renderRow = useCallback(
    (repo: string) => {
      const isActive = currentPath === repo || currentPath.startsWith(repo + '/');
      const summary = overview.get(repo);
      return (
        <div key={repo}>
          <div
            draggable
            onDragStart={handleRowDragStart(repo)}
            onDragEnd={handleRowDragEnd}
            onDragOver={handleRowDragOver(repo)}
            onDragLeave={clearDropTarget}
            onDrop={handleRowDrop(repo)}
            className={[
              'cursor-grab rounded-lg transition-fast active:cursor-grabbing',
              draggingPath === repo ? 'opacity-50' : '',
              dropTarget === `row:${repo}` ? 'ring-2 ring-accent ring-inset' : '',
            ].join(' ')}
          >
            <WorkingCopyRow
              repo={repo}
              isActive={isActive}
              isPinned={isPinned(repo)}
              isMenuOpen={contextMenuRepo === repo}
              presence={summary?.presence ?? 'unknown'}
              status={summary?.status}
              info={summary?.info}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          </div>
          {isActive && (
            <WorkingCopyPanel repoPath={repo} info={summary?.info} status={summary?.status} />
          )}
        </div>
      );
    },
    [
      clearDropTarget,
      contextMenuRepo,
      currentPath,
      draggingPath,
      dropTarget,
      handleRowDragEnd,
      handleRowDragOver,
      handleRowDragStart,
      handleRowDrop,
      isPinned,
      onMenu,
      onOpen,
      overview,
    ]
  );

  /* ── flat mode (no groups defined): the sidebar's historical list ── */
  if (!hasGroups) {
    const flat = sections[0]?.paths ?? [];
    const manual = ui.state.sortMode === 'manual';
    return (
      <m.div
        className="space-y-0.5 px-1.5"
        variants={variants.staggerList}
        initial={motionEnabled ? 'initial' : false}
        animate="animate"
      >
        {flat.map((repo) => {
          const isActive = currentPath === repo || currentPath.startsWith(repo + '/');
          const summary = overview.get(repo);
          return (
            <div
              key={repo}
              draggable={manual}
              onDragStart={manual ? handleRowDragStart(repo) : undefined}
              onDragEnd={manual ? handleRowDragEnd : undefined}
              onDragOver={manual ? handleRowDragOver(repo) : undefined}
              onDragLeave={manual ? clearDropTarget : undefined}
              onDrop={manual ? handleRowDrop(repo) : undefined}
              className={
                manual && (draggingPath === repo || dropTarget === `row:${repo}`)
                  ? `cursor-grab rounded-lg transition-fast active:cursor-grabbing ${
                      draggingPath === repo ? 'opacity-50' : 'ring-2 ring-accent ring-inset'
                    }`
                  : manual
                    ? 'cursor-grab rounded-lg transition-fast active:cursor-grabbing'
                    : undefined
              }
            >
              <WorkingCopyRow
                repo={repo}
                isActive={isActive}
                isPinned={isPinned(repo)}
                isMenuOpen={contextMenuRepo === repo}
                presence={summary?.presence ?? 'unknown'}
                status={summary?.status}
                info={summary?.info}
                onOpen={onOpen}
                onMenu={onMenu}
              />
              {isActive && (
                <WorkingCopyPanel repoPath={repo} info={summary?.info} status={summary?.status} />
              )}
            </div>
          );
        })}
      </m.div>
    );
  }

  /* ── grouped mode ── */
  const visibleSections = ui.state.activeGroupFilter
    ? sections.filter((section) => section.group?.id === ui.state.activeGroupFilter)
    : sections;

  return (
    <div className="space-y-1 px-1.5" data-testid="working-copy-groups">
      {visibleSections.map((section) => {
        const groupId = section.group?.id ?? UNGROUPED_ID;
        const collapsed = ui.state.collapsedGroups.includes(groupId);
        const aggregate = aggregateWorkingCopyStatus(section.paths, overview);
        const tone = aggregateTone(aggregate);
        const badgeValue =
          aggregate.changes > 0 ? aggregate.changes : aggregate.missing > 0 ? aggregate.missing : 0;
        const isFilterActive = ui.state.activeGroupFilter === section.group?.id;
        const headerDropKey = `header:${groupId}`;
        const isDragOver = dropTarget === headerDropKey;
        const label = section.group?.name ?? 'Ungrouped';

        return (
          <section key={groupId} aria-label={`${label} working copies`}>
            <div
              draggable={!!section.group}
              onContextMenu={section.group ? (event) => openGroupMenu(event, section.group!.id) : undefined}
              onDragStart={
                section.group
                  ? (event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(GROUP_DRAG_MIME, section.group!.id);
                    }
                  : undefined
              }
              onDragOver={handleHeaderDragOver(headerDropKey, !!section.group)}
              onDragLeave={clearDropTarget}
              onDrop={handleGroupHeaderDrop(section)}
              className={[
                'group/section flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2 text-2xs font-bold uppercase tracking-[0.13em] text-text-muted transition-fast',
                isDragOver ? 'border-accent/60 bg-accent/10' : 'hover:bg-bg-tertiary',
              ].join(' ')}
              data-testid={`wc-group-header-${groupId}`}
            >
              <button
                type="button"
                className="btn-icon-sm -ml-1"
                aria-expanded={!collapsed}
                aria-label={
                  collapsed ? `Expand ${label} group` : `Collapse ${label} group`
                }
                onClick={() => ui.toggleGroupCollapsed(groupId)}
              >
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                  aria-hidden="true"
                />
              </button>
              <span className="min-w-0 flex-1 truncate">{label}</span>

              {badgeValue > 0 && (
                <RailCount
                  value={badgeValue}
                  tone={tone ?? 'neutral'}
                  title={describeAggregate(aggregate)}
                />
              )}

              <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100">
                {section.group && (
                  <>
                    <button
                      type="button"
                      className={`btn-icon-sm ${isFilterActive ? 'text-accent' : ''}`}
                      aria-pressed={isFilterActive}
                      aria-label={
                        isFilterActive ? `Stop filtering to ${label}` : `Show only ${label}`
                      }
                      title={isFilterActive ? 'Clear group filter' : 'Show only this group'}
                      onClick={() =>
                        ui.setActiveGroupFilter(isFilterActive ? null : section.group!.id)
                      }
                    >
                      <Filter className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <UpdateAllButton
                      paths={section.paths}
                      className="btn-icon-sm"
                      label={`Update ${label}`}
                      ariaLabel={`Update every working copy in ${label}`}
                      title={`Update all working copies in ${label}`}
                    />
                    <button
                      type="button"
                      className="btn-icon-sm"
                      aria-label={`Group actions for ${label}`}
                      onClick={(event) => openGroupMenu(event, section.group!.id)}
                    >
                      <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </>
                )}
              </span>
            </div>

            {!collapsed && section.paths.length > 0 && (
              <div className="space-y-0.5 pl-1.5">{section.paths.map(renderRow)}</div>
            )}
            {!collapsed && section.paths.length === 0 && (
              <p className="px-3.5 py-1.5 text-2xs font-normal normal-case tracking-normal text-text-faint">
                Drop working copies here
              </p>
            )}
          </section>
        );
      })}

      {groupMenu && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label="Group actions"
          className="context-menu"
          style={{ left: groupMenu.x, top: groupMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.key === 'Escape' && setGroupMenu(null)}
        >
          <button
            type="button"
            role="menuitem"
            className="context-menu-item w-full"
            onClick={() => {
              void renameFromMenu(groupMenu.groupId);
              setGroupMenu(null);
            }}
            data-testid="group-menu-rename"
          >
            <Pencil className="w-4 h-4" />
            Rename group
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-menu-item w-full"
            onClick={() => {
              groups.nudge(groupMenu.groupId, -1);
              setGroupMenu(null);
            }}
          >
            <ArrowUp className="w-4 h-4" />
            Move up
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-menu-item w-full"
            onClick={() => {
              groups.nudge(groupMenu.groupId, 1);
              setGroupMenu(null);
            }}
          >
            <ArrowDown className="w-4 h-4" />
            Move down
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="context-menu-item context-menu-item-danger w-full"
            onClick={() => {
              groups.remove(groupMenu.groupId);
              setGroupMenu(null);
            }}
            data-testid="group-menu-delete"
          >
            <Trash2 className="w-4 h-4" />
            Delete group
          </button>
        </div>
      )}
    </div>
  );
}
