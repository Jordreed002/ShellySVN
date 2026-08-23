import type { FsStatusResult, SvnChildCommitInfo, SvnStatusResult } from '@shared/types';

/**
 * Working-copy freshness facts derived from data the app has already read.
 *
 * Two questions live here:
 *
 * 1. **Is the working copy mixed-revision?** Subversion keeps a per-node BASE
 *    revision, and a partial update leaves some nodes newer than others. The
 *    renderer never sees those BASE revisions directly — but it does see, for
 *    every item the Files surface already listed, a recorded revision (the
 *    item's last-changed revision, or its BASE revision when no commit is
 *    reported). An item's last-changed revision can never exceed its own BASE
 *    revision, so *any* item recorded above the folder's BASE revision proves
 *    the tree is mixed. The converse is not true: a node updated to a revision
 *    nothing touched recently still reports its old last-changed revision, so
 *    this derivation is sound but not complete. It costs nothing — it only
 *    re-reads lists already on screen — which is why the banner prefers it to
 *    a network round trip.
 *
 * 2. **Is a commit about to race the repository?** `svn status
 *    --show-updates` (the `svn:statusRemote` IPC) reports, per path, both the
 *    working copy's revision and the repository's newer one. That result is
 *    turned into the concrete incoming-changes list the commit dialog blocks
 *    on.
 */

/** One working-copy node with whatever revision its status/info read reported. */
export interface FreshnessItem {
  path: string;
  revision?: number;
}

/** A working copy proven to have nodes at more than one revision. */
export interface MixedRevisionSummary {
  /** The anchor: the BASE revision of the folder the facts were read for. */
  baseRevision: number;
  /** The newest revision any item reports. */
  maxRevision: number;
  /** How many distinct items sit strictly above the anchor revision. */
  itemCount: number;
  /** Those items' paths, sorted. */
  items: string[];
  /** Stable identity of this mixed state, used to remember dismissal. */
  signature: string;
}

const PATH_SEPARATOR_NORMALIZER = /\\/g;

