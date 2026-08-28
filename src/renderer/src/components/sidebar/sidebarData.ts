import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SvnShelveListResult, SvnStatusChar, SvnStatusResult } from '@shared/types';
// Read-only imports: the rail derives its local facts with the same pure
// functions the repository browser uses, so the two never disagree.
import { deriveProblems } from '@renderer/features/repo-browser/problemDerivation';
import type {
  LocalPresence,
  ProblemKind,
  RepoProblem,
} from '@renderer/features/repo-browser/types';
import { readCachedInfo, readCachedStatus } from '@renderer/utils/cachedSvnRead';

const PINNED_KEY = 'shellysvn:pinned-repos';

/** Split a repository path into its display name and parent directory. */
export function describeRepo(repoPath: string) {
  const parts = repoPath.split(/[/\\]/).filter(Boolean);
  const name = parts[parts.length - 1] || repoPath;
  const parent = parts.slice(0, -1).join('/');
  return { name, parent };
}

/**
 * Shorten a path to its last `segments` parts, prefixed with an ellipsis when
 * anything was dropped. Paths in the rail must lose their *head*, not their
 * tail — the leaf is the part that identifies the location.
 */
export function shortenPath(path: string, segments = 2): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join('/')}`;
}

/**
 * How much of a working copy is on disk, plus the "not resolved yet" state.
 *
 * **'sparse' is never produced today.** `SvnInfoResult`
 * (`packages/shared/src/types.ts`) carries no `depth`, so a sparse checkout is
 * indistinguishable from a full one without a main-process change. The rail and
 * the disk card already render 'sparse' correctly for the day that lands.
 */
export type SidebarPresence = LocalPresence | 'unknown';

/** Accessible label for a local-presence dot. Never rely on the colour alone. */
export const PRESENCE_LABEL: Record<SidebarPresence, string> = {
  full: 'Checked out',
  sparse: 'Sparse checkout',
  none: 'Not checked out',
  unknown: 'Checking local state',
};

/** Status chars that do NOT represent a pending local change. */
const NON_CHANGE: ReadonlySet<SvnStatusChar> = new Set([' ', '?', 'I', 'X'] as SvnStatusChar[]);

/* ── problems ────────────────────────────────────────────────────────────── */

/**
 * Rail wording per problem kind, with Subversion's status letter where one
 * exists — the house rule is to show the word and the code together.
 *
 * The letter is bracketed because this is a prose sub-line, not a pill: bare
 * `1 conflicted C` reads as a sentence that got cut off, where `1 conflicted (C)`
 * reads as the code it is.
 */
const PROBLEM_WORD: Record<ProblemKind, { one: string; many: string }> = {
  'text-conflict': { one: 'conflicted (C)', many: 'conflicted (C)' },
  'tree-conflict': { one: 'tree conflict (C)', many: 'tree conflicts (C)' },
  missing: { one: 'missing (!)', many: 'missing (!)' },
  'needs-cleanup': { one: 'needs cleanup', many: 'need cleanup' },
  'stale-lock': { one: 'stale lock', many: 'stale locks' },
  'floating-external': { one: 'floating external', many: 'floating externals' },
  'out-of-date': { one: 'revision behind', many: 'revisions behind' },
};

/** Worst-first, so the sub-line leads with what blocks a commit. */
const PROBLEM_ORDER: ProblemKind[] = [
  'text-conflict',
  'tree-conflict',
  'missing',
  'needs-cleanup',
  'stale-lock',
  'floating-external',
  'out-of-date',
];

export interface WorkingCopyProblems {
  /** How many problems this working copy's `svn status` revealed. */
  total: number;
  /** Of those, how many stop a commit outright. */
  blocking: number;
  /** Mono sub-line, e.g. `2 conflicted C · 1 stale lock`. */
  summary: string;
}

/** Collapse a problem list into the counts and the one-line summary the rail shows. */
export function summarizeProblems(problems: readonly RepoProblem[]): WorkingCopyProblems {
  const byKind = new Map<ProblemKind, number>();
  let blocking = 0;
  for (const problem of problems) {
    byKind.set(problem.kind, (byKind.get(problem.kind) ?? 0) + 1);
    if (problem.severity === 'blocking') blocking += 1;
  }
  const summary = PROBLEM_ORDER.filter((kind) => byKind.has(kind))
    .map((kind) => {
      const count = byKind.get(kind) ?? 0;
      const word = PROBLEM_WORD[kind];
      return `${count} ${count === 1 ? word.one : word.many}`;
    })
    .join(' · ');
  return { total: problems.length, blocking, summary };
}

/**
 * Problems the rail can name from a working copy's status read alone.
 *
 * `deriveProblems` also reports floating externals and "N revisions behind",
 * but those need `svn propget svn:externals` and an `svn log` against the
 * server. The rail is mounted for the whole session, so it will not pay a
 * process (let alone a network round trip) per working copy for them: this
 * count is deliberately the `svn status` subset — conflicts, missing items and
 * stale locks — and the UI says so rather than implying it is the whole list.
 */
export function deriveStatusProblems(status: SvnStatusResult, path: string): WorkingCopyProblems {
  return summarizeProblems(deriveProblems({ status, externals: undefined, localPath: path }));
}

export interface RepoStatusCounts {
  changes: number;
  conflicts: number;
  /** Problems visible in this status read. Never a guess: see `deriveStatusProblems`. */
  problems: WorkingCopyProblems;
  source: 'network' | 'cache';
  cacheAge: number;
  /** Local entries retained so only checkouts with missing paths need a remote probe. */
  statusResult?: SvnStatusResult;
}

async function readRepoStatusCounts(path: string): Promise<RepoStatusCounts> {
  const cachedRead = await readCachedStatus(path);
  const result = cachedRead.data;
  let changes = 0;
  let conflicts = 0;
  for (const entry of result.entries) {
    if (entry.status === 'C') {
      conflicts += 1;
      changes += 1;
    } else if (!NON_CHANGE.has(entry.status)) {
      changes += 1;
    }
  }
  return {
    changes,
    conflicts,
    problems: deriveStatusProblems(result, path),
    source: cachedRead.source,
    cacheAge: cachedRead.age,
    statusResult: result,
  };
}

export interface WorkingCopyInfo {
  url: string;
  /** `svn info` repository root URL — the server this checkout belongs to. */
  repositoryRoot: string;
  revision: number;
  branch: string;
  branchKind: 'trunk' | 'branch' | 'tag' | 'other';
  source: 'network' | 'cache';
  cacheAge: number;
}

/** Derive a friendly branch label from an SVN URL using standard layout conventions. */
export function deriveBranch(url: string): {
  branch: string;
  branchKind: WorkingCopyInfo['branchKind'];
} {
  if (/\/trunk(\/|$)/i.test(url)) return { branch: 'trunk', branchKind: 'trunk' };
  const branch = url.match(/\/branches\/([^/]+)/i);
  if (branch) return { branch: branch[1], branchKind: 'branch' };
  const tag = url.match(/\/tags\/([^/]+)/i);
  if (tag) return { branch: tag[1], branchKind: 'tag' };
  const last = url.split('/').filter(Boolean).pop();
  return { branch: last || 'working copy', branchKind: 'other' };
}

async function readWorkingCopyInfo(path: string): Promise<WorkingCopyInfo> {
  const cachedRead = await readCachedInfo(path);
  const info = cachedRead.data;
  const { branch, branchKind } = deriveBranch(info.url);
  return {
    url: info.url,
    repositoryRoot: info.repositoryRoot,
    revision: info.revision,
    branch,
    branchKind,
    source: cachedRead.source,
    cacheAge: cachedRead.age,
  };
}

/** `svn info` for the active working copy root (branch/URL + revision). */
export function useWorkingCopyInfo(path: string | undefined) {
  return useQuery<WorkingCopyInfo>({
    queryKey: ['sidebar:info', path],
    queryFn: () => readWorkingCopyInfo(path as string),
    enabled: Boolean(path),
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

/** Everything one rail row needs to describe a working copy. */
export interface WorkingCopySummary {
  presence: SidebarPresence;
  status?: RepoStatusCounts;
  info?: WorkingCopyInfo;
}

const EMPTY_OVERVIEW: ReadonlyMap<string, WorkingCopySummary> = new Map();

/** Replace local-only problem counts with remote-aware counts as probes resolve. */
export function reconcileOverviewProblems(
  paths: string[],
  overview: ReadonlyMap<string, WorkingCopySummary>,
  remoteStatuses: Array<SvnStatusResult | undefined>
): ReadonlyMap<string, WorkingCopySummary> {
  let reconciled: Map<string, WorkingCopySummary> | undefined;
  for (let index = 0; index < paths.length; index += 1) {
    const remote = remoteStatuses[index];
    const summary = overview.get(paths[index]);
    if (!remote || remote.error || !summary?.status) continue;
    reconciled ??= new Map(overview);
    reconciled.set(paths[index], {
      ...summary,
      status: {
        ...summary.status,
        problems: deriveStatusProblems(remote, paths[index]),
      },
    });
  }
  return reconciled ?? overview;
}

/**
 * Status and `svn info` for every working copy in the rail, resolved in one
 * query so the rows stay presentational.
 *
 * Both reads are local to the working copy. Each path is settled
 * independently — one dead path cannot blank the rail — and results are seeded
 * into the `['sidebar:info', path]` cache so the status bar and title bar read
 * them without a second `svn info`.
 */
export function useWorkingCopyOverview(paths: string[]): ReadonlyMap<string, WorkingCopySummary> {
  const queryClient = useQueryClient();
  const key = paths.join(' ');

  const { data } = useQuery({
    queryKey: ['sidebar:overview', key],
    queryFn: async () => {
      const entries = await Promise.all(
        paths.map(async (path): Promise<[string, WorkingCopySummary]> => {
          const [status, info] = await Promise.allSettled([
            readRepoStatusCounts(path),
            readWorkingCopyInfo(path),
          ]);
          if (info.status === 'fulfilled') {
            queryClient.setQueryData(['sidebar:info', path], info.value);
          }
          return [
            path,
            {
              // `svn status` only succeeds inside a checkout, so a failed read
              // means the path is not on disk as a working copy.
              presence: status.status === 'fulfilled' ? 'full' : 'none',
              status: status.status === 'fulfilled' ? status.value : undefined,
              info: info.status === 'fulfilled' ? info.value : undefined,
            },
          ];
        })
      );
      return new Map(entries);
    },
    enabled: paths.length > 0,
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const overview = data ?? EMPTY_OVERVIEW;
  const remoteStatuses = useQueries({
    queries: paths.map((path) => ({
      queryKey: ['sidebar:status-remote', path] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        window.api.svn.statusRemote(path, { signal }),
      enabled: Boolean(
        overview.get(path)?.status?.statusResult?.entries.some((entry) => entry.status === '!')
      ),
      retry: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    })),
  });

  return useMemo(() => {
    return reconcileOverviewProblems(
      paths,
      overview,
      remoteStatuses.map((result) => result.data)
    );
  }, [overview, paths, remoteStatuses]);
}

/** A repository root, plus the working copies checked out from it. */
export interface RepositoryRoot {
  /** `svn info` repository root URL. */
  url: string;
  /** Last path segment of the URL — what the rail shows as the row name. */
  name: string;
  /** Working-copy paths belonging to this root, in rail order. */
  workingCopies: string[];
}

/** Group working copies by the repository they were checked out from. */
export function collectRepositoryRoots(
  paths: string[],
  overview: ReadonlyMap<string, WorkingCopySummary>
): RepositoryRoot[] {
  const roots = new Map<string, RepositoryRoot>();
  for (const path of paths) {
    const url = overview.get(path)?.info?.repositoryRoot;
    if (!url) continue;
    const existing = roots.get(url);
    if (existing) {
      existing.workingCopies.push(path);
      continue;
    }
    const name = url.replace(/\/+$/, '').split('/').filter(Boolean).pop() || url;
    roots.set(url, { url, name, workingCopies: [path] });
  }
  return [...roots.values()];
}

/* ── problems in the rail ────────────────────────────────────────────────── */

export interface RailProblemRow {
  /** Working copy the problems belong to. Every row names its own checkout. */
  path: string;
  name: string;
  problems: WorkingCopyProblems;
  /** The status read behind this row came from the offline cache, not the disk. */
  fromCache: boolean;
  cacheAge: number;
}

export interface RailProblems {
  /** One row per working copy that has at least one problem. */
  rows: RailProblemRow[];
  /** Problems across every measured working copy. */
  total: number;
  /**
   * Working copies whose status has not resolved yet, so their problems are
   * genuinely unknown. Paths that are not checkouts are *not* counted here —
   * they have no local facts to measure.
   */
  unmeasured: number;
}

/**
 * Turn the rail's one status read per working copy into problem rows.
 *
 * Two states are kept apart on purpose. A measured working copy with no
 * problems contributes nothing (the section disappears rather than claiming a
 * confident `0`), and a working copy we have not measured yet is counted in
 * `unmeasured` so the UI can say the figure is incomplete instead of wrong.
 */
export function collectProblems(
  paths: string[],
  overview: ReadonlyMap<string, WorkingCopySummary>
): RailProblems {
  const rows: RailProblemRow[] = [];
  let total = 0;
  let unmeasured = 0;

  for (const path of paths) {
    const summary = overview.get(path);
    // 'none' means `svn status` did not answer for this path, i.e. there is no
    // checkout here. Local facts do not exist for it — do not count it either way.
    if (summary?.presence === 'none') continue;
    if (!summary || summary.presence === 'unknown' || !summary.status) {
      unmeasured += 1;
      continue;
    }
    const { problems } = summary.status;
    total += problems.total;
    if (problems.total === 0) continue;
    rows.push({
      path,
      name: describeRepo(path).name,
      problems,
      fromCache: summary.status.source === 'cache',
      cacheAge: summary.status.cacheAge,
    });
  }

  rows.sort(
    (a, b) => b.problems.blocking - a.problems.blocking || b.problems.total - a.problems.total
  );
  return { rows, total, unmeasured };
}

/* ── shelves ─────────────────────────────────────────────────────────────── */

/** Never probe more working copies for shelves than the rail can list. */
export const MAX_SHELF_PROBE_PATHS = 10;

export interface RailShelf {
  /** Shelves are local to one working copy — the row always says which. */
  workingCopyPath: string;
  workingCopyName: string;
  name: string;
  message?: string;
  /** Raw date from `svn shelf-list` / the portable shelf metadata. */
  date: string;
  /** Relative wording for `date`, e.g. `yesterday`. Empty when unparseable. */
  age: string;
}

export interface RailUnsupportedShelving {
  path: string;
  name: string;
  /** Verbatim reason from the client. `svn shelf` is Subversion 1.14+. */
  reason: string;
}

export interface RailShelves {
  shelves: RailShelf[];
  /** Working copies whose Subversion cannot shelve. A normal answer, not a failure. */
  unsupported: RailUnsupportedShelving[];
  /** Working copies that answered — the only ones we can say anything about. */
  measured: string[];
}

const EMPTY_SHELVES: RailShelves = { shelves: [], unsupported: [], measured: [] };

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Local midnight for a timestamp, so shelf ages count calendar days. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Age of a shelf in words — `yesterday`, `3 days ago`, `last week`.
 *
 * Returns `''` for a date Subversion did not give us or that will not parse:
 * an empty sub-line is better than a confident "Invalid Date".
 */
export function formatShelfAge(date: string, now = Date.now()): string {
  const at = Date.parse(date);
  if (Number.isNaN(at)) return '';
  const seconds = Math.round((at - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return RELATIVE_TIME.format(minutes, 'minute');

  // Counted in calendar days, not 24-hour blocks: a shelf made at 17:40 last
  // night is "yesterday" to the person who made it, not "18 hours ago".
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  if (days === 0) return RELATIVE_TIME.format(Math.round(minutes / 60), 'hour');
  if (Math.abs(days) < 7) return RELATIVE_TIME.format(days, 'day');
  if (Math.abs(days) < 35) return RELATIVE_TIME.format(Math.round(days / 7), 'week');
  if (Math.abs(days) < 365) return RELATIVE_TIME.format(Math.round(days / 30), 'month');
  return RELATIVE_TIME.format(Math.round(days / 365), 'year');
}

/** One working copy's answer to `svn shelf-list`. */
export interface ShelfProbe {
  path: string;
  result?: SvnShelveListResult;
}

/**
 * Fold the per-working-copy shelf reads into one newest-first list.
 *
 * A read that failed outright is left out entirely: a rail is the wrong place
 * to report an SVN error, and an empty list would be a lie. "This client cannot
 * shelve" is different — it is an answer, so it is carried in `unsupported` for
 * the UI to state plainly.
 */
export function buildRailShelves(probes: readonly ShelfProbe[], now = Date.now()): RailShelves {
  const shelves: RailShelf[] = [];
  const unsupported: RailUnsupportedShelving[] = [];
  const measured: string[] = [];

  for (const probe of probes) {
    const result = probe.result;
    if (!result) continue;
    const name = describeRepo(probe.path).name;
    if (result.unsupportedReason) {
      unsupported.push({ path: probe.path, name, reason: result.unsupportedReason });
      continue;
    }
    if (result.error) continue;
    measured.push(probe.path);
    for (const shelf of result.shelves ?? []) {
      shelves.push({
        workingCopyPath: probe.path,
        workingCopyName: name,
        name: shelf.name,
        message: shelf.message,
        date: shelf.date,
        age: formatShelfAge(shelf.date, now),
      });
    }
  }

  shelves.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return { shelves, unsupported, measured };
}

/**
 * Shelves for the working copies in the rail.
 *
 * One `svn shelf-list` per checkout is a process each, so this is off until the
 * caller says the app is idle (`enabled`), never retried, and never run for a
 * path that is not a checkout — shelves are a local fact. The query key matches
 * `ShelveDialog`'s, so saving or dropping a shelf there refreshes the rail and
 * neither surface reads the same list twice.
 */
export function useWorkingCopyShelves(paths: string[], enabled: boolean): RailShelves {
  const probed = paths.slice(0, MAX_SHELF_PROBE_PATHS);

  return useQueries({
    queries: probed.map((path) => ({
      queryKey: ['svn:shelve:list', path] as const,
      queryFn: () => window.api.svn.shelve.list(path),
      enabled,
      retry: false,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
    combine: (results) => {
      if (results.length === 0) return EMPTY_SHELVES;
      return buildRailShelves(
        results.map((result, index) => ({ path: probed[index], result: result.data }))
      );
    },
  });
}

/* ── disk usage ──────────────────────────────────────────────────────────── */

/** Recent repositories are capped at 10; never scan more than that. */
export const MAX_DISK_USAGE_PATHS = 10;

/**
 * Bytes on disk for the given working copies.
 *
 * `fs.getFolderSizes` walks each tree recursively, which is why the app gates
 * it behind the `showFolderSizes` setting — pass that through as `enabled`
 * rather than scanning multi-gigabyte checkouts on every launch.
 */
export function useWorkingCopySizes(paths: string[], enabled: boolean) {
  const scanned = paths.slice(0, MAX_DISK_USAGE_PATHS);
  const key = scanned.join(' ');
  return useQuery<Record<string, number>>({
    queryKey: ['sidebar:disk-usage', key],
    queryFn: () => window.api.fs.getFolderSizes(scanned),
    enabled: enabled && scanned.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

const DISK_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Byte count for the disk card. Mirrors `formatSize` in
 * `@renderer/hooks/useFolderSizes`, kept local so the always-resident sidebar
 * does not pull the file-explorer module graph into the initial bundle.
 */
export function formatDiskSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), DISK_UNITS.length - 1);
  const size = bytes / 1024 ** index;
  return `${index > 0 ? size.toFixed(1) : size.toFixed(0)} ${DISK_UNITS[index]}`;
}

/** One coloured slice of the disk card's segmented bar. */
export interface DiskSegment {
  path: string;
  bytes: number;
  presence: Exclude<LocalPresence, 'none'>;
}

export interface DiskUsage {
  totalBytes: number;
  fullBytes: number;
  sparseBytes: number;
  /** Working copies in the list that are not on disk. A count, never bytes. */
  notCheckedOut: number;
  segments: DiskSegment[];
}

/**
 * Build the disk card from measured sizes. Returns `null` when nothing has been
 * measured yet — the card is never rendered with estimated or placeholder
 * figures. There is deliberately no "not fetched" byte total: that would need
 * the repository's server-side size, which no API exposes.
 */
export function buildDiskUsage(
  sizes: Record<string, number> | undefined,
  presenceByPath: ReadonlyMap<string, SidebarPresence>
): DiskUsage | null {
  if (!sizes) return null;
  const segments: DiskSegment[] = [];
  let fullBytes = 0;
  let sparseBytes = 0;
  let notCheckedOut = 0;

  for (const [path, presence] of presenceByPath) {
    if (presence === 'none') {
      notCheckedOut += 1;
      continue;
    }
    if (presence === 'unknown') continue;
    const bytes = sizes[path];
    if (typeof bytes !== 'number' || bytes <= 0) continue;
    segments.push({ path, bytes, presence });
    if (presence === 'sparse') sparseBytes += bytes;
    else fullBytes += bytes;
  }

  const totalBytes = fullBytes + sparseBytes;
  if (totalBytes <= 0) return null;
  segments.sort((a, b) => b.bytes - a.bytes);
  return { totalBytes, fullBytes, sparseBytes, notCheckedOut, segments };
}

/** Persisted set of pinned repository paths (stored via the app settings store). */
export function usePinnedRepos() {
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get<string[]>(PINNED_KEY)
      .then((value) => {
        if (!cancelled && Array.isArray(value)) setPinned(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePin = useCallback((repo: string) => {
    setPinned((prev) => {
      const next = prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo];
      void window.api.store.set(PINNED_KEY, next);
      return next;
    });
  }, []);

  const isPinned = useCallback((repo: string) => pinned.includes(repo), [pinned]);

  return { pinned, isPinned, togglePin };
}
