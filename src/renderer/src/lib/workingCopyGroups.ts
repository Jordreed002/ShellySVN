/**
 * Persistence and pure logic for user-defined working-copy groups (#59).
 *
 * The store keeps three facts, all of them renderer-side preferences about the
 * working copies the app already knows from `settings.recentRepositories`:
 *
 *  - `groups` — ordered list of `{ id, name }`;
 *  - `assignments` — working-copy path → group id (absent = ungrouped);
 *  - `manualOrder` — the full drag-ordered sequence of working-copy paths,
 *    which the sidebar's "manual" sort mode replays verbatim.
 *
 * Paths here are never authoritative: a working copy removed from the recent
 * list simply drops out of every structure on the next load (see
 * {@link parseWorkingCopyGroups}), and a group left empty stays until the user
 * deletes it.
 *
 * Persisted through the same `window.api.store` bridge as
 * `lib/shortcutStore.ts`.
 */

import type { SidebarSortMode } from './sidebarUiState';

export const WORKING_COPY_GROUPS_KEY = 'shellysvn:working-copy-groups:v1';

export interface WorkingCopyGroup {
  id: string;
  name: string;
}

export interface WorkingCopyGroupsState {
  groups: WorkingCopyGroup[];
  /** Working-copy path → group id. Ungrouped paths are absent. */
  assignments: Record<string, string>;
  /** Drag order across every section; paths not present keep arrival order. */
  manualOrder: string[];
}

export const EMPTY_WORKING_COPY_GROUPS: WorkingCopyGroupsState = {
  groups: [],
  assignments: {},
  manualOrder: [],
};

const MAX_GROUP_NAME = 48;
const MAX_GROUPS = 30;

function newGroupId(): string {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Trim, cap and de-blank a user-typed group name. */
export function sanitizeGroupName(raw: string, existing: readonly string[] = []): string {
  const base = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_GROUP_NAME);
  if (!base) return '';
  if (!existing.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base} (${i})`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base} (${Date.now() % 1000})`;
}

function parseGroupEntry(value: unknown): WorkingCopyGroup | null {
  if (!value || typeof value !== 'object') return null;
  const { id, name } = value as { id?: unknown; name?: unknown };
  if (typeof id !== 'string' || !id.trim()) return null;
  if (typeof name !== 'string' || !name.trim()) return null;
  return { id: id, name: name.trim().slice(0, MAX_GROUP_NAME) };
}

/**
 * Validate an unknown payload as the v1 groups state.
 *
 * Anything unrecoverable degrades to {@link EMPTY_WORKING_COPY_GROUPS}: a
 * corrupt store must never take the sidebar down, and group membership is
 * cheap to rebuild by hand.
 */
export function parseWorkingCopyGroups(value: unknown): WorkingCopyGroupsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_WORKING_COPY_GROUPS;
  }
  const { groups, assignments, manualOrder } = value as {
    groups?: unknown;
    assignments?: unknown;
    manualOrder?: unknown;
  };

  const parsedGroups: WorkingCopyGroup[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  if (Array.isArray(groups)) {
    for (const entry of groups.slice(0, MAX_GROUPS)) {
      const group = parseGroupEntry(entry);
      if (!group) continue;
      if (seenIds.has(group.id)) continue;
      group.name = sanitizeGroupName(group.name, [...seenNames]) || group.name;
      seenIds.add(group.id);
      seenNames.add(group.name);
      parsedGroups.push(group);
    }
  }

  const validIds = new Set(parsedGroups.map((group) => group.id));
  const parsedAssignments: Record<string, string> = {};
  if (assignments && typeof assignments === 'object' && !Array.isArray(assignments)) {
    for (const [path, groupId] of Object.entries(assignments as Record<string, unknown>)) {
      // Assignments to groups that no longer exist are dropped — rendering a
      // path "inside" an invisible group hides it, which reads as data loss.
      if (typeof groupId === 'string' && validIds.has(groupId)) parsedAssignments[path] = groupId;
    }
  }

  const parsedOrder: string[] = [];
  if (Array.isArray(manualOrder)) {
    for (const path of manualOrder) {
      if (typeof path === 'string' && path && !parsedOrder.includes(path)) parsedOrder.push(path);
    }
  }

  return { groups: parsedGroups, assignments: parsedAssignments, manualOrder: parsedOrder };
}

