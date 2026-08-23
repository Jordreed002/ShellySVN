import { describe, expect, it } from 'vitest';
import type { SvnLogEntry } from '@shared/types';

import {
  BRANCH_COLORS,
  buildRevisionGraph,
  branchColorForIndex,
  branchOfPath,
  DEFAULT_MAX_LANES,
  extractMergeSources,
  graphHeight,
  graphWidth,
  isBranchRootChange,
  laneCenterX,
  laneConnectorPath,
  looksLikeMergeMessage,
  MAIN_LANE_BRANCH,
  normalizeRepoPath,
  revisionY,
  windowRevisionGraph,
} from '../revisionGraph';

function entry(
  revision: number,
  message: string,
  paths: Array<{ action?: 'A' | 'D' | 'M' | 'R'; path: string; copyFromPath?: string; copyFromRev?: number }>,
  author = 'alice'
): SvnLogEntry {
  return {
    revision,
    author,
    date: new Date(Date.UTC(2026, 0, 1, 0, 0, revision % 60)).toISOString(),
    message,
    paths: paths.map((change) => ({
      action: change.action ?? 'M',
      path: change.path,
      ...(change.copyFromPath && { copyFromPath: change.copyFromPath }),
      ...(change.copyFromRev !== undefined && { copyFromRev: change.copyFromRev }),
    })),
  };
}

describe('branch classification', () => {
  it('maps standard layout paths to their branch roots', () => {
    expect(branchOfPath('/trunk')).toBe('trunk');
    expect(branchOfPath('/trunk/src/app.ts')).toBe('trunk');
    expect(branchOfPath('/branches/feature/src/app.ts')).toBe('branches/feature');
    expect(branchOfPath('/branches/feature')).toBe('branches/feature');
    expect(branchOfPath('/tags/v1.0')).toBe('tags/v1.0');
    expect(branchOfPath('/project/trunk/lib/x.ts')).toBe('project/trunk');
    expect(branchOfPath('/project/branches/rel-1/lib/x.ts')).toBe('project/branches/rel-1');
  });

  it('falls back to the project root or the main lane', () => {
    expect(branchOfPath('/project/file.ts')).toBe('project');
    expect(branchOfPath('/file.ts')).toBe(MAIN_LANE_BRANCH);
    expect(branchOfPath('')).toBe(MAIN_LANE_BRANCH);
    expect(branchOfPath('/')).toBe(MAIN_LANE_BRANCH);
  });

  it('normalizes separators, slashes and whitespace', () => {
    expect(normalizeRepoPath(' /trunk/src//app.ts/ ')).toBe('trunk/src/app.ts');
    expect(normalizeRepoPath('\\branches\\feature')).toBe('branches/feature');
    expect(branchOfPath('\\branches\\feature\\src')).toBe('branches/feature');
  });

  it('detects branch-root changes (deletions) exactly at the root', () => {
    expect(isBranchRootChange({ action: 'D', path: '/branches/feature' })).toBe(true);
    expect(isBranchRootChange({ action: 'D', path: '/branches/feature/src' })).toBe(false);
    expect(isBranchRootChange({ action: 'M', path: '/branches/feature' })).toBe(true); // shape only
  });
});

describe('merge heuristics', () => {
  it('recognizes merge messages and ignores ordinary ones', () => {
    expect(looksLikeMergeMessage('Merge branches/feature into trunk')).toBe(true);
    expect(looksLikeMergeMessage('merged recent fixes')).toBe(true);
    expect(looksLikeMergeMessage('merged: sync from branch')).toBe(true);
    expect(looksLikeMergeMessage('Create release tag')).toBe(false);
    expect(looksLikeMergeMessage('Fix login bug')).toBe(false);
  });

  it('extracts referenced branches minus the landing branch', () => {
    const sources = extractMergeSources(
      'Merge branches/feature into trunk, also mentions branches/hotfix',
      [{ action: 'M', path: '/trunk/src/app.ts' }],
      'trunk'
    );
    expect(sources).toEqual(['branches/feature', 'branches/hotfix']);
  });

  it('scans copy-from paths and skips non-merge messages entirely', () => {
    expect(
      extractMergeSources('nothing here', [{ action: 'A', path: '/trunk/x', copyFromPath: '/branches/old' }], 'trunk')
    ).toEqual([]);
    expect(
      extractMergeSources('Merge over', [{ action: 'A', path: '/trunk/x', copyFromPath: '/branches/old' }], 'trunk')
    ).toEqual(['branches/old']);
  });
});

