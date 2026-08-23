/**
 * The repository browser's remote write operations (#68, #69): `svn mkdir`,
 * `svn delete`, `svn move` and `svn copy` run against repository **URLs**, so
 * each one commits immediately — there is no working-copy staging step and no
 * undo beyond a reverse operation.
 *
 * The layer is split the way the feature's adapters are:
 *
 * - **Pure planners** (`buildRemoteOpCommands`, `computeAffectedCounts`,
 *   `canDropRepoPaths`, `defaultLogMessage`) build the `svn` command lines the
 *   dialogs print and the affected-path summaries they confirm against. They
 *   know nothing about Electron, so they are testable without a repository.
 * - **A thin adapter** (`executeRemoteOp`) maps a plan onto the four IPC
 *   channels the preload already exposes — `svn:remoteCreateFolder`,
 *   `svn:remoteDelete`, `svn:remoteMove`, `svn:copy` — one item at a time,
 *   stopping at the first failure so a half-completed batch is reported
 *   honestly rather than retried blindly.
 */

import type { RepoEntry } from '../types';

export type RemoteOpKind = 'mkdir' | 'delete' | 'move' | 'copy';

/** What one planned write does, in a shape the dialog and the adapter share. */
export interface RemoteOpPlan {
  kind: RemoteOpKind;
  items: RemoteOpItem[];
  /**
   * Destination **directory** URL for move/copy (items keep their names), or
   * the parent URL for mkdir. Absent for delete.
   */
  destinationUrl?: string;
  /** Folder to create inside `destinationUrl`. Only for mkdir. */
  folderName?: string;
  /** Log message; every remote write is a commit and needs one. */
  message: string;
}

/** The minimum a plan needs to know about each item it touches. */
export interface RemoteOpItem {
  /** Repository-relative path, no leading slash. */
  path: string;
  name: string;
  url: string;
  kind: 'file' | 'dir';
}

/** Outcome of one adapter call; matches the IPC channels' result shape. */
export interface RemoteOpCallResult {
  success: boolean;
  error?: string;
}

export interface RemoteOpExecution {
  success: boolean;
  /** How many items completed before the failure (or all of them). */
  completed: number;
  error?: string;
}

/** The four IPC-backed write operations, as one interface for injection. */
export interface RemoteOpsAdapter {
  remoteCreateFolder(
    parentUrl: string,
    folderName: string,
    message: string
  ): Promise<RemoteOpCallResult>;
  remoteDelete(url: string, message: string): Promise<RemoteOpCallResult>;
  remoteMove(srcUrl: string, dstUrl: string, message: string): Promise<RemoteOpCallResult>;
  copy(srcUrl: string, dstUrl: string, message: string): Promise<RemoteOpCallResult>;
}

/** Adapter over the real preload bridge. Kept lazy so tests never need it. */
export const svnRemoteOpsAdapter: RemoteOpsAdapter = {
  remoteCreateFolder: (parentUrl, folderName, message) =>
    window.api.svn.remoteCreateFolder(parentUrl, folderName, message),
  remoteDelete: (url, message) => window.api.svn.remoteDelete(url, message),
  remoteMove: (srcUrl, dstUrl, message) => window.api.svn.remoteMove(srcUrl, dstUrl, message),
  copy: (srcUrl, dstUrl, message) => window.api.svn.copy(srcUrl, dstUrl, message),
};

/** Entry → plan item; the dialog never needs status or presence facts. */
export function toRemoteOpItem(entry: RepoEntry): RemoteOpItem {
  return { path: entry.path, name: entry.name, url: entry.url, kind: entry.kind };
}

/** Join a destination directory URL with an item name. */
export function destinationChildUrl(destinationUrl: string, name: string): string {
  const base = destinationUrl.replace(/\/+$/, '');
  return `${base}/${name}`;
}

/**
 * The `svn` command lines a plan will run — verbatim, one per IPC call, in
 * execution order. The dialogs print these so what is confirmed is what runs
 * (the same rule `repoBrowserMenu` holds its items to).
 */
