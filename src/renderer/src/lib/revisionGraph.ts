/**
 * Pure revision-graph model for SVN logs (#45).
 *
 * Subversion has no global parent chain like Git: a revision simply touches a
 * set of repository paths. A visual graph therefore derives its structure from
 * three signals in `svn log -v` output:
 *
 *  1. **Changed paths** — which branch roots a revision touched, which we turn
 *     into "lanes" (one vertical column per branch incarnation).
 *  2. **Copy sources** (`copyfrom-path` / `copyfrom-rev`, already parsed by the
 *     shared log parser) — the true branch/tag creation points. These become
 *     copy-point markers and diagonal "branch" edges.
 *  3. **Message heuristics** — a message that says "merge" plus branch names
 *     referenced in it (or in copy-from paths) yields "merge" annotations and
 *     dashed merge edges. This is best-effort: `svn:mergeinfo`-accurate edges
 *     would need `svn log --use-merge-history` data, which the current log
 *     payload does not surface to the renderer (the parser drops the
 *     `mod="merged"` path annotations), so we only claim what we can derive.
 *
 * The module is deliberately free of React/DOM so the lane assignment,
 * copy-point detection and edge resolution are unit-testable in isolation.
 */

import type { SvnLogEntry, SvnLogPath } from '@shared/types';

/* ───────────────────────────── branch classification ─────────────────────── */

/** Lane for logs whose paths don't sit under a recognizable branch layout. */
export const MAIN_LANE_BRANCH = '(main)';

const LAYOUT_ROOT_SEGMENTS = new Set(['trunk', 'branch']);
const LAYOUT_NAMED_SEGMENTS = new Set(['branches', 'tags']);

/** Normalize a repository path from `svn log` (leading `/`, mixed separators). */
export function normalizeRepoPath(rawPath: string): string {
  return rawPath
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replaceAll(/\/{2,}/g, '/');
}

/**
 * The branch a changed path belongs to: `trunk`, `branches/x`, `tags/x`
 * (one segment below the layout root), or the project's top-level directory.
 */
export function branchOfPath(rawPath: string): string {
  const path = normalizeRepoPath(rawPath);
  if (!path) return MAIN_LANE_BRANCH;
  const segments = path.split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (LAYOUT_ROOT_SEGMENTS.has(segment)) {
      return segments.slice(0, i + 1).join('/');
    }
    if (LAYOUT_NAMED_SEGMENTS.has(segment)) {
      return segments.slice(0, i + 2).join('/');
    }
  }
  return segments.length > 1 ? (segments[0] as string) : MAIN_LANE_BRANCH;
}

/** True when the changed path is exactly the branch root (a branch deletion). */
export function isBranchRootChange(change: SvnLogPath): boolean {
  const normalized = normalizeRepoPath(change.path);
  return normalized !== '' && normalized === branchOfPath(change.path);
}

/* ───────────────────────────── merge heuristics ──────────────────────────── */

const MERGE_MESSAGE_RE = /\bmerg(?:e|es|ed|ing)\b/i;
const BRANCH_REF_RE =
  /\b(?:trunk\b|branches\/[^\s,;:)\]}'"]+|tags\/[^\s,;:)\]}'"]+|branch\/[^\s,;:)\]}'"]+)/g;

/** Messages that look like merge/sync commits (best-effort, see file header). */
export function looksLikeMergeMessage(message: string): boolean {
  return MERGE_MESSAGE_RE.test(message);
}

/**
 * Branches referenced by a merge commit: scanned in the message text plus the
 * changed and copy-from paths, minus the branch the commit lands on.
 */
export function extractMergeSources(
  message: string,
  paths: readonly SvnLogPath[],
  currentBranch: string
): string[] {
  if (!looksLikeMergeMessage(message)) return [];
  const text = [message, ...paths.map((p) => [p.path, p.copyFromPath].filter(Boolean).join(' '))]
    .join(' ')
    .replaceAll('\\', '/');
  const refs = new Set<string>();
  for (const match of text.matchAll(BRANCH_REF_RE)) {
    const ref = normalizeRepoPath(match[0]);
    if (ref && ref !== currentBranch) refs.add(ref);
  }
  return [...refs];
}

