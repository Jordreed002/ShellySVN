/**
 * Sidebar-local UI state persistence (#84, sidebar slice).
 *
 * Only what the sidebar itself owns is stored: which groups are collapsed,
 * which group (if any) is filtering the working-copy list, and the list's sort
 * mode. Session restore of tabs/routes is a separate concern with its own
 * owner; nothing here reaches outside the sidebar.
 *
 * Persisted through `window.api.store`, same bridge as `lib/shortcutStore.ts`.
 */

export const SIDEBAR_UI_STATE_KEY = 'shellysvn:sidebar-ui-state:v1';

export type SidebarSortMode = 'default' | 'manual' | 'name';

export interface SidebarUiState {
  /** Collapsed group ids (group names can collide after rename; ids cannot). */
  collapsedGroups: string[];
  /** The one group whose members the list is filtered down to, if any. */
  activeGroupFilter: string | null;
  sortMode: SidebarSortMode;
}

export const DEFAULT_SIDEBAR_UI_STATE: SidebarUiState = {
  collapsedGroups: [],
  activeGroupFilter: null,
  sortMode: 'default',
};

const SORT_MODES: ReadonlySet<string> = new Set(['default', 'manual', 'name']);

/** Validate an unknown payload; anything else becomes the defaults. */
export function parseSidebarUiState(value: unknown): SidebarUiState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_SIDEBAR_UI_STATE;
  }
  const { collapsedGroups, activeGroupFilter, sortMode } = value as {
    collapsedGroups?: unknown;
    activeGroupFilter?: unknown;
    sortMode?: unknown;
  };

  const parsedCollapsed = Array.isArray(collapsedGroups)
    ? [...new Set(collapsedGroups.filter((id): id is string => typeof id === 'string' && !!id))]
    : [];

  return {
    collapsedGroups: parsedCollapsed,
    activeGroupFilter: typeof activeGroupFilter === 'string' && !!activeGroupFilter
      ? activeGroupFilter
      : null,
    sortMode: typeof sortMode === 'string' && SORT_MODES.has(sortMode)
      ? (sortMode as SidebarSortMode)
      : 'default',
  };
}

/** Load persisted sidebar state; storage failures degrade to the defaults. */
export async function loadSidebarUiState(): Promise<SidebarUiState> {
  try {
    const stored = await window.api?.store?.get<unknown>(SIDEBAR_UI_STATE_KEY);
    return parseSidebarUiState(stored);
  } catch {
    return DEFAULT_SIDEBAR_UI_STATE;
  }
}

/** Persist the state; callers decide how to surface failures. */
export async function saveSidebarUiState(state: SidebarUiState): Promise<void> {
  await window.api?.store?.set(SIDEBAR_UI_STATE_KEY, state);
}