/**
 * Migrate the pre-v1 nested shape, where each group carried its own `items`
 * array (`{ groups: [{ id, name, items: [path] }] }`).
 *
 * Membership is folded into `assignments` and the per-group item order is
 * concatenated (group order first, items in group order) to seed
 * `manualOrder`. Unknown fields are ignored, exactly like
 * {@link parseWorkingCopyGroups}.
 */
export function migrateLegacyWorkingCopyGroups(value: unknown): WorkingCopyGroupsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_WORKING_COPY_GROUPS;
  const { groups } = value as { groups?: unknown };
  if (!Array.isArray(groups)) return EMPTY_WORKING_COPY_GROUPS;

  const state: WorkingCopyGroupsState = { groups: [], assignments: {}, manualOrder: [] };
  const names = new Set<string>();
  for (const entry of groups.slice(0, MAX_GROUPS)) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, items } = entry as { id?: unknown; name?: unknown; items?: unknown };
    if (typeof id !== 'string' || !id.trim()) continue;
    if (state.groups.some((group) => group.id === id)) continue;
    const cleanName =
      (typeof name === 'string' ? sanitizeGroupName(name, [...names]) : '') ||
      sanitizeGroupName('Group', [...names]);
    if (!cleanName) continue;
    names.add(cleanName);
    state.groups.push({ id, name: cleanName });
    if (Array.isArray(items)) {
      for (const path of items) {
        if (typeof path !== 'string' || !path) continue;
        state.assignments[path] = id;
        if (!state.manualOrder.includes(path)) state.manualOrder.push(path);
      }
    }
  }
  return state;
}

/**
 * Load persisted groups: v1 first, then the legacy nested payload, then empty.
 * Storage failures degrade to "no groups".
 */
export async function loadWorkingCopyGroups(): Promise<WorkingCopyGroupsState> {
  try {
    const stored = await window.api?.store?.get<unknown>(WORKING_COPY_GROUPS_KEY);
    if (stored !== undefined && stored !== null) return parseWorkingCopyGroups(stored);
    const legacy = await window.api?.store?.get<unknown>('shellysvn:wc-groups');
    if (legacy !== undefined && legacy !== null) return migrateLegacyWorkingCopyGroups(legacy);
  } catch {
    // fall through
  }
  return EMPTY_WORKING_COPY_GROUPS;
}

/** Persist the state; callers decide how to surface failures. */
export async function saveWorkingCopyGroups(state: WorkingCopyGroupsState): Promise<void> {
  await window.api?.store?.set(WORKING_COPY_GROUPS_KEY, state);
}

/* ── mutations (all pure — they take a state and return a new one) ────────── */

/** Create a group with a unique, sanitized name. Returns null on a blank name. */
export function createGroup(
  state: WorkingCopyGroupsState,
  name: string,
  id: string = newGroupId()
): { state: WorkingCopyGroupsState; group: WorkingCopyGroup } | null {
  const clean = sanitizeGroupName(name, state.groups.map((group) => group.name));
  if (!clean || state.groups.length >= MAX_GROUPS) return null;
  const group = { id, name: clean };
  return { state: { ...state, groups: [...state.groups, group] }, group };
}

export function renameGroup(
  state: WorkingCopyGroupsState,
  groupId: string,
  name: string
): WorkingCopyGroupsState {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group) return state;
  const others = state.groups.filter((candidate) => candidate.id !== groupId);
  const clean = sanitizeGroupName(name, others.map((candidate) => candidate.name));
  if (!clean || clean === group.name) return state;
  return {
    ...state,
    groups: state.groups.map((candidate) =>
      candidate.id === groupId ? { ...candidate, name: clean } : candidate
    ),
  };
}

/**
 * Delete a group. Its members fall back to the ungrouped section; their
 * manual-order entries survive so a re-created group with the same members
 * keeps the user's ordering.
 */
export function deleteGroup(
  state: WorkingCopyGroupsState,
  groupId: string
): WorkingCopyGroupsState {
  if (!state.groups.some((group) => group.id === groupId)) return state;
  const assignments = { ...state.assignments };
  for (const [path, assigned] of Object.entries(assignments)) {
    if (assigned === groupId) delete assignments[path];
  }
  return { ...state, groups: state.groups.filter((group) => group.id !== groupId), assignments };
}

/**
 * Reorder groups to match `orderedIds`. Ids that no longer exist (and paths
 * missing from the list) keep their relative order at the end/beginning, so a
 * stale caller can never drop a group.
 */