export function buildRemoteOpCommands(plan: RemoteOpPlan): string[] {
  const message = `-m "${plan.message.replace(/"/g, '\\"')}"`;
  switch (plan.kind) {
    case 'mkdir':
      return [
        `svn mkdir "${destinationChildUrl(plan.destinationUrl ?? '', plan.folderName ?? '')}" ${message}`,
      ];
    case 'delete':
      return plan.items.map((item) => `svn delete "${item.url}" ${message}`);
    case 'move':
      return plan.items.map(
        (item) =>
          `svn move "${item.url}" "${destinationChildUrl(plan.destinationUrl ?? '', item.name)}" ${message}`
      );
    case 'copy':
      return plan.items.map(
        (item) =>
          `svn copy "${item.url}" "${destinationChildUrl(plan.destinationUrl ?? '', item.name)}" ${message}`
      );
    default:
      return [];
  }
}

/**
 * Default log message for a plan. Server-side writes become history the whole
 * team reads, so the message names what moved where even when the user does
 * not edit it.
 */
export function defaultLogMessage(
  kind: RemoteOpKind,
  items: readonly RemoteOpItem[],
  destinationPath?: string
): string {
  const first = items[0];
  const count = items.length;
  const destination = destinationPath ? ` to ^/${destinationPath.replace(/^\/+/, '')}` : '';
  switch (kind) {
    case 'mkdir':
      return `Create folder ${first?.name ?? ''}`;
    case 'delete':
      return count === 1 ? `Delete ^/${first?.path ?? ''}` : `Delete ${count} paths`;
    case 'move':
      return count === 1
        ? `Move ^/${first?.path ?? ''}${destination}`
        : `Move ${count} paths${destination}`;
    case 'copy':
      return count === 1
        ? `Copy ^/${first?.path ?? ''}${destination}`
        : `Copy ${count} paths${destination}`;
    default:
      return '';
  }
}

/* ───────────────────────────── affected-path counts ─────────────────────── */

/**
 * How many repository paths an operation touches.
 *
 * A move or delete of a directory takes every path beneath it, so the count a
 * confirmation dialog shows is `1 + descendants` per directory item. Those
 * descendants come from the tree data the browser has already loaded — which
 * is usually most of the affected subtree but never guaranteed to be all of
 * it, so directories whose children were never listed are counted separately
 * and the summary says "at least".
 */
export interface AffectedCounts {
  /** Items the operation names directly. */
  direct: number;
  /** Descendants found in already-loaded tree data. */
  knownDescendants: number;
  /** Directory items whose subtree was never loaded — the count is a floor. */
  unloadedDirs: number;
}

export interface LoadedTreeIndex {
  /** Children keyed by repository-relative parent path; `undefined` = never listed. */
  childrenByPath?: Readonly<Record<string, readonly RepoEntry[] | undefined>>;
  /** Server-side child counts, when a `svn list` reported them. */
  childCountByPath?: Readonly<Record<string, number | undefined>>;
}

/** Recursively count descendants of one path from loaded data. */
function countDescendants(
  path: string,
  { childrenByPath = {}, childCountByPath = {} }: LoadedTreeIndex,
  seen: Set<string>
): { known: number; unloaded: number } {
  const children = childrenByPath[path];
  if (children === undefined) {
    // Never listed. If the server has said this directory holds children, the
    // caller cannot claim a complete count for it.
    const declared = childCountByPath[path];
    return { known: 0, unloaded: declared === undefined || declared > 0 ? 1 : 0 };
  }

  let known = 0;
  let unloaded = 0;
  for (const child of children) {
    if (seen.has(child.path)) continue; // defensive: cycles cannot exist in svn, but a corrupt cache could fake one
    seen.add(child.path);
    known += 1;
    if (child.kind === 'dir') {
      const below = countDescendants(child.path, { childrenByPath, childCountByPath }, seen);
      known += below.known;
      unloaded += below.unloaded;
    }
  }
  return { known, unloaded };
}

export function computeAffectedCounts(
  items: readonly RemoteOpItem[],
  loaded: LoadedTreeIndex = {}
): AffectedCounts {
  const seen = new Set<string>(items.map((item) => item.path));
  let knownDescendants = 0;
  let unloadedDirs = 0;
  for (const item of items) {
    if (item.kind !== 'dir') continue;
    const below = countDescendants(item.path, loaded, seen);
    knownDescendants += below.known;
    unloadedDirs += below.unloaded;
  }
  return { direct: items.length, knownDescendants, unloadedDirs };
}