describe('buildRevisionGraph lanes', () => {
  const fixture = (): SvnLogEntry[] => [
    entry(300, 'Merge branches/feature into trunk', [{ path: '/trunk/src/app.ts' }]),
    entry(250, 'Create release tag', [{ action: 'A', path: '/tags/v1.0', copyFromPath: '/trunk', copyFromRev: 200 }]),
    entry(220, 'Feature work', [{ path: '/branches/feature/src/app.ts' }]),
    entry(210, 'More feature work', [{ path: '/branches/feature/lib.ts' }]),
    entry(200, 'Trunk baseline', [{ path: '/trunk/src/app.ts' }]),
    entry(190, 'Older trunk work', [{ path: '/trunk/lib.ts' }]),
  ];

  it('assigns one stable lane per branch with deterministic ids', () => {
    const model = buildRevisionGraph(fixture());
    expect(model.stats).toEqual({
      revisions: 6,
      branches: 3,
      copyPoints: 1,
      merges: 1,
      deletions: 0,
    });

    const trunkLane = model.laneById.get('trunk');
    const featureLane = model.laneById.get('branches/feature');
    const tagLane = model.laneById.get('tags/v1.0');
    expect(trunkLane).toBeDefined();
    expect(featureLane).toBeDefined();
    expect(tagLane).toBeDefined();
    expect(trunkLane?.branch).toBe('trunk');
    expect(trunkLane?.revisionCount).toBe(3); // r190, r200, r300
    expect(featureLane?.revisionCount).toBe(2);
    expect(tagLane?.revisionCount).toBe(1);
    expect(model.laneIdsByBranch.get('trunk')).toEqual(['trunk']);

    // Column assignment: trunk (first seen, oldest) gets column 0.
    expect(trunkLane?.columnIndex).toBe(0);
    expect(featureLane?.columnIndex).toBe(1);
    expect(tagLane?.columnIndex).toBe(2);
    expect(model.columnCount).toBe(3);
  });

  it('is deterministic regardless of input order and duplicate revisions', () => {
    const ordered = buildRevisionGraph(fixture());
    const shuffled = buildRevisionGraph([
      fixture()[3] as SvnLogEntry,
      fixture()[0] as SvnLogEntry,
      fixture()[0] as SvnLogEntry, // duplicate revision
      ...fixture().slice(1),
    ]);
    expect(shuffled.nodes.map((n) => n.revision)).toEqual(ordered.nodes.map((n) => n.revision));
    expect(shuffled.lanes.map((l) => l.id)).toEqual(ordered.lanes.map((l) => l.id));
    expect(shuffled.edges).toEqual(ordered.edges);
  });

  it('orders rows newest-first with head/tail flags', () => {
    const model = buildRevisionGraph(fixture());
    expect(model.nodes.map((n) => n.revision)).toEqual([300, 250, 220, 210, 200, 190]);
    expect(model.nodes[0]).toMatchObject({ isHead: true, isTail: false, rowIndex: 0 });
    expect(model.nodes[5]).toMatchObject({ isHead: false, isTail: true, rowIndex: 5 });
  });

  it('keeps multi-branch commits on their primary lane with dots on every touched lane', () => {
    const model = buildRevisionGraph([
      entry(30, 'Cross-branch fix', [
        { path: '/trunk/src/a.ts' },
        { path: '/branches/feature/src/a.ts' },
      ]),
    ]);
    const node = model.nodes[0];
    expect(node.laneId).toBe('trunk'); // first touched path is primary
    expect(node.laneIds).toEqual(['trunk', 'branches/feature']);
  });

  it('terminates lanes on branch deletion and re-creates with a fresh id', () => {
    // Ascending history: trunk → branch → deleted → re-created branch.
    const model = buildRevisionGraph([
      entry(280, 'trunk older', [{ path: '/trunk/y' }]),
      entry(290, 'trunk work', [{ path: '/trunk/x' }]),
      entry(300, 'Create the feature branch', [
        { action: 'A', path: '/branches/feature', copyFromPath: '/trunk', copyFromRev: 290 },
      ]),
      entry(350, 'feature work', [{ path: '/branches/feature/x' }]),
      entry(400, 'Remove the feature branch', [{ action: 'D', path: '/branches/feature' }]),
      entry(450, 'Recreate the feature branch', [
        { action: 'A', path: '/branches/feature', copyFromPath: '/trunk', copyFromRev: 290 },
      ]),
      entry(470, 'more feature work', [{ path: '/branches/feature/x' }]),
    ]);

    const incarnations = model.laneIdsByBranch.get('branches/feature');
    expect(incarnations).toEqual(['branches/feature', 'branches/feature#2']);

    const first = model.laneById.get('branches/feature');
    const second = model.laneById.get('branches/feature#2');
    expect(first?.deletedAtRevision).toBe(400);
    expect(second?.deletedAtRevision).toBeNull();
    // Same display branch, distinct stable ids and colors.
    expect(first?.branch).toBe('branches/feature');
    expect(second?.colorIndex).not.toBe(first?.colorIndex);
    expect(model.stats.deletions).toBe(1);

    // Column recycling: the reincarnation reuses the freed column.
    expect(second?.columnIndex).toBe(first?.columnIndex);
  });

  it('re-uses lane columns after deletion to keep the graph compact', () => {
    // Ascending: trunk (col 0), b (col 1), a (col 2); a dies at r50 freeing
    // col 2, so the branch created at r60 recycles it.
    const model = buildRevisionGraph(
      [
        entry(43, 'trunk', [{ path: '/trunk/x' }]),
        entry(44, 'work b', [{ path: '/branches/b/x' }]),
        entry(45, 'work a', [{ path: '/branches/a/x' }]),
        entry(50, 'delete one', [{ action: 'D', path: '/branches/a' }]),
        entry(60, 'new branch after column freed', [
          { action: 'A', path: '/branches/c', copyFromPath: '/trunk', copyFromRev: 43 },
        ]),
      ],
      { maxLanes: 4 }
    );
    const laneA = model.laneById.get('branches/a');
    const laneC = model.laneById.get('branches/c');
    expect(laneA?.columnIndex).toBe(2);
    expect(laneC?.columnIndex).toBe(2); // recycled
    expect(model.columnCount).toBe(3);
  });

  it('collapses branches beyond maxLanes into a shared overflow column', () => {
    const entries: SvnLogEntry[] = [];
    for (let i = 0; i < DEFAULT_MAX_LANES + 6; i++) {
      entries.push(entry(1000 - i * 2, `work ${i}`, [{ path: `/branches/b${i}/x` }]));
    }
    const model = buildRevisionGraph(entries);
    const realColumns = new Set(
      model.lanes.filter((lane) => !lane.isOverflow).map((lane) => lane.columnIndex)
    );
    expect(realColumns.size).toBeLessThanOrEqual(DEFAULT_MAX_LANES);
    expect(model.lanes.some((lane) => lane.isOverflow)).toBe(true);
    expect(model.overflowBranches.length).toBe(6);
    expect(model.columnCount).toBe(DEFAULT_MAX_LANES + 1);
    // All lanes still have nodes; nothing was dropped by the cap.
    expect(model.nodes.length).toBe(DEFAULT_MAX_LANES + 6);
  });
});