export function reorderGroups(
  state: WorkingCopyGroupsState,
  orderedIds: readonly string[]
): WorkingCopyGroupsState {
  const byId = new Map(state.groups.map((group) => [group.id, group]));
  const next: WorkingCopyGroup[] = [];
  for (const id of orderedIds) {
    const group = byId.get(id);
    if (group) {
      next.push(group);
      byId.delete(id);
    }
  }
  return { ...state, groups: [...next, ...byId.values()] };
}

/** Move a group one slot in the given direction. No-op at the edges. */
export function nudgeGroup(
  state: WorkingCopyGroupsState,
  groupId: string,
  direction: -1 | 1
): WorkingCopyGroupsState {
  const index = state.groups.findIndex((group) => group.id === groupId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.groups.length) return state;
  const groups = [...state.groups];
  [groups[index], groups[target]] = [groups[target], groups[index]];
  return { ...state, groups };
}

/** Assign (or, with `null`, unassign) a working copy. */
export function assignWorkingCopy(
  state: WorkingCopyGroupsState,
  path: string,
  groupId: string | null
): WorkingCopyGroupsState {
  const assignments = { ...state.assignments };
  if (groupId === null) {
    delete assignments[path];
  } else if (state.groups.some((group) => group.id === groupId)) {
    if (assignments[path] === groupId) return state;
    assignments[path] = groupId;
  } else {
    return state;
  }
  if (!state.manualOrder.includes(path)) {
    return { ...state, assignments, manualOrder: [...state.manualOrder, path] };
  }
  return { ...state, assignments };
}

/**
 * Reorder `path` within the manual order.
 *
 * `beforePath === null` appends at the end (used when dropping into an empty
 * group's header). Dropping onto a row inserts the dragged path directly
 * before that row.
 */
export function moveWorkingCopy(
  state: WorkingCopyGroupsState,
  path: string,
  beforePath: string | null
): WorkingCopyGroupsState {
  const order = state.manualOrder.filter((candidate) => candidate !== path);
  if (beforePath === null) {
    return { ...state, manualOrder: [...order, path] };
  }
  const index = order.indexOf(beforePath);
  if (index < 0) return { ...state, manualOrder: [...order, path] };
  order.splice(index, 0, path);
  return { ...state, manualOrder: order };
}

/* ── selection: how the sidebar turns paths + groups into sections ─────────── */

/** One rendered section: a named group, or the trailing ungrouped pool. */
export interface WorkingCopySection {
  group: WorkingCopyGroup | null;
  paths: string[];
}

/**
 * Order the working copies the way the sidebar's sort mode asks, then split
 * them into group sections (in group order) plus the ungrouped tail.
 *
 * Favorites (the existing pin flag) float to the top of their section in every
 * mode — pinned-first is the sidebar's long-standing behaviour, and a manual
 * order that silently overrode a favourite would read as a bug.
 */
export function groupWorkingCopies(
  paths: readonly string[],
  state: WorkingCopyGroupsState,
  {
    sortMode,
    isPinned,
  }: {
    sortMode: SidebarSortMode;
    isPinned: (path: string) => boolean;
  }
): WorkingCopySection[] {
  const ordered = orderWorkingCopies(paths, state.manualOrder, sortMode, isPinned);

  const sections: WorkingCopySection[] = state.groups.map((group) => ({ group, paths: [] }));
  const ungrouped: string[] = [];
  for (const path of ordered) {
    const groupId = state.assignments[path];
    const section = sections.find((candidate) => candidate.group?.id === groupId);
    if (section) section.paths.push(path);
    else ungrouped.push(path);
  }
  // The ungrouped section is the drop target for "remove from group", so it is
  // always present once any group exists — even while empty.
  if (state.groups.length > 0 || ungrouped.length > 0) sections.push({ group: null, paths: ungrouped });
  return sections;
}

/** Sort paths per mode; pinned first everywhere. */
function orderWorkingCopies(
  paths: readonly string[],
  manualOrder: readonly string[],
  sortMode: SidebarSortMode,
  isPinned: (path: string) => boolean
): string[] {
  let ordered: string[];
  if (sortMode === 'manual') {
    const known = new Set(paths);
    const seen = new Set<string>();
    ordered = [];
    for (const path of manualOrder) {
      if (known.has(path) && !seen.has(path)) {
        ordered.push(path);
        seen.add(path);
      }
    }
    for (const path of paths) {
      if (!seen.has(path)) {
        ordered.push(path);
        seen.add(path);
      }
    }
  } else if (sortMode === 'name') {
    ordered = paths.toSorted((a, b) => a.split('/').pop()!.localeCompare(b.split('/').pop()!));
  } else {
    ordered = [...paths];
  }
  return ordered.toSorted((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
}
