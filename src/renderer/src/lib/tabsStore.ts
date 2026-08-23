/**
 * Working-copy tab session (#83, #84) — the persisted "views" half of tabs.
 *
 * A tab is a *view*, not a session: it binds a working-copy path to the last
 * route (pathname + search params) visited through it and nothing else. Every
 * piece of repository state a tab shows still lives in the shared TanStack
 * Query cache keyed by path/URL, so the same working copy open in two tabs is
 * two pointers at one cache — closing either, or switching between them,
 * cannot corrupt anything.
 *
 * Persisted through the `window.api.store` bridge, same discipline as
 * `lib/onboardingStore.ts`: strict parse on hydrate, best-effort persist on
 * change, module-level external store for React consumers.
 */

import { useSyncExternalStore } from 'react';
import type { StartupAction } from '@shared/types';

export const TAB_SESSION_KEY = 'shellysvn:tab-session:v1';

/** Keep the strip usable; beyond this the oldest tab is dropped on open. */
export const MAX_TABS = 12;

/** A router location, reduced to what a tab needs to restore its view. */
export interface TabRouteLocation {
  pathname: string;
  search: Record<string, unknown>;
}

export interface ShellTab {
  id: string;
  workingCopyPath: string;
  route: TabRouteLocation;
}

export interface TabSession {
  version: 1;
  tabs: ShellTab[];
  activeTabId: string | null;
}

export const DEFAULT_TAB_SESSION: TabSession = { version: 1, tabs: [], activeTabId: null };

/* ── pure helpers ─────────────────────────────────────────────────────────── */

/** Slash-form, trailing-separator-free comparison key for filesystem paths. */
export function pathIdentity(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

/** `child` equals `root` or lives underneath it. */
export function pathIsUnder(child: string, root: string): boolean {
  const c = pathIdentity(child);
  const r = pathIdentity(root);
  return c !== '' && (c === r || c.startsWith(`${r}/`));
}

function stableSearch(search: Record<string, unknown>): string {
  const keys = Object.keys(search).toSorted();
  return JSON.stringify(keys.map((key) => [key, search[key]]));
}

export function routeEquals(a: TabRouteLocation, b: TabRouteLocation): boolean {
  return a.pathname === b.pathname && stableSearch(a.search) === stableSearch(b.search);
}

/**
 * May this location be recorded as the tab's last-visited route?
 *
 * Only locations that still describe the tab's working copy count: a `path`
 * (or the repo browser's `localPath`) at or under the working copy, or the
 * same repository URL the tab already shows. This is what keeps stray
 * navigations — the home route, another tab's target during a switch — from
 * overwriting a tab's saved view.
 */
export function routeBelongsToTab(tab: ShellTab, route: TabRouteLocation): boolean {
  const { search } = route;
  const path = typeof search.path === 'string' ? search.path : undefined;
  const localPath = typeof search.localPath === 'string' ? search.localPath : undefined;
  const url = typeof search.url === 'string' ? search.url : undefined;

  if (path !== undefined && pathIsUnder(path, tab.workingCopyPath)) return true;
  if (localPath !== undefined && pathIsUnder(localPath, tab.workingCopyPath)) return true;
  if (url !== undefined) {
    const tabUrl = tab.route.search.url;
    if (typeof tabUrl === 'string' && tabUrl === url) return true;
  }
  return false;
}

function parseRoute(value: unknown): TabRouteLocation | null {
  if (!value || typeof value !== 'object') return null;
  const { pathname, search } = value as { pathname?: unknown; search?: unknown };
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  const parsedSearch: Record<string, unknown> = {};
  if (search && typeof search === 'object' && !Array.isArray(search)) {
    for (const [key, entry] of Object.entries(search as Record<string, unknown>)) {
      if (
        ['string', 'number', 'boolean'].includes(typeof entry) ||
        entry === null ||
        entry === undefined
      ) {
        parsedSearch[key] = entry;
      }
    }
  }
  return { pathname, search: parsedSearch };
}

/** Strict parse of whatever the store hands back; anything else is defaults. */
export function parseTabSession(value: unknown): TabSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_TAB_SESSION, tabs: [] };
  }
  const { tabs, activeTabId } = value as { tabs?: unknown; activeTabId?: unknown };
  if (!Array.isArray(tabs)) return { ...DEFAULT_TAB_SESSION, tabs: [] };

  const parsedTabs: ShellTab[] = [];
  for (const entry of tabs) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, workingCopyPath, route } = entry as {
      id?: unknown;
      workingCopyPath?: unknown;
      route?: unknown;
    };
    if (typeof id !== 'string' || !id) continue;
    if (typeof workingCopyPath !== 'string' || !workingCopyPath) continue;
    const parsedRoute = parseRoute(route);
    if (!parsedRoute) continue;
    if (parsedTabs.some((tab) => tab.id === id)) continue;
    parsedTabs.push({ id, workingCopyPath, route: parsedRoute });
  }

  const active =
    typeof activeTabId === 'string' && parsedTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : (parsedTabs[0]?.id ?? null);

  return { version: 1, tabs: parsedTabs.slice(0, MAX_TABS), activeTabId: active };
}

let tabIdCounter = 0;
function newTabId(): string {
  tabIdCounter += 1;
  return `tab-${Date.now().toString(36)}-${tabIdCounter.toString(36)}`;
}

export function defaultRouteForWorkingCopy(path: string): TabRouteLocation {
  return { pathname: '/files', search: { path } };
}

/* ── module store ─────────────────────────────────────────────────────────── */

let state: TabSession = { ...DEFAULT_TAB_SESSION, tabs: [] };
const listeners = new Set<() => void>();
let hydration: Promise<void> | null = null;
/**
 * The route a tab activation intends to land on. Route recording is muted
 * until the router reaches it (or another activation replaces it), so the
 * outgoing tab never captures the incoming tab's location mid-transition.
 */