describe('buildRevisionGraph copy points', () => {
  it('marks branch/tag creations with their copy source and a branch edge', () => {
    const model = buildRevisionGraph([
      entry(300, 'work', [{ path: '/tags/v1.0/x' }]),
      entry(250, 'Create release tag', [
        { action: 'A', path: '/tags/v1.0', copyFromPath: '/trunk', copyFromRev: 200 },
      ]),
      entry(200, 'Trunk baseline', [{ path: '/trunk/src/app.ts' }]),
      entry(190, 'Older trunk', [{ path: '/trunk/lib.ts' }]),
    ]);

    const copyNode = model.nodes.find((n) => n.revision === 250);
    expect(copyNode?.copyPoint).toEqual({
      path: 'tags/v1.0',
      branch: 'tags/v1.0',
      fromPath: 'trunk',
      fromRev: 200,
    });

    const branchEdge = model.edges.find((edge) => edge.kind === 'branch');
    expect(branchEdge).toMatchObject({
      from: { revision: 200, laneId: 'trunk' },
      to: { revision: 250, laneId: 'tags/v1.0' },
    });

    // Lane birth is the copy revision.
    expect(model.laneById.get('tags/v1.0')?.bornRevision).toBe(250);
  });

  it('anchors branch edges to the nearest source-lane revision when the exact copy-from rev is outside the window', () => {
    const model = buildRevisionGraph([
      entry(500, 'work', [{ path: '/branches/late/x' }]),
      entry(450, 'Create branch from an old trunk rev', [
        { action: 'A', path: '/branches/late', copyFromPath: '/trunk', copyFromRev: 120 },
      ]),
      entry(400, 'trunk in window', [{ path: '/trunk/x' }]),
      entry(300, 'older trunk', [{ path: '/trunk/y' }]),
    ]);
    const branchEdge = model.edges.find((edge) => edge.kind === 'branch');
    // r120 is not loaded; the closest loaded trunk revision at or below it is the oldest (r300).
    expect(branchEdge).toMatchObject({
      kind: 'branch',
      from: { revision: 300 },
      to: { revision: 450 },
    });
  });

  it('records copy markers without edges when copyfrom-rev is missing or zero', () => {
    const model = buildRevisionGraph([
      entry(10, 'copy without rev', [
        { action: 'A', path: '/branches/norev', copyFromPath: '/trunk' },
      ]),
      entry(9, 'trunk', [{ path: '/trunk/x' }]),
    ]);
    expect(model.nodes[0].copyPoint?.fromRev).toBe(0);
    expect(model.edges.filter((edge) => edge.kind === 'branch')).toHaveLength(0);
  });

  it('prefers a cross-branch copy over file copies inside the same branch', () => {
    const model = buildRevisionGraph([
      entry(20, 'branch plus file copies', [
        { action: 'A', path: '/branches/new/x', copyFromPath: '/branches/new/y' },
        { action: 'A', path: '/branches/new', copyFromPath: '/trunk', copyFromRev: 15 },
      ]),
      entry(15, 'trunk', [{ path: '/trunk/x' }]),
    ]);
    const node = model.nodes.find((n) => n.revision === 20);
    expect(node?.copyPoint?.fromPath).toBe('trunk');
    expect(node?.copyPoint?.fromRev).toBe(15);
  });
});

