import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_WORKING_COPY_GROUPS,
  WORKING_COPY_GROUPS_KEY,
  assignWorkingCopy,
  createGroup,
  deleteGroup,
  groupWorkingCopies,
  loadWorkingCopyGroups,
  migrateLegacyWorkingCopyGroups,
  moveWorkingCopy,
  nudgeGroup,
  parseWorkingCopyGroups,
  renameGroup,
  reorderGroups,
  sanitizeGroupName,
  saveWorkingCopyGroups,
} from '../workingCopyGroups';

describe('sanitizeGroupName', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(sanitizeGroupName('  Client   work ')).toBe('Client work');
    expect(sanitizeGroupName('x'.repeat(100)).length).toBe(48);
  });

  it('de-blanks empty input and uniquifies collisions', () => {
    expect(sanitizeGroupName('   ')).toBe('');
    expect(sanitizeGroupName('Work', ['Work', 'Other'])).toBe('Work (2)');
    expect(sanitizeGroupName('Work', ['Work', 'Work (2)'])).toBe('Work (3)');
  });
});

describe('parseWorkingCopyGroups', () => {
  it('degrades unknown payloads to the empty state', () => {
    expect(parseWorkingCopyGroups(null)).toEqual(EMPTY_WORKING_COPY_GROUPS);
    expect(parseWorkingCopyGroups('nope')).toEqual(EMPTY_WORKING_COPY_GROUPS);
    expect(parseWorkingCopyGroups([1, 2])).toEqual(EMPTY_WORKING_COPY_GROUPS);
  });

  it('accepts a valid payload verbatim', () => {
    const state = {
      groups: [{ id: 'a', name: 'Alpha' }],
      assignments: { '/wc': 'a' },
      manualOrder: ['/wc', '/other'],
    };
    expect(parseWorkingCopyGroups(state)).toEqual(state);
  });

  it('drops assignments to groups that do not exist', () => {
    const parsed = parseWorkingCopyGroups({
      groups: [{ id: 'a', name: 'Alpha' }],
      assignments: { '/wc': 'a', '/ghost': 'missing' },
      manualOrder: ['/wc', '/ghost'],
    });
    expect(parsed.assignments).toEqual({ '/wc': 'a' });
    // Manual order survives: the working copy still exists, only its group is gone.
    expect(parsed.manualOrder).toEqual(['/wc', '/ghost']);
  });

  it('drops duplicate group ids and deduplicates order entries', () => {
    const parsed = parseWorkingCopyGroups({
      groups: [
        { id: 'a', name: 'Alpha' },
        { id: 'a', name: 'Alpha again' },
      ],
      assignments: {},
      manualOrder: ['/wc', '/wc', '/wc2'],
    });
    expect(parsed.groups).toEqual([{ id: 'a', name: 'Alpha' }]);
    expect(parsed.manualOrder).toEqual(['/wc', '/wc2']);
  });
});

describe('migrateLegacyWorkingCopyGroups', () => {
  it('folds the nested per-group items shape into assignments and order', () => {
    const migrated = migrateLegacyWorkingCopyGroups({
      groups: [
        { id: 'a', name: 'Alpha', items: ['/wc-a', '/wc-b'] },
        { id: 'b', name: 'Beta', items: ['/wc-c'] },
      ],
    });
    expect(migrated.groups.map((group) => group.id)).toEqual(['a', 'b']);
    expect(migrated.assignments).toEqual({ '/wc-a': 'a', '/wc-b': 'a', '/wc-c': 'b' });
    expect(migrated.manualOrder).toEqual(['/wc-a', '/wc-b', '/wc-c']);
  });

  it('degrades to empty for anything without a groups array', () => {
    expect(migrateLegacyWorkingCopyGroups({})).toEqual(EMPTY_WORKING_COPY_GROUPS);
    expect(migrateLegacyWorkingCopyGroups('x')).toEqual(EMPTY_WORKING_COPY_GROUPS);
  });
});