/** "3 items — 47 paths affected", or "at least 12 paths affected (2 folders not yet listed)". */
export function formatAffectedSummary(counts: AffectedCounts): string {
  const itemWord = counts.direct === 1 ? 'item' : 'items';
  const affected = counts.direct + counts.knownDescendants;
  const pathWord = affected === 1 ? 'path' : 'paths';
  if (counts.unloadedDirs > 0) {
    return `at least ${affected.toLocaleString()} ${pathWord} affected (${counts.unloadedDirs.toLocaleString()} ${counts.unloadedDirs === 1 ? 'folder' : 'folders'} not yet listed)`;
  }
  return `${counts.direct.toLocaleString()} ${itemWord} — ${affected.toLocaleString()} ${pathWord} affected`;
}

/**
 * The text a destructive confirmation asks the user to type: the name of every
 * **top-level** node being deleted (a path with no `/`), comma-joined. Deep
 * paths are cheap to undo relative to losing `trunk` itself, so only
 * repository-root children require the typed form.
 */
export function typedConfirmationFor(items: readonly RemoteOpItem[]): string | null {
  const topLevel = items.filter((item) => !item.path.includes('/')).map((item) => item.name);
  if (topLevel.length === 0) return null;
  return topLevel.join(', ');
}

/* ───────────────────────────────── drop validation ──────────────────────── */

/** Parent of a repository-relative path, or '' at the root. */
export function parentOfRepoPath(path: string): string {
  if (!path) return '';
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** Whether `candidate` is `ancestor` itself or lives beneath it. */
function isWithin(ancestor: string, candidate: string): boolean {
  if (ancestor === '') return true;
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
}

/**
 * May `sources` (repository-relative paths) be dropped on the directory
 * `targetPath`?
 *
 * Refuses the three drops Subversion would reject or silently no-op: the
 * repository root (it contains every destination), onto a source itself or
 * into a source's own subtree (a cycle), and into the parent the item is
 * already in (the destination would collide with the source — true for copy as
 * well as move).
 */
export function canDropRepoPaths(sources: readonly string[], targetPath: string): boolean {
  if (sources.length === 0) return false;
  for (const source of sources) {
    // The repository root contains every possible destination.
    if (source === '') return false;
    // Includes `source === targetPath`; also covers dragging a folder into
    // its own subtree, which is a cycle.
    if (isWithin(source, targetPath)) return false;
    // Dropping into the directory the item already lives in would create a
    // destination identical to the source.
    if (parentOfRepoPath(source) === targetPath) return false;
  }
  return true;
}

/* ────────────────────────────────── execution ───────────────────────────── */

/**
 * Run a plan through the adapter, one item at a time and in order, stopping at
 * the first failure. Sequential on purpose: these are commits, and firing five
 * moves in parallel after the second one failed is how a half-applied
 * restructuring becomes an unauditable one.
 */
export async function executeRemoteOp(
  plan: RemoteOpPlan,
  adapter: RemoteOpsAdapter = svnRemoteOpsAdapter
): Promise<RemoteOpExecution> {
  const calls = planToCalls(plan, adapter);
  let completed = 0;
  for (const call of calls) {
    let result: RemoteOpCallResult;
    try {
      result = await call();
    } catch (error) {
      return {
        success: false,
        completed,
        error: (error as Error)?.message ?? String(error),
      };
    }
    if (!result.success) {
      return { success: false, completed, error: result.error ?? 'Subversion refused the operation' };
    }
    completed += 1;
  }
  return { success: true, completed };
}

/** Expand a plan into the ordered list of adapter invocations it implies. */
export function planToCalls(
  plan: RemoteOpPlan,
  adapter: RemoteOpsAdapter
): Array<() => Promise<RemoteOpCallResult>> {
  switch (plan.kind) {
    case 'mkdir':
      return [
        () =>
          adapter.remoteCreateFolder(
            plan.destinationUrl ?? '',
            plan.folderName ?? '',
            plan.message
          ),
      ];
    case 'delete':
      return plan.items.map((item) => () => adapter.remoteDelete(item.url, plan.message));
    case 'move':
      return plan.items.map((item) => () =>
        adapter.remoteMove(
          item.url,
          destinationChildUrl(plan.destinationUrl ?? '', item.name),
          plan.message
        )
      );
    case 'copy':
      return plan.items.map((item) => () =>
        adapter.copy(
          item.url,
          destinationChildUrl(plan.destinationUrl ?? '', item.name),
          plan.message
        )
      );
    default:
      return [];
  }
}