describe('buildRevisionGraph edges', () => {
  it('chains consecutive revisions on a lane and keeps gaps in one straight line', () => {
    const model = buildRevisionGraph([
      entry(300, 'a', [{ path: '/trunk/x' }]),
      entry(200, 'b', [{ path: '/trunk/x' }]),
      entry(100, 'c', [{ path: '/trunk/x' }]),
    ]);
    const parentEdges = model.edges.filter((edge) => edge.kind === 'parent');
    expect(parentEdges).toHaveLength(2);
    expect(parentEdges[0]).toMatchObject({ from: { revision: 200 }, to: { revision: 300 } });
    expect(parentEdges[1]).toMatchObject({ from: { revision: 100 }, to: { revision: 200 } });
  });

  it('derives merge edges from messages, pointing at the newest source-branch revision below the merge', () => {
    const model = buildRevisionGraph([
      entry(500, 'Merge branches/feature into trunk', [{ path: '/trunk/x' }]),
      entry(480, 'feature latest', [{ path: '/branches/feature/x' }]),
      entry(470, 'trunk direct', [{ path: '/trunk/y' }]),
      entry(450, 'feature older', [{ path: '/branches/feature/y' }]),
    ]);
    const mergeEdges = model.edges.filter((edge) => edge.kind === 'merge');
    expect(mergeEdges).toHaveLength(1);
    expect(mergeEdges[0]).toMatchObject({
      from: { revision: 480, laneId: 'branches/feature' },
      to: { revision: 500, laneId: 'trunk' },
    });
    const mergeNode = model.nodes.find((n) => n.revision === 500);
    expect(mergeNode?.merges).toEqual([{ branch: 'branches/feature', kind: 'message' }]);
  });

  it('keeps merge annotations even when the source branch is not loaded', () => {
    const model = buildRevisionGraph([
      entry(10, 'Merge branches/ghost into trunk', [{ path: '/trunk/x' }]),
    ]);
    expect(model.nodes[0].merges).toEqual([{ branch: 'branches/ghost', kind: 'message' }]);
    expect(model.edges.filter((edge) => edge.kind === 'merge')).toHaveLength(0);
  });

  it('drops edges whose endpoints vanished and never emits self edges', () => {
    const model = buildRevisionGraph([
      entry(10, 'merge self', [{ path: '/trunk' }]),
    ]);
    expect(model.edges).toHaveLength(0);
  });
});