/* ───────────────────────────── model types ───────────────────────────────── */

/** A branch created by `svn copy` — the true copy-point marker payload. */
export interface RevisionGraphCopyPoint {
  /** Repository path created by the copy. */
  path: string;
  /** Branch lane the copy created. */
  branch: string;
  /** Copy source path (`copyfrom-path`). */
  fromPath: string;
  /** Copy source revision (`copyfrom-rev`); 0 when the log omitted it. */
  fromRev: number;
}

export interface RevisionGraphMergeSource {
  branch: string;
  /** How the merge was derived — only message heuristics exist today. */
  kind: 'message';
}

export interface RevisionGraphNode {
  revision: number;
  /** 0 = newest loaded revision (top of the graph). */
  rowIndex: number;
  /** Lane the node's dot is anchored to (the commit's primary branch). */
  laneId: string;
  /** Every lane this revision touched (dots render on each). */
  laneIds: string[];
  branch: string;
  author: string;
  date: string;
  message: string;
  isHead: boolean;
  isTail: boolean;
  copyPoint?: RevisionGraphCopyPoint;
  merges: RevisionGraphMergeSource[];
  /** Branch roots deleted by this revision (lane terminators). */
  deletedBranches: string[];
}

export interface RevisionGraphEdgePoint {
  revision: number;
  rowIndex: number;
  laneId: string;
}

export interface RevisionGraphEdge {
  kind: 'parent' | 'branch' | 'merge';
  /** Older end of the edge. */
  from: RevisionGraphEdgePoint;
  /** Newer end of the edge. */
  to: RevisionGraphEdgePoint;
  /** Lane whose color the edge inherits. */
  laneId: string;
}

export interface RevisionGraphLane {
  /** Stable id for this branch incarnation (`branch` or `branch#2` after death). */
  id: string;
  /** Display name of the branch path. */
  branch: string;
  /** Render column; overflow lanes share `maxLanes`. */
  columnIndex: number;
  /** Palette index (creation order) — stable even when columns recycle. */
  colorIndex: number;
  color: string;
  bornRevision: number;
  firstRowIndex: number;
  lastRowIndex: number;
  revisionCount: number;
  deletedAtRevision: number | null;
  isOverflow: boolean;
}

export interface RevisionGraphStats {
  revisions: number;
  branches: number;
  copyPoints: number;
  merges: number;
  deletions: number;
}

export interface RevisionGraphModel {
  /** Render order: by column, then creation. */
  lanes: RevisionGraphLane[];
  /** Newest-first, `rowIndex === index`. */
  nodes: RevisionGraphNode[];
  edges: RevisionGraphEdge[];
  laneById: Map<string, RevisionGraphLane>;
  /** Branch path → lane ids, one per incarnation (oldest first). */
  laneIdsByBranch: Map<string, string[]>;
  /** Branches that ran out of lane columns and collapsed into the overflow lane. */
  overflowBranches: string[];
  /** Number of lane columns to render (max columnIndex + 1). */
  columnCount: number;
  stats: RevisionGraphStats;
}

/* ───────────────────────────── palette ───────────────────────────────────── */

/**
 * Branch palette. Anchored on the default accent (#58a6ff) so lane 0 — the
 * branch the log target lives on, usually trunk — matches the app accent; the
 * rest are hue-spaced and readable on both light and dark backgrounds. Kept in
 * the lib (not global.css) so the mapping lane → color stays pure and testable.
 */
export const BRANCH_COLORS = [
  '#58a6ff', // accent blue
  '#3fb950', // green
  '#d29922', // amber
  '#f85149', // red
  '#bc8cff', // violet
  '#39c5cf', // cyan
  '#ff7b72', // coral
  '#ffa657', // orange
] as const;

/** Deterministic lane color: palette slot by stable color index, wrapping. */
export function branchColorForIndex(colorIndex: number): string {
  return BRANCH_COLORS[colorIndex % BRANCH_COLORS.length] as string;
}

/* ───────────────────────────── building ──────────────────────────────────── */

export const DEFAULT_MAX_LANES = 16;

interface InternalLane {
  id: string;
  branch: string;
  columnIndex: number;
  colorIndex: number;
  isOverflow: boolean;
  bornRevision: number;
  revisions: number[];
  deletedAtRevision: number | null;
}

