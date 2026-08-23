import { describe, expect, it } from 'vitest';

import {
  forAll,
  genArray,
  genBoolean,
  genConstant,
  genInt,
  genMap,
  genOneOf,
  genOptional,
  genPick,
  genRecord,
  Rng,
} from '@test-utils/propertyCheck';

import type { SvnLogEntry } from '@shared/types';

import {
  branchColorForIndex,
  buildRevisionGraph,
  DEFAULT_MAX_LANES,
  MAIN_LANE_BRANCH,
  windowRevisionGraph,
} from '../revisionGraph';

/*
 * Property tests for the pure revision-graph model (item #130): structural
 * invariants that must hold for ANY log — lane columns respect the cap (with
 * one shared overflow column), every distinct revision appears exactly once,
 * palette colors are distinct within the first eight lanes, and all node/edge
 * references resolve.
 */

const BRANCH_NAMES = ['alpha', 'beta', 'gamma', 'delta', 'eps'];

const genBranch = genOneOf(
  genConstant('trunk'),
  genConstant('proj/trunk'),
  genMap(genPick(BRANCH_NAMES), (name) => `branches/${name}`),
  genMap(genPick(BRANCH_NAMES), (name) => `tags/${name}`),
  genMap(genPick(BRANCH_NAMES), (name) => `proj/branches/${name}`),
  genConstant('scratch')
);

const genFilePath = genPick(['src/file.ts', 'README.md', 'sub/dir/x', 'a.b'] as const);

/** A path inside a branch; `atRoot` yields the branch root itself. */
const genRepoPath = genMap(
  genRecord({ branch: genBranch, atRoot: genBoolean, file: genFilePath }),
  ({ branch, atRoot, file }) => (atRoot ? branch : `${branch}/${file}`)
);

const genChange = genRecord({
  action: genPick(['A', 'M', 'D', 'R'] as const),
  path: genRepoPath,
  copyFromPath: genOptional(genRepoPath, 0.25),
  copyFromRev: genOptional(genInt({ min: 0, max: 30 }), 0.25),
});

const genMessage = genOneOf(
  genConstant(''),
  genConstant('fix a bug'),
  genConstant('merge changes from trunk'),
  genConstant('Merged branches/alpha into trunk'),
  genConstant('sync with proj/branches/beta')
);

interface GeneratedEntry {
  revision: number;
  changes: Array<{
    action: 'A' | 'M' | 'D' | 'R';
    path: string;
    copyFromPath?: string;
    copyFromRev?: number;
  }>;
  message: string;
  author: string;
}

const genGeneratedEntry = genRecord({
  revision: genInt({ min: 1, max: 40 }),
  changes: genArray(genChange, { min: 0, max: 5 }),
  message: genMessage,
  author: genPick(['alice', 'bob', 'carol'] as const),
});

function toLogEntry(entry: GeneratedEntry): SvnLogEntry {
  return {
    revision: entry.revision,
    author: entry.author,
    date: new Date(Date.UTC(2026, 0, 1, 0, 0, entry.revision % 60)).toISOString(),
    message: entry.message,
    paths: entry.changes.map((change) => ({
      action: change.action,
      path: change.path,
      ...(change.copyFromPath !== undefined && { copyFromPath: change.copyFromPath }),
      ...(change.copyFromRev !== undefined && { copyFromRev: change.copyFromRev }),
    })),
  };
}

const genScenario = genRecord({
  entries: genArray(genGeneratedEntry, { min: 0, max: 14 }),
  maxLanes: genOptional(genInt({ min: 2, max: 6 }), 0.5),
  windowOffset: genInt({ min: 0, max: 10 }),
  windowCount: genInt({ min: 0, max: 12 }),
});