describe('palette', () => {
  it('has distinct colors with the default accent first', () => {
    expect(new Set(BRANCH_COLORS).size).toBe(BRANCH_COLORS.length);
    expect(BRANCH_COLORS[0]).toBe('#58a6ff');
    // The first N lanes always get distinct colors.
    const firstPass = Array.from({ length: BRANCH_COLORS.length }, (_, i) => branchColorForIndex(i));
    expect(new Set(firstPass).size).toBe(BRANCH_COLORS.length);
  });

  it('is stable per lane and wraps deterministically', () => {
    expect(branchColorForIndex(0)).toBe(branchColorForIndex(BRANCH_COLORS.length));
    expect(branchColorForIndex(3)).toBe(branchColorForIndex(BRANCH_COLORS.length + 3));
  });
});

describe('geometry', () => {
  it('computes lane and revision positions', () => {
    expect(laneCenterX(0, 14)).toBe(7);
    expect(laneCenterX(2, 14)).toBe(35);
    expect(revisionY(0, 26)).toBe(13);
    expect(revisionY(4, 26)).toBe(117);
    expect(graphWidth(3, 14)).toBe(42);
    expect(graphHeight(10, 26)).toBe(260);
  });

  it('builds vertical-exit connector paths', () => {
    expect(laneConnectorPath({ x: 7, y: 100 }, { x: 35, y: 50 })).toBe(
      'M 7 100 C 7 75, 35 75, 35 50'
    );
  });
});

describe('windowing', () => {
  const model = buildRevisionGraph(
    Array.from({ length: 50 }, (_, i) =>
      entry(1000 - i, `rev ${i}`, [{ path: i % 5 === 4 ? '/branches/alt/x' : '/trunk/x' }])
    )
  );

  it('slices nodes to the visible window', () => {
    const { nodes } = windowRevisionGraph(model, { offset: 10, count: 5 });
    expect(nodes.map((n) => n.rowIndex)).toEqual([10, 11, 12, 13, 14]);
  });

  it('keeps boundary-crossing edges with one row of grace', () => {
    const { edges } = windowRevisionGraph(model, { offset: 0, count: 1 });
    // The newest row's parent edge comes from row 1 (outside) but stays visible via grace.
    expect(edges.some((edge) => edge.kind === 'parent' && edge.to.rowIndex === 0)).toBe(true);
    const deep = windowRevisionGraph(model, { offset: 30, count: 2 }).edges;
    expect(
      deep.every((edge) => edge.from.rowIndex >= 29 && edge.from.rowIndex <= 33)
    ).toBe(true);
  });

  it('returns empty slices for out-of-range windows', () => {
    expect(windowRevisionGraph(model, { offset: 500, count: 10 }).nodes).toEqual([]);
  });
});

describe('large-input sanity', () => {
  it('builds a 10k-revision history without exploding lanes or edges', () => {
    const entries: SvnLogEntry[] = [];
    for (let i = 0; i < 10_000; i++) {
      const revision = 20_000 - i;
      const branch = i % 17 === 0 ? `/branches/b${i % 40}` : '/trunk';
      entries.push(entry(revision, i % 23 === 0 ? `Merge branches/b${(i + 1) % 40} into trunk` : 'work', [
        { path: `${branch}/src/file${i % 50}.ts` },
      ]));
    }
    const startedAt = performance.now();
    const model = buildRevisionGraph(entries, { maxLanes: 12 });
    const elapsed = performance.now() - startedAt;

    expect(model.nodes.length).toBe(10_000);
    expect(model.columnCount).toBeLessThanOrEqual(13);
    expect(model.stats.revisions).toBe(10_000);
    // Single linear pass + edge resolution must stay comfortably fast.
    expect(elapsed).toBeLessThan(2_000);

    // Windowing a 40-row slice is tiny regardless of history size.
    const windowStarted = performance.now();
    const slice = windowRevisionGraph(model, { offset: 5_000, count: 40 });
    expect(slice.nodes.length).toBe(40);
    expect(performance.now() - windowStarted).toBeLessThan(50);
  });
});
