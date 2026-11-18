import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@renderer/components/ui/Popover';
import { useQueryClient } from '@tanstack/react-query';
import { Check, FolderOpen, Plus, X } from 'lucide-react';
import type { SvnStatusResult } from '@shared/types';
import { svnStatus } from '@renderer/lib/queryKeys';
import { measureLocalStatus } from '@renderer/features/working-copy-command-center/model';
import type { ShellTab } from '@renderer/lib/tabsStore';
import { pathTail } from './repositoryPill';

/** What the dirty dot on a tab says about its working copy. */
export type TabDirtyState = 'dirty' | 'conflict';

const DIRTY_CLASS: Record<TabDirtyState, string> = {
  dirty: 'bg-svn-modified',
  conflict: 'bg-svn-conflict',
};

const DIRTY_TITLE: Record<TabDirtyState, string> = {
  dirty: 'Working copy has local changes',
  conflict: 'Working copy has conflicts',
};

/**
 * Read each tab's working copy straight from the shared status cache
 * (`svn:status` family, `lib/queryKeys.ts`). Tabs are views — the cache is
 * the single source of truth, so the same working copy in two tabs shows the
 * same dot and refreshing one refreshes both.
 */
export function useWorkingCopyDirtyMap(
  paths: readonly string[]
): ReadonlyMap<string, TabDirtyState> {
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState<ReadonlyMap<string, TabDirtyState>>(() => new Map());

  const recompute = useCallback(() => {
    const next = new Map<string, TabDirtyState>();
    for (const path of paths) {
      const status = queryClient.getQueryData<SvnStatusResult>(svnStatus(path));
      if (!status || status.error) continue;
      const measured = measureLocalStatus(status);
      if (measured.conflicts > 0) next.set(path, 'conflict');
      else if (measured.changes > 0) next.set(path, 'dirty');
    }
    setDirty((previous) => {
      if (previous.size !== next.size) return next;
      for (const [key, value] of next) {
        if (previous.get(key) !== value) return next;
      }
      return previous;
    });
  }, [paths, queryClient]);

  useEffect(() => {
    recompute();
    return queryClient.getQueryCache().subscribe(recompute);
  }, [recompute, queryClient]);

  return dirty;
}

interface TabBarProps {
  tabs: readonly ShellTab[];
  activeTabId: string | null;
  recentRepositories: readonly string[];
  /** Navigation is the Layout's job; the bar only reports intent. */
  onActivate: (tab: ShellTab) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onOpenWorkingCopy: (path: string) => void;
}

interface TabMenuState {
  tabId: string;
  x: number;
  y: number;
}

/**
 * The working-copy tab strip (#83): one tab per bound working-copy view,
 * switch/close/close-others, middle-click close, a new-tab working-copy
 * picker (recent repositories + the OS folder dialog), dirty indicators from
 * the shared status caches, and horizontal overflow scrolling.
 */