describe('buildRevisionGraph properties', () => {
  it('maintains structural invariants for any log (lanes, uniqueness, colors, references)', () => {
    forAll(
      genScenario,
      ({ entries, maxLanes }) => {
        const laneCap = maxLanes ?? DEFAULT_MAX_LANES;
        const model = buildRevisionGraph(entries.map(toLogEntry), maxLanes ? { maxLanes } : {});

        const distinctRevisions = new Set(
          entries.filter((entry) => entry.revision > 0).map((entry) => entry.revision)
        );

        // Every distinct revision appears exactly once, newest first,
        // rowIndex === index, head/tail flags correct.
        expect(model.nodes).toHaveLength(distinctRevisions.size);
        expect(model.stats.revisions).toBe(distinctRevisions.size);
        model.nodes.forEach((node, index) => {
          expect(node.rowIndex).toBe(index);
          if (index > 0) {
            expect(node.revision).toBeLessThan(model.nodes[index - 1]?.revision as number);
          }
          expect(node.isHead).toBe(index === 0);
          expect(node.isTail).toBe(index === model.nodes.length - 1);
          expect(distinctRevisions.has(node.revision)).toBe(true);
        });

        // Lanes: unique ids, unique color indexes, column cap with the single
        // shared overflow column, palette colors distinct within the first 8.
        expect(model.lanes.length).toBe(model.laneById.size);
        expect(model.columnCount).toBeLessThanOrEqual(laneCap + 1);
        const colorIndexes = new Set<number>();
        const laneIds = new Set<string>();
        for (const lane of model.lanes) {
          expect(lane.columnIndex).toBeLessThanOrEqual(laneCap);
          expect(lane.isOverflow).toBe(lane.columnIndex === laneCap);
          expect(colorIndexes.has(lane.colorIndex)).toBe(false);
          colorIndexes.add(lane.colorIndex);
          expect(laneIds.has(lane.id)).toBe(false);
          laneIds.add(lane.id);
          expect(lane.color).toBe(branchColorForIndex(lane.colorIndex));
          expect(model.laneById.get(lane.id)).toBe(lane);
        }
        const byColor = model.lanes.toSorted((a, b) => a.colorIndex - b.colorIndex);
        const firstEightColors = new Set(byColor.slice(0, 8).map((l) => l.color));
        expect(firstEightColors.size).toBe(Math.min(8, byColor.length));

        // Node lane references resolve.
        for (const node of model.nodes) {
          expect(model.laneById.has(node.laneId)).toBe(true);
          for (const laneId of node.laneIds) {
            expect(model.laneById.has(laneId)).toBe(true);
          }
        }

        // Branch bookkeeping: every lane id appears under its branch exactly once.
        const allLaneIdsByBranch = [...model.laneIdsByBranch.values()].flat();
        expect(new Set(allLaneIdsByBranch).size).toBe(allLaneIdsByBranch.length);
        expect(new Set(allLaneIdsByBranch)).toEqual(laneIds);
        for (const [branch, ids] of model.laneIdsByBranch) {
          for (const id of ids) {
            expect(model.laneById.get(id)?.branch).toBe(branch);
          }
        }
        // A second incarnation of a branch uses the `#N` suffix (never bare).
        for (const lane of model.lanes) {
          const incarnation = Number(lane.id.split('#')[1] ?? '1');
          expect(Number.isInteger(incarnation)).toBe(true);
        }

        // Edges reference existing lanes and in-range rows.
        for (const edge of model.edges) {
          expect(model.laneById.has(edge.laneId)).toBe(true);
          expect(edge.to.rowIndex).toBeGreaterThanOrEqual(0);
          expect(edge.to.rowIndex).toBeLessThan(model.nodes.length);
          expect(edge.from.rowIndex).toBeGreaterThanOrEqual(0);
          expect(edge.from.rowIndex).toBeLessThan(model.nodes.length);
        }

        // Overflow bookkeeping matches the lanes flagged as overflow.
        const expectedOverflow = new Set(
          model.lanes.filter((lane) => lane.isOverflow).map((lane) => lane.branch)
        );
        expect(new Set(model.overflowBranches)).toEqual(expectedOverflow);

        // Deterministic: the same input builds the same model.
        const rebuilt = buildRevisionGraph(entries.map(toLogEntry), maxLanes ? { maxLanes } : {});
        expect(rebuilt).toEqual(model);
        return true;
      },
      { runs: 120 }
    );
  });

  it('windowing returns exactly the rows inside the window, never more than requested', () => {
    forAll(
      genScenario,
      ({ entries, maxLanes, windowOffset, windowCount }) => {
        const model = buildRevisionGraph(entries.map(toLogEntry), maxLanes ? { maxLanes } : {});
        const { nodes } = windowRevisionGraph(model, { offset: windowOffset, count: windowCount });
        const expected = model.nodes.filter(
          (node) =>
            node.rowIndex >= windowOffset && node.rowIndex < windowOffset + windowCount
        );
        expect(nodes).toEqual(expected);
        expect(nodes.length).toBeLessThanOrEqual(windowCount);
        // Row indexes stay aligned with the model.
        for (const node of nodes) {
          expect(model.nodes[node.rowIndex]?.revision).toBe(node.revision);
        }
        return true;
      },
      { runs: 120 }
    );
  });

  it('paths outside any branch layout land on the (main) lane', () => {
    forAll(
      genRecord({
        // Single-segment paths only: a top-level directory would itself
        // become a project branch (branchOfPath rule).
        paths: genArray(
          genPick(['README.md', 'Makefile', 'a.b', 'misc'] as const),
          { min: 1, max: 4 }
        ),
        seed: genInt({ min: 1, max: 9999 }),
      }),
      ({ paths, seed }) => {
        const rng = new Rng(seed);
        const entries: SvnLogEntry[] = paths.map((path, index) => ({
          revision: index + 1,
          author: 'alice',
          date: '2026-01-01T00:00:00Z',
          message: 'edit',
          paths: [{ action: 'M', path }],
        }));
        const model = buildRevisionGraph(rng.shuffle(entries));
        expect(model.nodes.length).toBeGreaterThan(0);
        for (const node of model.nodes) {
          expect(node.branch).toBe(MAIN_LANE_BRANCH);
        }
        return true;
      },
      { runs: 100 }
    );
  });
});