describe('group CRUD', () => {
  it('creates a group with a unique id and sanitized name', () => {
    const result = createGroup(EMPTY_WORKING_COPY_GROUPS, ' Client work ');
    expect(result).not.toBeNull();
    expect(result?.group.name).toBe('Client work');
    expect(result?.group.id).toMatch(/^group-/);
    expect(result?.state.groups).toHaveLength(1);
  });

  it('refuses a blank name', () => {
    expect(createGroup(EMPTY_WORKING_COPY_GROUPS, '   ')).toBeNull();
  });

  it('renames without colliding with siblings', () => {
    let state = EMPTY_WORKING_COPY_GROUPS;
    state = createGroup(state, 'Alpha')!.state;
    const beta = createGroup(state, 'Beta')!;
    state = beta.state;
    const renamed = renameGroup(state, beta.group.id, 'Alpha');
    expect(renamed.groups.find((group) => group.id === beta.group.id)?.name).toBe('Alpha (2)');
    // The original Alpha keeps its name.
    expect(renamed.groups.find((group) => group.name === 'Alpha')).toBeTruthy();
  });

  it('deleting a group returns members to the ungrouped section but keeps their order', () => {
    let state = EMPTY_WORKING_COPY_GROUPS;
    state = createGroup(state, 'Alpha')!.state;
    const id = state.groups[0].id;
    state = assignWorkingCopy(state, '/wc-a', id);
    state = assignWorkingCopy(state, '/wc-b', id);
    const after = deleteGroup(state, id);
    expect(after.groups).toHaveLength(0);
    expect(after.assignments).toEqual({});
    expect(after.manualOrder).toEqual(['/wc-a', '/wc-b']);
  });

  it('reorderGroups keeps unknown and missing ids from dropping groups', () => {
    let state = EMPTY_WORKING_COPY_GROUPS;
    state = createGroup(state, 'One', 'g1').state;
    state = createGroup(state, 'Two', 'g2').state;
    state = createGroup(state, 'Three', 'g3').state;
    const reordered = reorderGroups(state, ['g3', 'ghost', 'g1']);
    expect(reordered.groups.map((group) => group.id)).toEqual(['g3', 'g1', 'g2']);
  });

  it('nudgeGroup moves one slot and no-ops at the edges', () => {
    let state = EMPTY_WORKING_COPY_GROUPS;
    state = createGroup(state, 'One', 'g1').state;
    state = createGroup(state, 'Two', 'g2').state;
    expect(nudgeGroup(state, 'g1', -1)).toBe(state);
    expect(nudgeGroup(state, 'g1', 1).groups.map((group) => group.id)).toEqual(['g2', 'g1']);
    expect(nudgeGroup(state, 'g2', 1).groups.map((group) => group.id)).toEqual(['g1', 'g2']);
  });

  it('assigning to an unknown group is a no-op', () => {
    expect(assignWorkingCopy(EMPTY_WORKING_COPY_GROUPS, '/wc', 'ghost')).toBe(
      EMPTY_WORKING_COPY_GROUPS
    );
  });

  it('assigning a path records it in the manual order exactly once', () => {
    let state = EMPTY_WORKING_COPY_GROUPS;
    state = createGroup(state, 'Alpha')!.state;
    const id = state.groups[0].id;
    state = assignWorkingCopy(state, '/wc', id);
    state = assignWorkingCopy(state, '/wc', id);
    expect(state.manualOrder).toEqual(['/wc']);
    expect(assignWorkingCopy(state, '/wc', null).assignments).toEqual({});
  });

  it('moveWorkingCopy inserts before the target, or appends on null', () => {
    let state: typeof EMPTY_WORKING_COPY_GROUPS = {
      groups: [],
      assignments: {},
      manualOrder: ['/a', '/b', '/c'],
    };
    expect(moveWorkingCopy(state, '/c', '/a').manualOrder).toEqual(['/c', '/a', '/b']);
    expect(moveWorkingCopy(state, '/a', null).manualOrder).toEqual(['/b', '/c', '/a']);
    expect(moveWorkingCopy(state, '/a', '/not-there').manualOrder).toEqual(['/b', '/c', '/a']);
  });
});