let pendingRoute: TabRouteLocation | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(next: TabSession): void {
  state = next;
  emit();
  void window.api?.store?.set(TAB_SESSION_KEY, next).catch(() => {
    // Persistence failure must not unwind the in-memory session.
  });
}

/** Read (and hydrate) the persisted tab session. Safe to call repeatedly. */
export function ensureTabSessionHydrated(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const stored = await window.api?.store?.get<unknown>(TAB_SESSION_KEY);
      state = parseTabSession(stored);
      emit();
    } catch {
      // An unreadable store degrades to an empty session for this launch.
    }
  })();
  return hydration;
}

export function subscribeTabSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTabSession(): TabSession {
  return state;
}

export function getPendingRoute(): TabRouteLocation | null {
  return pendingRoute;
}

/** React binding for the module store. */
export function useTabSession(): TabSession {
  return useSyncExternalStore(subscribeTabSession, getTabSession, getTabSession);
}

/* ── actions ──────────────────────────────────────────────────────────────── */

/**
 * Open `workingCopyPath` as a tab. With `reuseExisting` (default) a tab that
 * already shows this working copy is activated instead of duplicated — the
 * drop/open flows want "go there"; the tab strip's picker passes `false` to
 * create a second view of the same working copy on purpose.
 *
 * Returns the id of the created or activated tab (null when the path is
 * unusable).
 */
export function openTab(
  workingCopyPath: string,
  route?: TabRouteLocation,
  { reuseExisting = true, activate = true }: { reuseExisting?: boolean; activate?: boolean } = {}
): string | null {
  const trimmed = workingCopyPath.trim();
  if (!trimmed) return null;

  const target = route ?? defaultRouteForWorkingCopy(trimmed);
  const existing = state.tabs.find((tab) => pathIdentity(tab.workingCopyPath) === pathIdentity(trimmed));
  if (existing && reuseExisting) {
    if (activate) activateTab(existing.id, target);
    else persist({ ...state, tabs: state.tabs.map((tab) => (tab.id === existing.id ? { ...tab, route: target } : tab)) });
    return existing.id;
  }

  const tab: ShellTab = { id: newTabId(), workingCopyPath: trimmed, route: target };
  let tabs = [...state.tabs, tab];
  if (tabs.length > MAX_TABS) tabs = tabs.slice(tabs.length - MAX_TABS);
  persist({ ...state, tabs, activeTabId: activate ? tab.id : state.activeTabId });
  if (activate) pendingRoute = target;
  return tab.id;
}

/**
 * Make `id` the active tab and remember `route` as where activating it should
 * land (defaults to the tab's saved route).
 */
export function activateTab(id: string, route?: TabRouteLocation): boolean {
  const tab = state.tabs.find((candidate) => candidate.id === id);
  if (!tab) return false;
  const target = route ?? tab.route;
  pendingRoute = target;
  const nextTabs =
    route && !routeEquals(route, tab.route)
      ? state.tabs.map((candidate) => (candidate.id === id ? { ...candidate, route } : candidate))
      : state.tabs;
  persist({ ...state, tabs: nextTabs, activeTabId: id });
  return true;
}

/** Close a tab; a neighbour inherits the active slot (right, then left). */
export function closeTab(id: string): TabSession {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  let activeTabId = state.activeTabId;
  if (activeTabId === id) {
    const neighbour = tabs[Math.min(index, tabs.length - 1)] ?? null;
    activeTabId = neighbour?.id ?? null;
    if (neighbour) pendingRoute = neighbour.route;
  }
  persist({ ...state, tabs, activeTabId });
  return state;
}

/** Close every tab except `id` (which becomes active). */
export function closeOtherTabs(id: string): TabSession {
  const keeper = state.tabs.find((tab) => tab.id === id);
  if (!keeper) return state;
  persist({ ...state, tabs: [keeper], activeTabId: keeper.id });
  pendingRoute = keeper.route;
  return state;
}

/**
 * Record the router's current location into the active tab — the "last
 * visited route" half of #83. Returns true when the session changed.
 *
 * Muted while a pending activation route is in flight, and only accepts
 * locations that still belong to the active tab's working copy, so neither
 * in-flight switches nor detours through home can corrupt a tab's view.
 */
export function recordActiveTabRoute(route: TabRouteLocation): boolean {
  if (pendingRoute) {
    if (routeEquals(route, pendingRoute)) pendingRoute = null;
    return false;
  }
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!active || routeEquals(active.route, route) || !routeBelongsToTab(active, route)) {
    return false;
  }
  persist({
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === active.id ? { ...tab, route } : tab)),
  });
  return true;
}

/** Clear an unresolved pending route (e.g. navigation was intercepted). */
export function clearPendingRoute(): void {
  pendingRoute = null;
}

/** Replace the whole session (session restore, tests). */
export function replaceTabSession(session: TabSession): void {
  pendingRoute = session.activeTabId
    ? (session.tabs.find((tab) => tab.id === session.activeTabId)?.route ?? null)
    : null;
  persist(session);
}

/** The session as a restorable payload — everything #84 needs. */
export function restorableSession(session: TabSession = state): {
  tabCount: number;
  activeTab: ShellTab | null;
} {
  return {
    tabCount: session.tabs.length,
    activeTab: session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0] ?? null,
  };
}

/** Startup actions the tab session can be restored under (#84). */
export type RestorableStartupAction = StartupAction;

/** Test helper: reset the in-memory session (no persistence). */
export function resetTabSessionForTests(): void {
  state = { ...DEFAULT_TAB_SESSION, tabs: [] };
  pendingRoute = null;
  hydration = null;
  emit();
}