export function TabBar({
  tabs,
  activeTabId,
  recentRepositories,
  onActivate,
  onClose,
  onCloseOthers,
  onOpenWorkingCopy,
}: TabBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  /*
   * The picker panel portals to `body`, so it is not inside `pickerRef`. Both
   * it and its trigger have to count as "inside" for dismissal, or a row
   * would close the menu on mousedown before its click could land.
   */
  const pickerPanelRef = useRef<HTMLDivElement | null>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const dirtyMap = useWorkingCopyDirtyMap(
    useMemo(() => tabs.map((tab) => tab.workingCopyPath), [tabs])
  );

  useEffect(() => {
    if (!pickerOpen && !menu) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!pickerRef.current?.contains(target) && !pickerPanelRef.current?.contains(target)) {
        setPickerOpen(false);
      }
      setMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPickerOpen(false);
        setMenu(null);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pickerOpen, menu]);

  const handleBrowse = useCallback(async () => {
    setPickerOpen(false);
    try {
      const path = await window.api.dialog.openDirectory();
      if (path) onOpenWorkingCopy(path);
    } catch {
      // The dialog was dismissed or failed to open; nothing to do.
    }
  }, [onOpenWorkingCopy]);

  const menuTab = menu ? tabs.find((tab) => tab.id === menu.tabId) : undefined;

  /*
   * #129 (axe): the strip is a `nav` landmark so its content is not "region"
   * debt, and the tablist holds only `role="tab"` children — the new-tab
   * picker button sits beside it, inside the nav but outside the tablist,
   * which only allows tabs as descendants. Visually the button stays at the
   * end of the strip; it no longer scrolls away under tab overflow.
   */
  return (
    <nav
      aria-label="Working copy tabs"
      className="app-tabbar relative z-10 h-9 flex-shrink-0 flex items-stretch gap-1 border-b border-border bg-bg px-2 titlebar-drag"
    >
      <div
        role="tablist"
        aria-label="Working copy tabs"
        className="flex-1 min-w-0 flex items-stretch gap-0.5 overflow-x-auto titlebar-no-drag"
        style={{ scrollbarWidth: 'thin' }}
        onKeyDown={(event) => {
          // Roving tabindex: arrows/Home/End move between tabs and activate them.
          const index = tabs.findIndex((tab) => tab.id === activeTabId);
          if (index < 0 || tabs.length === 0) return;
          let next = -1;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else if (event.key === 'Delete') {
            event.preventDefault();
            onClose(tabs[index].id);
            return;
          }
          if (next < 0 || next === index) return;
          event.preventDefault();
          onActivate(tabs[next]);
          const container = event.currentTarget;
          requestAnimationFrame(() => {
            container.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
          });
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const dirty = dirtyMap.get(tab.workingCopyPath);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-label={`Working copy ${pathTail(tab.workingCopyPath)}`}
              title={`${tab.workingCopyPath} — ${tab.route.pathname}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onActivate(tab)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
              }}
              className={`group min-w-[112px] max-w-[220px] flex-shrink-0 flex items-center gap-1.5 pl-2.5 pr-1 my-1 rounded-md cursor-default transition-fast select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                active
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:bg-bg-tertiary/60 hover:text-text'
              }`}
            >
              {dirty && (
                <span
                  aria-hidden="true"
                  title={DIRTY_TITLE[dirty]}
                  className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${DIRTY_CLASS[dirty]}`}
                />
              )}
              <span className="flex-1 min-w-0 truncate text-12.5 font-medium">
                {pathTail(tab.workingCopyPath)}
              </span>
              <button
                type="button"
                aria-label={`Close tab ${pathTail(tab.workingCopyPath)}`}
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                tabIndex={active ? 0 : -1}
                className={`h-5 w-5 grid place-items-center rounded text-text-muted hover:bg-bg-elevated hover:text-text focus-visible:opacity-100 transition-fast ${
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {/* New-tab picker — adjacent to the tablist, not inside it (see nav). */}
      <div ref={pickerRef} className="relative flex items-stretch flex-shrink-0 titlebar-no-drag">
        <button
          ref={pickerButtonRef}
          type="button"
          aria-label="Open a working copy in a new tab"
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          title="New tab"
          onClick={() => setPickerOpen((previous) => !previous)}
          className="my-1 h-7 w-7 grid place-items-center rounded-md text-text-muted hover:bg-bg-tertiary hover:text-text transition-fast self-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {pickerOpen && (
          <Popover
            anchorRef={pickerButtonRef}
            panelRef={pickerPanelRef}
            onClose={() => setPickerOpen(false)}
            role="menu"
            ariaLabel="Open a working copy"
            className="w-72 p-1 rounded-lg border border-border bg-bg-elevated shadow-overlay"
          >
            {recentRepositories.length === 0 && (
              <p className="px-3 py-2 text-12 text-text-muted">No recent working copies yet.</p>
            )}
            {recentRepositories.map((path) => (
              <button
                key={path}
                type="button"
                role="menuitem"
                onClick={() => {
                  setPickerOpen(false);
                  onOpenWorkingCopy(path);
                }}
                title={path}
                className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-12.5 text-text hover:bg-bg-tertiary transition-fast"
              >
                <FolderOpen
                  className="h-3.5 w-3.5 flex-shrink-0 text-text-faint"
                  aria-hidden="true"
                />
                <span className="truncate">{pathTail(path)}</span>
                <span className="ml-auto text-11 text-text-muted truncate max-w-[110px]">
                  {path}
                </span>
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleBrowse()}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-12.5 text-text hover:bg-bg-tertiary transition-fast"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Choose a folder…
            </button>
          </Popover>
        )}
      </div>

      {menu && menuTab && (
        <div
          role="menu"
          aria-label={`Tab options for ${pathTail(menuTab.workingCopyPath)}`}
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          className="z-40 py-1 rounded-lg border border-border bg-bg-elevated shadow-card"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose(menu.tabId);
              setMenu(null);
            }}
            className="flex w-44 items-center gap-2 px-3 py-1.5 text-left text-12.5 hover:bg-bg-tertiary transition-fast"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Close tab
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={tabs.length <= 1}
            onClick={() => {
              onCloseOthers(menu.tabId);
              setMenu(null);
            }}
            className="flex w-44 items-center gap-2 px-3 py-1.5 text-left text-12.5 hover:bg-bg-tertiary transition-fast disabled:opacity-50 disabled:pointer-events-none"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Close other tabs
          </button>
        </div>
      )}
    </nav>
  );
}