interface StagedNode {
  revision: number;
  laneId: string;
  laneIds: string[];
  branch: string;
  author: string;
  date: string;
  message: string;
  copyPoint?: RevisionGraphCopyPoint;
  merges: RevisionGraphMergeSource[];
  deletedBranches: string[];
  rowIndex: number;
}

interface PendingEdge {
  kind: 'parent' | 'branch' | 'merge';
  fromRevision: number;
  toRevision: number;
  fromLaneId?: string;
  toLaneId: string;
  fromBranch?: string;
}

interface EntryClassification {
  touchedBranches: string[];
  primaryBranch: string;
  copyPoint?: RevisionGraphCopyPoint;
  deletedBranches: string[];
  mergeSources: string[];
}

function classifyEntry(entry: SvnLogEntry): EntryClassification {
  const touched: string[] = [];
  const deleted: string[] = [];
  const copies: RevisionGraphCopyPoint[] = [];

  for (const change of entry.paths ?? []) {
    const branch = branchOfPath(change.path);
    if (!touched.includes(branch)) touched.push(branch);

    if (change.action === 'D' && isBranchRootChange(change) && branch !== MAIN_LANE_BRANCH) {
      if (!deleted.includes(branch)) deleted.push(branch);
    }

    if ((change.action === 'A' || change.action === 'R') && change.copyFromPath) {
      copies.push({
        path: normalizeRepoPath(change.path),
        branch,
        fromPath: normalizeRepoPath(change.copyFromPath),
        fromRev: change.copyFromRev ?? 0,
      });
    }
  }

  // A true branch creation copies *across* branches; prefer that over an
  // in-branch file copy when several copy operations share the revision.
  const copyPoint =
    copies.find((copy) => branchOfPath(copy.fromPath) !== copy.branch) ?? copies[0];

  const primaryBranch = copyPoint ? copyPoint.branch : (touched[0] ?? MAIN_LANE_BRANCH);
  const mergeSources = extractMergeSources(entry.message ?? '', entry.paths ?? [], primaryBranch);

  return { touchedBranches: touched, primaryBranch, copyPoint, deletedBranches: deleted, mergeSources };
}

export interface RevisionGraphBuildOptions {
  /** Lane column cap; extra branches collapse into a shared overflow column. */
  maxLanes?: number;
}

/**
 * Build the graph model from `svn log -v` entries, in any order.
 *
 * Lane rules:
 *  - One lane per branch *incarnation*. A branch deleted (root path `D`) and
 *    later re-created gets a fresh lane id (`branch#2`) — history before the
 *    deletion never merges with history after it.
 *  - Lane ids are stable across renders: they depend only on the log content.
 *  - Columns are recycled: when a lane dies its column returns to the pool, so
 *    long histories with many short-lived branches stay compact.
 *  - Beyond `maxLanes` columns, new branches share an overflow column.
 */
