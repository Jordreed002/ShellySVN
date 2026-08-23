import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import {
  AlertCircle,
  FolderGit2,
  GitBranch,
  HardDrive,
  HelpCircle,
  Layers,
  RotateCw,
  Tag,
  WifiOff,
} from 'lucide-react';
import type { RepoDiagnostics } from '@shared/types';

import { useSettings } from '@renderer/hooks/useSettings';
import { useWorkingCopyMixedRevisions } from '@renderer/hooks/useWorkingCopyFreshness';
import { describeMixedRevisions } from '@renderer/lib/workingCopyFreshness';
import {
  isFailedWorkingCopyQuery,
  isPathKeyedScope,
  keyTouchesPrefix,
} from '@renderer/lib/queryKeys';
import {
  buildDiskUsage,
  formatDiskSize,
  useWorkingCopyInfo,
  useWorkingCopyOverview,
  useWorkingCopySizes,
  type RepoStatusCounts,
  type SidebarPresence,
} from '../sidebar/sidebarData';
// The legend explains every status this strip (and the file lists) can show.
import { STATUS_LEGEND_OPEN_EVENT, StatusLegendDialogMount } from './StatusLegendDialog';

/**
 * Bottom status bar — the always-visible strip of facts about the working copy
 * you are in, the checkouts you have on disk, and the client running them.
 *
 * Presentation follows `.statusbar` in `prototypes/12-browser.html`: a 26px row
 * of mono, low-contrast cells separated by hairlines, with trailing cells pushed
 * right.
 *
 * **Every cell is a measured fact or it is absent.** The prototype's strip is
 * mock data, and several of its cells describe things this app cannot know:
 *
 * - *repository size and path count* ("2.1 TB · 512k paths") — no IPC reports
 *   either, and `svn list -R` on a large repository is not a status-bar read;
 * - *"listing cached 40s ago"* — the repository-browser listing lives in the
 *   feature's own cache; what this bar can see is the age of the `svn info`
 *   read behind the working-copy cells, which it labels as such;
 * - *"connected"* — reachability is proved by a request to the server. The
 *   repository browser proves it per URL in its own component state, which no
 *   other view can observe, so this bar never claims a healthy connection. It
 *   reports the one connection fact the renderer owns: the machine being
 *   offline.
 *
 * Costs: every query here is one the sidebar already runs, with the same key, so
 * the bar reads the rail's cache entries rather than issuing its own `svn`
 * calls. Nothing here polls.
 */

const CELL = 'flex items-center gap-1.5 h-full px-[11px] whitespace-nowrap';
const CELL_LEADING = `${CELL} border-r border-border-muted`;
const CELL_TRAILING = `${CELL} border-l border-border-muted min-w-0`;
const ICON = 'w-[11px] h-[11px]';

/** Emphasised value inside a cell — the prototype's `<b>`. */
function Value({ children }: { children: ReactNode }) {
  return <span className="text-text-secondary font-medium">{children}</span>;
}