/** Normalize a path for comparison: forward slashes, no trailing separator. */
export function normalizeComparablePath(path: string): string {
  const normalized = path.replace(PATH_SEPARATOR_NORMALIZER, '/');
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

const WINDOWS_DRIVE = /^[a-zA-Z]:\//;

/**
 * Collate the revision facts the Files surface already holds into the flat
 * item list the mixed-revision derivation consumes.
 *
 * `deepStatusData` (`svn status --depth infinity`, offline) covers every
 * changed node in the tree; `childCommits` (`svn info --depth immediates`,
 * offline) covers every immediate child whether changed or not. Both report
 * last-changed revisions, which is exactly what the sound "newer than the
 * folder" rule needs. Duplicate paths are collapsed — deep status wins, since
 * its paths are already absolute.
 */
export function buildMixedRevisionItems({
  deepStatusData,
  childCommits,
  directoryPath,
}: {
  deepStatusData?: FsStatusResult | null;
  childCommits?: Record<string, SvnChildCommitInfo> | null;
  directoryPath?: string | null;
}): FreshnessItem[] {
  const byPath = new Map<string, FreshnessItem>();

  for (const entry of deepStatusData?.allEntries ?? []) {
    if (!entry.fullPath) continue;
    byPath.set(normalizeComparablePath(entry.fullPath), {
      path: entry.fullPath,
      revision: entry.revision,
    });
  }

  for (const [name, info] of Object.entries(childCommits ?? {})) {
    if (!name) continue;
    const childPath = directoryPath
      ? `${directoryPath.replace(PATH_SEPARATOR_NORMALIZER, '/').replace(/\/+$/, '')}/${name}`
      : name;
    const key = normalizeComparablePath(childPath);
    if (!byPath.has(key)) {
      byPath.set(key, { path: childPath, revision: info.revision });
    }
  }

  return Array.from(byPath.values());
}

/**
 * Derive the mixed-revision state, if any, from already-fetched facts.
 *
 * Returns `null` unless the evidence is conclusive: an anchor revision is
 * required (without one, differing last-changed revisions are normal and say
 * nothing), and at least one item must sit strictly above it.
 */
export function deriveMixedRevisions({
  baseRevision,
  items,
}: {
  baseRevision?: number;
  items: readonly FreshnessItem[];
}): MixedRevisionSummary | null {
  if (typeof baseRevision !== 'number' || !Number.isFinite(baseRevision) || baseRevision <= 0) {
    return null;
  }

  const newer = new Map<string, FreshnessItem>();
  for (const item of items) {
    // 0 and undefined mean "no revision reported" (added items, excluded
    // children) — they are absence of evidence, not revision zero.
    if (typeof item.revision !== 'number' || !Number.isFinite(item.revision)) continue;
    if (item.revision <= baseRevision) continue;
    if (!item.path) continue;
    const key = normalizeComparablePath(item.path);
    const existing = newer.get(key);
    if (!existing || item.revision > (existing.revision ?? 0)) {
      newer.set(key, item);
    }
  }

  if (newer.size === 0) return null;

  const maxRevision = Math.max(...Array.from(newer.values(), (item) => item.revision ?? 0));
  const paths = Array.from(newer.values(), (item) => item.path).toSorted();
  return {
    baseRevision,
    maxRevision,
    itemCount: paths.length,
    items: paths,
    signature: `${baseRevision}:${maxRevision}:${paths.length}`,
  };
}

/** `r3…r7 · 4 items` — one form, used by both the banner and the status bar. */
export function describeMixedRevisions(summary: MixedRevisionSummary): string {
  return `r${summary.baseRevision}…r${summary.maxRevision} · ${summary.itemCount} ${
    summary.itemCount === 1 ? 'item' : 'items'
  }`;
}

/** One repository-side change that has not been merged into the working copy. */
export interface IncomingChange {
  /** Path relative to the working copy, when it could be relativized. */
  path: string;
  /** The working copy's revision of the item, when Subversion reported one. */
  baseRevision?: number;
  /** The repository's revision of the item (what an update would bring). */
  headRevision?: number;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_DRIVE.test(path);
}

function relativeToRoot(path: string, root: string): string {
  const comparablePath = normalizeComparablePath(path);
  const comparableRoot = normalizeComparablePath(root);
  if (comparableRoot && comparablePath === comparableRoot) return '.';
  if (comparableRoot && comparablePath.startsWith(`${comparableRoot}/`)) {
    return comparablePath.slice(comparableRoot.length + 1);
  }
  return path;
}

/**
 * Whether `ancestor` is a directory prefix of `descendant` (or equal, when
 * `allowEqual`). Commits propagate both ways across this relation: updating a
 * parent directory affects the files inside it, and committing a directory
 * commits its children.
 */
function pathCovers(ancestor: string, descendant: string): boolean {
  const a = normalizeComparablePath(ancestor);
  const d = normalizeComparablePath(descendant);
  if (!a || !d) return false;
  return a === d || d.startsWith(`${a}/`);
}

/**
 * Extract the incoming changes a `svn status --show-updates` result reports
 * (`repos-status` is present only for out-of-date items) and keep only those
 * that can affect the paths about to be committed: the path itself, an
 * ancestor of it, or something inside it.
 */
export function resolveIncomingChanges(
  status: SvnStatusResult,
  {
    workingCopyPath,
    selectedPaths,
  }: {
    workingCopyPath: string;
    selectedPaths: readonly string[];
  }
): IncomingChange[] {
  if (!Array.isArray(status.entries)) return [];

  const incoming: IncomingChange[] = [];
  for (const entry of status.entries) {
    if (
      entry.remoteStatus === undefined &&
      entry.remotePropsStatus === undefined &&
      entry.remoteRevision === undefined
    ) {
      continue;
    }
    if (!entry.path) continue;
    // `svn status` names the target directory itself "." — that entry stands
    // for the whole working copy path and affects every commit inside it.
    const relativePath = entry.path === '.' ? '' : entry.path;
    const absolutePath = isAbsolutePath(relativePath)
      ? relativePath
      : `${workingCopyPath.replace(PATH_SEPARATOR_NORMALIZER, '/').replace(/\/+$/, '')}${
          relativePath ? `/${relativePath}` : ''
        }`;

    const affectsCommit = selectedPaths.some(
      (selected) => pathCovers(absolutePath, selected) || pathCovers(selected, absolutePath)
    );
    if (!affectsCommit) continue;

    incoming.push({
      path: relativeToRoot(absolutePath, workingCopyPath),
      baseRevision: entry.revision,
      headRevision: entry.remoteRevision,
    });
  }

  return incoming.toSorted((a, b) => a.path.localeCompare(b.path));
}