export function buildRevisionGraph(
  entries: readonly SvnLogEntry[],
  options: RevisionGraphBuildOptions = {}
): RevisionGraphModel {
  const maxLanes = Math.max(2, Math.floor(options.maxLanes ?? DEFAULT_MAX_LANES));

  const byRevision = new Map<number, SvnLogEntry>();
  for (const entry of entries) {
    if (Number.isFinite(entry.revision) && entry.revision > 0 && !byRevision.has(entry.revision)) {
      byRevision.set(entry.revision, entry);
    }
  }
  const ordered = [...byRevision.values()].toSorted((a, b) => a.revision - b.revision);

  const internalLanes: InternalLane[] = [];
  const activeByBranch = new Map<string, InternalLane>();
  const incarnationCount = new Map<string, number>();
  const pendingEdges: PendingEdge[] = [];
  const stagedNodes: StagedNode[] = [];
  const freeColumns: number[] = [];
  let nextColumn = 0;
  let colorCounter = 0;

  const acquireColumn = (): number =>
    freeColumns.length > 0 ? (freeColumns.shift() as number) : nextColumn++;

  const releaseColumn = (columnIndex: number): void => {
    if (columnIndex >= maxLanes) return; // overflow column, nothing to recycle
    const insertAt = freeColumns.findIndex((free) => free > columnIndex);
    if (insertAt === -1) freeColumns.push(columnIndex);
    else freeColumns.splice(insertAt, 0, columnIndex);
  };

  const ensureLane = (branch: string, revision: number): InternalLane => {
    const active = activeByBranch.get(branch);
    if (active) return active;
    const incarnation = (incarnationCount.get(branch) ?? 0) + 1;
    incarnationCount.set(branch, incarnation);
    const rawColumn = acquireColumn();
    const isOverflow = rawColumn >= maxLanes;
    const lane: InternalLane = {
      id: incarnation === 1 ? branch : `${branch}#${incarnation}`,
      branch,
      columnIndex: isOverflow ? maxLanes : rawColumn,
      colorIndex: colorCounter++,
      isOverflow,
      bornRevision: revision,
      revisions: [],
      deletedAtRevision: null,
    };
    internalLanes.push(lane);
    activeByBranch.set(branch, lane);
    return lane;
  };

  for (const entry of ordered) {
    const revision = entry.revision;
    const classification = classifyEntry(entry);
    const touchedLanes = classification.touchedBranches.map((branch) =>
      ensureLane(branch, revision)
    );
    const primaryLane = ensureLane(classification.primaryBranch, revision);
    const laneIds = touchedLanes.some((lane) => lane.id === primaryLane.id)
      ? touchedLanes.map((lane) => lane.id)
      : [primaryLane.id, ...touchedLanes.map((lane) => lane.id)];

    stagedNodes.push({
      revision,
      laneId: primaryLane.id,
      laneIds,
      branch: primaryLane.branch,
      author: entry.author ?? '',
      date: entry.date ?? '',
      message: entry.message ?? '',
      copyPoint: classification.copyPoint,
      merges: classification.mergeSources.map((branch) => ({ branch, kind: 'message' as const })),
      deletedBranches: classification.deletedBranches,
      rowIndex: 0, // assigned below
    });

    // Lane continuity: connect this revision to the lane's previous one.
    for (const lane of touchedLanes) {
      const previous = lane.revisions[lane.revisions.length - 1];
      if (previous !== undefined && previous !== revision) {
        pendingEdges.push({
          kind: 'parent',
          fromRevision: previous,
          toRevision: revision,
          toLaneId: lane.id,
          fromLaneId: lane.id,
        });
      }
      lane.revisions.push(revision);
    }
    if (!touchedLanes.includes(primaryLane)) primaryLane.revisions.push(revision);

    // Copy point: a diagonal edge back to the copy source (resolved later —
    // the source revision may sit outside the loaded window).
    if (classification.copyPoint && classification.copyPoint.fromRev > 0) {
      const sourceBranch = branchOfPath(classification.copyPoint.fromPath);
      const sourceLane = activeByBranch.get(sourceBranch);
      pendingEdges.push({
        kind: 'branch',
        fromRevision: classification.copyPoint.fromRev,
        toRevision: revision,
        fromLaneId: sourceLane?.id,
        toLaneId: primaryLane.id,
        fromBranch: sourceLane ? undefined : sourceBranch,
      });
    }

    // Merge annotations: dashed edges resolved once all nodes exist.
    for (const sourceBranch of classification.mergeSources) {
      pendingEdges.push({
        kind: 'merge',
        fromRevision: revision,
        toRevision: revision,
        toLaneId: primaryLane.id,
        fromBranch: sourceBranch,
      });
    }

    // Deletions terminate lanes and free their columns for reuse.
    for (const branch of classification.deletedBranches) {
      const lane = activeByBranch.get(branch);
      if (!lane) continue;
      lane.deletedAtRevision = revision;
      activeByBranch.delete(branch);
      releaseColumn(lane.columnIndex);
    }
  }

  // Row layout: newest first.
  const orderedNodes = stagedNodes.toSorted((a, b) => b.revision - a.revision);
  orderedNodes.forEach((node, index) => {
    node.rowIndex = index;
  });

  const nodeByRevision = new Map<number, StagedNode>(
    orderedNodes.map((node) => [node.revision, node])
  );

  const laneById = new Map<string, RevisionGraphLane>();
  const laneIdsByBranch = new Map<string, string[]>();
  const overflowBranches: string[] = [];
  let columnCount = 0;

  const lanes: RevisionGraphLane[] = internalLanes.map((lane) => {
    const rowIndexes = lane.revisions
      .map((revision) => nodeByRevision.get(revision)?.rowIndex)
      .filter((rowIndex): rowIndex is number => rowIndex !== undefined);
    const firstRowIndex = rowIndexes.length > 0 ? Math.min(...rowIndexes) : 0;
    const lastRowIndex = rowIndexes.length > 0 ? Math.max(...rowIndexes) : 0;
    if (lane.isOverflow && !overflowBranches.includes(lane.branch)) {
      overflowBranches.push(lane.branch);
    }
    columnCount = Math.max(columnCount, lane.columnIndex + 1);
    const publicLane: RevisionGraphLane = {
      id: lane.id,
      branch: lane.branch,
      columnIndex: lane.columnIndex,
      colorIndex: lane.colorIndex,
      color: branchColorForIndex(lane.colorIndex),
      bornRevision: lane.bornRevision,
      firstRowIndex,
      lastRowIndex,
      revisionCount: lane.revisions.length,
      deletedAtRevision: lane.deletedAtRevision,
      isOverflow: lane.isOverflow,
    };
    laneById.set(publicLane.id, publicLane);
    const ids = laneIdsByBranch.get(lane.branch) ?? [];
    ids.push(lane.id);
    laneIdsByBranch.set(lane.branch, ids);
    return publicLane;
  });

  const pointFor = (
    revision: number,
    laneId: string | undefined
  ): RevisionGraphEdgePoint | null => {
    const staged = nodeByRevision.get(revision);
    if (staged) return { revision, rowIndex: staged.rowIndex, laneId: laneId ?? staged.laneId };
    // Revision outside the loaded window (common for copy sources): anchor to
    // the closest revision on the source lane at or below the wanted one, or —
    // when the window starts after it — the lane's oldest loaded revision, so
    // the diagonal still says "came from this lane, earlier than shown".
    if (!laneId) return null;
    const lane = internalLanes.find((candidate) => candidate.id === laneId);
    if (!lane || lane.revisions.length === 0) return null;
    let best: number | null = null;
    let oldest: number | null = null;
    for (const candidate of lane.revisions) {
      if (oldest === null || candidate < oldest) oldest = candidate;
      if (candidate <= revision && (best === null || candidate > best)) best = candidate;
    }
    const anchor = best ?? oldest;
    if (anchor === null) return null;
    const bestNode = nodeByRevision.get(anchor);
    return bestNode ? { revision: anchor, rowIndex: bestNode.rowIndex, laneId } : null;
  };

  const edgeKindOrder: Record<PendingEdge['kind'], number> = { parent: 0, branch: 1, merge: 2 };
  const seenEdgeKeys = new Set<string>();
  const edges: RevisionGraphEdge[] = [];

  for (const pending of pendingEdges) {
    let fromLaneId = pending.fromLaneId;
    let fromRevision = pending.fromRevision;

    if (pending.kind === 'merge') {
      // Newest revision on the referenced branch strictly below the merge.
      const candidates = internalLanes.filter((lane) => lane.branch === pending.fromBranch);
      let bestRevision: number | null = null;
      let bestLane: InternalLane | null = null;
      for (const lane of candidates) {
        for (const candidate of lane.revisions) {
          if (candidate < pending.toRevision && (bestRevision === null || candidate > bestRevision)) {
            bestRevision = candidate;
            bestLane = lane;
          }
        }
      }
      if (bestRevision === null || !bestLane) continue;
      fromRevision = bestRevision;
      fromLaneId = bestLane.id;
    }

    const toStaged = nodeByRevision.get(pending.toRevision);
    if (!toStaged) continue;
    const fromPoint = pointFor(fromRevision, fromLaneId);
    if (!fromPoint || fromPoint.revision === pending.toRevision) continue;

    const key = `${pending.kind}:${fromPoint.revision}:${pending.toRevision}:${pending.toLaneId}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);

    edges.push({
      kind: pending.kind,
      from: fromPoint,
      to: { revision: pending.toRevision, rowIndex: toStaged.rowIndex, laneId: pending.toLaneId },
      laneId: pending.kind === 'parent' ? (fromLaneId ?? pending.toLaneId) : pending.toLaneId,
    });
  }

  const sortedEdges = edges.toSorted((a, b) => {
    if (a.to.rowIndex !== b.to.rowIndex) return a.to.rowIndex - b.to.rowIndex;
    if (a.from.rowIndex !== b.from.rowIndex) return a.from.rowIndex - b.from.rowIndex;
    return edgeKindOrder[a.kind] - edgeKindOrder[b.kind];
  });

  const nodes: RevisionGraphNode[] = orderedNodes.map((node, index) => ({
    revision: node.revision,
    rowIndex: node.rowIndex,
    laneId: node.laneId,
    laneIds: node.laneIds,
    branch: node.branch,
    author: node.author,
    date: node.date,
    message: node.message,
    isHead: index === 0,
    isTail: index === orderedNodes.length - 1,
    ...(node.copyPoint && { copyPoint: node.copyPoint }),
    merges: node.merges,
    deletedBranches: node.deletedBranches,
  }));

  const sortedLanes = lanes.toSorted((a, b) => {
    if (a.columnIndex !== b.columnIndex) return a.columnIndex - b.columnIndex;
    return a.colorIndex - b.colorIndex;
  });

  return {
    lanes: sortedLanes,
    nodes,
    edges: sortedEdges,
    laneById,
    laneIdsByBranch,
    overflowBranches,
    columnCount,
    stats: {
      revisions: nodes.length,
      branches: laneIdsByBranch.size,
      copyPoints: nodes.filter((node) => node.copyPoint).length,
      merges: nodes.filter((node) => node.merges.length > 0).length,
      deletions: lanes.filter((lane) => lane.deletedAtRevision !== null).length,
    },
  };
}

/* ───────────────────────────── geometry ──────────────────────────────────── */

export const DEFAULT_ROW_HEIGHT = 26;
export const DEFAULT_LANE_WIDTH = 14;
export const COMPACT_ROW_HEIGHT = 20;
export const COMPACT_LANE_WIDTH = 10;

/** X center of a lane column. */
export function laneCenterX(columnIndex: number, laneWidth = DEFAULT_LANE_WIDTH): number {
  return columnIndex * laneWidth + laneWidth / 2;
}

/** Y center of a revision row. */
export function revisionY(rowIndex: number, rowHeight = DEFAULT_ROW_HEIGHT): number {
  return rowIndex * rowHeight + rowHeight / 2;
}

/** Width of the lane area (before any label gutter). */
export function graphWidth(columnCount: number, laneWidth = DEFAULT_LANE_WIDTH): number {
  return columnCount * laneWidth;
}

/** Full height of the revision rows. */
export function graphHeight(rowCount: number, rowHeight = DEFAULT_ROW_HEIGHT): number {
  return rowCount * rowHeight;
}

/**
 * Vertical-diagonal connector between two lane points. Exit/entry stay
 * vertical so branch and merge edges read as clean diagonals regardless of the
 * row distance they span.
 */
export function laneConnectorPath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}

/* ───────────────────────────── windowing ─────────────────────────────────── */

export interface RevisionGraphWindow {
  /** First visible row (0 = newest). */
  offset: number;
  /** Number of visible rows. */
  count: number;
}

/**
 * Slice the model to a visible revision window for virtualized rendering.
 * Edges get one row of grace on each side so diagonals crossing the window
 * boundary still draw; edges anchored entirely outside are dropped.
 */
export function windowRevisionGraph(
  model: RevisionGraphModel,
  window: RevisionGraphWindow
): { nodes: RevisionGraphNode[]; edges: RevisionGraphEdge[] } {
  const offset = Math.max(0, Math.floor(window.offset));
  const count = Math.max(0, Math.floor(window.count));
  const lo = offset - 1;
  const hi = offset + count;
  const nodes = model.nodes.filter(
    (node) => node.rowIndex >= offset && node.rowIndex < offset + count
  );
  const edges = model.edges.filter(
    (edge) =>
      edge.from.rowIndex >= lo &&
      edge.from.rowIndex <= hi &&
      edge.to.rowIndex >= lo &&
      edge.to.rowIndex <= hi
  );
  return { nodes, edges };
}