/** "40s ago" / "12m ago" — how stale a cached read is. */
function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** "1 change" / "2 changes" — a count is never shown without its noun. */
function quantity(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The working copy's pending changes, in Subversion's words.
 *
 * `svn status` counts every changed node, not only modified ones, so this says
 * "changes" and names conflicts separately rather than borrowing the
 * prototype's "12 modified".
 */
function describeChanges(status: RepoStatusCounts): string {
  if (status.changes === 0) return 'no local changes';
  const parts = [quantity(status.changes, 'change', 'changes')];
  if (status.conflicts > 0) parts.push(quantity(status.conflicts, 'conflict', 'conflicts'));
  return parts.join(' · ');
}

function changesTone(status: RepoStatusCounts): string {
  if (status.conflicts > 0) return 'text-svn-conflict';
  return status.changes > 0 ? 'text-svn-modified' : 'text-svn-normal';
}

/**
 * The Subversion version — but only if the app has already learned it.
 *
 * `svn --version` reaches the renderer through exactly one call,
 * `window.api.svn.diagnostics()`, and that call also runs `svn info` plus a
 * `svn list` against the server. An always-mounted status bar must not make it,
 * so this reads whatever the diagnostics panel has already put in the query
 * cache and shows nothing until then. The bundled binary's version is
 * deliberately *not* hard-coded: "1.14.x" is a packaging claim, not the version
 * of the client that just ran.
 */
function useKnownSvnVersion(): string | null {
  const queryClient = useQueryClient();
  const queryCache = queryClient.getQueryCache();

  return useSyncExternalStore(
    (onStoreChange) =>
      queryCache.subscribe((event) => {
        if (event.query.queryKey[0] === 'diagnostics') onStoreChange();
      }),
    () => {
      for (const [, diagnostics] of queryClient.getQueriesData<RepoDiagnostics>({
        queryKey: ['diagnostics'],
      })) {
        if (diagnostics?.svnVersion) return diagnostics.svnVersion;
      }
      return null;
    }
  );
}

/**
 * Whether the machine has a network at all.
 *
 * Event-driven, never polled, and never read as "the repository is reachable" —
 * `navigator.onLine` only proves the negative.
 */
function useIsOffline(): boolean {
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return offline;
}

/**
 * The first failed read about the active working copy, or null when none.
 *
 * Like `useKnownSvnVersion`, this only *observes* the cache — it never issues a
 * call. A read can now fail where it once spun forever (every queryFn runs
 * under the app-wide IPC deadline), and when one does, the strip says so and
 * offers the retry, instead of quietly showing nothing.
 */
function useWorkingCopyReadError(scopePath: string | null): string | null {
  const queryClient = useQueryClient();
  const queryCache = queryClient.getQueryCache();

  return useSyncExternalStore(
    (onStoreChange) =>
      queryCache.subscribe((event) => {
        if (event.type === 'updated' || event.type === 'removed') onStoreChange();
      }),
    () => {
      if (!scopePath) return null;
      for (const query of queryCache.getAll()) {
        if (!isFailedWorkingCopyQuery(query.queryKey, scopePath, query.state.status)) continue;
        return query.state.error instanceof Error
          ? query.state.error.message
          : 'A repository read failed';
      }
      return null;
    },
    () => null
  );
}

export function StatusBar() {
  const { settings } = useSettings();
  const routerState = useRouterState();
  const queryClient = useQueryClient();

  const search = routerState.location.search as {
    path?: string;
    url?: string;
    localPath?: string;
  };
  const currentPath = search?.path || '';
  const browsedUrl = search?.url || '';
  const recentRepos = settings?.recentRepositories || [];
  /*
   * `localPath` is how the repository browser reports the checkout containing the
   * path on screen. Without it this bar says "No working copy open" while the
   * browser's own footer says "working copy · status from disk" — the two halves
   * of one window disagreeing about the same directory.
   */
  const activeRepo =
    search?.localPath ||
    recentRepos.find((repo) => currentPath === repo || currentPath.startsWith(repo + '/'));
  const { data: info } = useWorkingCopyInfo(activeRepo);

  /* ── the rail's queries, reused by key so nothing is read twice ────────── */
  const overview = useWorkingCopyOverview(recentRepos);
  const presenceByPath = new Map<string, SidebarPresence>(
    recentRepos.map((repo) => [repo, overview.get(repo)?.presence ?? 'unknown'])
  );
  const onDiskRepos = recentRepos.filter((repo) => {
    const presence = presenceByPath.get(repo);
    return presence === 'full' || presence === 'sparse';
  });
  // Measuring a checkout means walking it, so the byte total follows the user's
  // existing "show folder sizes" preference. With it off the census still shows
  // the count — what is missing is the size, and the size cell simply goes away
  // rather than reporting a plausible 0.
  const { data: workingCopySizes } = useWorkingCopySizes(
    onDiskRepos,
    settings?.showFolderSizes ?? false
  );
  const diskUsage = buildDiskUsage(workingCopySizes, presenceByPath);

  // Local facts belong to a checkout, never to a repository, so the change
  // summary is the *active working copy's* `svn status` and nothing else.
  const status = activeRepo ? overview.get(activeRepo)?.status : undefined;

  const svnVersion = useKnownSvnVersion();
  const isOffline = useIsOffline();
  const readError = useWorkingCopyReadError(activeRepo ?? null);
  /*
   * Mixed-revision state, in the same spirit as every other cell: derived from
   * cache entries the Files surface has already filled for this working copy
   * (its recursive deep status and child commits), anchored by the BASE
   * revision above. No entry yet — no cell. The derivation's limits are
   * documented in `lib/workingCopyFreshness`.
   */
  const mixedRevisions = useWorkingCopyMixedRevisions(activeRepo, info?.revision);

  /** Retry the working copy's failed reads by making their cache entries stale. */
  const retryWorkingCopyReads = () => {
    if (!activeRepo) return;
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        isPathKeyedScope(queryKey[0]) && keyTouchesPrefix(queryKey, activeRepo),
    });
  };

  /*
   * The legend dialog owns its open state (it also opens from the command
   * palette through the same event), so the button is just another source.
   */
  const openLegend = () => {
    window.dispatchEvent(new CustomEvent(STATUS_LEGEND_OPEN_EVENT));
  };

  if (!settings?.showStatusBar) {
    return null;
  }

  const repoName = activeRepo ? activeRepo.split(/[/\\]/).pop() || activeRepo : null;
  const BranchIcon = info?.branchKind === 'tag' ? Tag : GitBranch;
  // Where you are: a working-copy path, or the repository URL when browsing the
  // server without a checkout.
  const location = currentPath || browsedUrl;

  return (
    <footer
      className="flex items-center h-control-sm flex-shrink-0 bg-bg-secondary border-t border-border font-mono text-10.5 leading-none text-text-muted"
      role="status"
      aria-live="polite"
      // `role="status"` implies `aria-atomic="true"`, which re-announces the
      // whole strip whenever any cell changes. False keeps announcements to the
      // cell that actually changed.
      aria-atomic="false"
      aria-label="Application status"
    >
      {/* Leading — the active working copy */}
      {repoName ? (
        <>
          <span className={CELL_LEADING}>
            <FolderGit2 className={`${ICON} text-accent`} aria-hidden="true" />
            <Value>{repoName}</Value>
          </span>
          {info && (
            <>
              <span className={CELL_LEADING}>
                <BranchIcon className={ICON} aria-hidden="true" />
                <Value>{info.branch}</Value>
              </span>
              <span className={CELL_LEADING}>
                at <Value>r{info.revision}</Value>
              </span>
              {info.source === 'cache' && (
                <span className={`${CELL_LEADING} text-svn-modified`}>
                  {/* Which read is stale, not a vague "cached". */}
                  svn info cached {formatAge(info.cacheAge)}
                </span>
              )}
            </>
          )}
        </>
      ) : (
        <span className={CELL_LEADING}>No working copy open</span>
      )}

      {/* Checkouts on disk. The count is always known; the size only once measured. */}
      {onDiskRepos.length > 0 && (
        <span className={CELL_LEADING}>
          <HardDrive className={ICON} aria-hidden="true" />
          {quantity(onDiskRepos.length, 'working copy', 'working copies')}
          {diskUsage && (
            <>
              {'·'}
              <Value>{formatDiskSize(diskUsage.totalBytes)}</Value>
            </>
          )}
        </span>
      )}

      {/* Pending changes in the active working copy */}
      {status && (
        <span className={`${CELL_LEADING} ${changesTone(status)}`}>{describeChanges(status)}</span>
      )}

      {/* Mixed-revision state of the active working copy, when already read */}
      {mixedRevisions && (
        <span
          className={`${CELL_LEADING} text-accent`}
          title={`Parts of this working copy are at newer revisions than r${mixedRevisions.baseRevision}:\n${mixedRevisions.items.join('\n')}`}
        >
          <Layers className={ICON} aria-hidden="true" />
          mixed {describeMixedRevisions(mixedRevisions)}
        </span>
      )}

      {/* Spacer — the prototype's `.sp` */}
      <span className="flex-1" />

      {/* Trailing — where we are, then how we are */}
      {location && (
        <span className={CELL_TRAILING} title={location}>
          <span
            className="truncate max-w-[42vw] text-text-faint"
            style={{ direction: 'rtl', textAlign: 'left' }}
          >
            {location}
          </span>
        </span>
      )}

      {/* A working-copy read failed (or timed out) — say which, and offer the retry */}
      {readError && (
        <span className={`${CELL_TRAILING} text-error`} title={readError}>
          <AlertCircle className={ICON} aria-hidden="true" />
          <span className="truncate">read failed</span>
          <button
            type="button"
            onClick={retryWorkingCopyReads}
            className="ml-1 inline-flex items-center gap-1 rounded px-1 hover:bg-bg-elevated focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-label="Retry working copy reads"
            title={`Retry: ${readError}`}
          >
            <RotateCw className={ICON} aria-hidden="true" />
            retry
          </button>
        </span>
      )}

      {isOffline && (
        <span className={`${CELL_TRAILING} text-svn-modified`}>
          <WifiOff className={ICON} aria-hidden="true" />
          offline
        </span>
      )}

      {/* What the colors mean — the one help affordance on the strip (#94). */}
      <span className={CELL_TRAILING}>
        <button
          type="button"
          onClick={openLegend}
          className="inline-flex items-center gap-1 rounded px-1 hover:bg-bg-elevated focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-label="What the status colors mean"
          title="What every Subversion status letter and color means"
        >
          <HelpCircle className={ICON} aria-hidden="true" />
          legend
        </button>
      </span>

      {svnVersion && <span className={CELL_TRAILING}>svn {svnVersion}</span>}

      {/* Status legend dialog (#94): opens from the button above or the
          command palette via STATUS_LEGEND_OPEN_EVENT. */}
      <StatusLegendDialogMount />
    </footer>
  );
}