describe('groupWorkingCopies', () => {
  const base = {
    groups: [
      { id: 'g1', name: 'Client' },
      { id: 'g2', name: 'Infra' },
    ],
    assignments: { '/wc-client': 'g1', '/wc-infra': 'g2' },
    manualOrder: ['/wc-infra', '/wc-client', '/wc-free'],
  };

  it('splits paths into ordered group sections plus the ungrouped tail', () => {
    const sections = groupWorkingCopies(
      ['/wc-client', '/wc-infra', '/wc-free'],
      base,
      { sortMode: 'default', isPinned: () => false }
    );
    expect(sections.map((section) => section.group?.id ?? null)).toEqual(['g1', 'g2', null]);
    expect(sections[0].paths).toEqual(['/wc-client']);
    expect(sections[2].paths).toEqual(['/wc-free']);
  });

  it('manual sort mode replays the stored drag order within each section', () => {
    const sections = groupWorkingCopies(
      ['/wc-client', '/wc-infra', '/wc-free'],
      base,
      { sortMode: 'manual', isPinned: () => false }
    );
    expect(sections[0].paths).toEqual(['/wc-client']);
    expect(sections[1].paths).toEqual(['/wc-infra']);
    expect(sections[2].paths).toEqual(['/wc-free']);
    // Sections render in group order (g1 Client, g2 Infra, ungrouped), while
    // each section's members follow the manual order restricted to it.
    expect(sections.flatMap((section) => section.paths)).toEqual([
      '/wc-client',
      '/wc-infra',
      '/wc-free',
    ]);
  });

  it('manual sort mode reorders multiple members of the same section', () => {
    const state = {
      groups: [{ id: 'g1', name: 'Client' }],
      assignments: { '/wc-a': 'g1', '/wc-b': 'g1', '/wc-c': 'g1' },
      manualOrder: ['/wc-c', '/wc-a', '/wc-b'],
    };
    const sections = groupWorkingCopies(['/wc-a', '/wc-b', '/wc-c'], state, {
      sortMode: 'manual',
      isPinned: () => false,
    });
    expect(sections[0].paths).toEqual(['/wc-c', '/wc-a', '/wc-b']);
  });

  it('name sort mode orders by path leaf', () => {
    const sections = groupWorkingCopies(['/wc-zeta', '/wc-alpha'], EMPTY_WORKING_COPY_GROUPS, {
      sortMode: 'name',
      isPinned: () => false,
    });
    expect(sections[0].paths).toEqual(['/wc-alpha', '/wc-zeta']);
  });

  it('favorites float to the top of their section in every mode', () => {
    const sections = groupWorkingCopies(
      ['/wc-client', '/wc-infra', '/wc-free'],
      base,
      { sortMode: 'manual', isPinned: (path) => path === '/wc-free' }
    );
    expect(sections[2].paths[0]).toBe('/wc-free');
  });

  it('paths removed from the recent list drop out of sections', () => {
    const sections = groupWorkingCopies(['/wc-client'], base, {
      sortMode: 'default',
      isPinned: () => false,
    });
    expect(sections.flatMap((section) => section.paths)).toEqual(['/wc-client']);
    expect(sections[1].paths).toEqual([]);
  });
});

describe('persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves under the v1 key and reloads the same state', async () => {
    const store = new Map<string, unknown>();
    window.api = {
      store: {
        get: vi.fn(async (key: string) => store.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          store.set(key, value);
        }),
      },
    } as unknown as Window['api'];

    const created = createGroup(EMPTY_WORKING_COPY_GROUPS, 'Alpha')!;
    await saveWorkingCopyGroups(created.state);
    expect(window.api.store.set).toHaveBeenCalledWith(WORKING_COPY_GROUPS_KEY, created.state);

    const loaded = await loadWorkingCopyGroups();
    expect(loaded).toEqual(created.state);
  });

  it('falls back to the legacy payload when v1 is absent', async () => {
    window.api = {
      store: {
        get: vi.fn(async (key: string) =>
          key === 'shellysvn:wc-groups'
            ? { groups: [{ id: 'a', name: 'Alpha', items: ['/wc'] }] }
            : undefined
        ),
        set: vi.fn(),
      },
    } as unknown as Window['api'];

    const loaded = await loadWorkingCopyGroups();
    expect(loaded.assignments).toEqual({ '/wc': 'a' });
  });

  it('storage failures degrade to the empty state', async () => {
    window.api = {
      store: {
        get: vi.fn(async () => {
          throw new Error('store offline');
        }),
        set: vi.fn(),
      },
    } as unknown as Window['api'];
    await expect(loadWorkingCopyGroups()).resolves.toEqual(EMPTY_WORKING_COPY_GROUPS);
  });
});
