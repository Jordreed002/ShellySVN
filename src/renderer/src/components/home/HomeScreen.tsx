/**
 * Home — a briefing on the checkouts on this machine, not a splash screen.
 *
 * The app already knows, before this route renders, what needs attention and
 * where the session left off: the rail resolves `svn status` and `svn info` once
 * per working copy (`useWorkingCopyOverview`) and lists shelves once per
 * checkout (`useWorkingCopyShelves`). Home is a **second consumer of those same
 * query keys** — every number here is a cache hit, not another `svn` process.
 *
 * Three rules this screen is built around:
 *
 * 1. **Subversion's vocabulary.** checkout, update, commit, revert, diff,
 *    revision, BASE, HEAD, shelf — with the command shown beside the word.
 *    There is no "push": that is Git's, and Subversion has no such operation.
 * 2. **Local facts belong to working copies.** Change counts, conflicts and
 *    shelves exist only inside a checkout, and are never attributed to the
 *    server.
 * 3. **No confident zeros.** A checkout whose status has not resolved is
 *    reported as unmeasured; incoming revisions, which need a round trip, are
 *    `—` until someone asks the server.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FolderOpen, GitBranch, Turtle } from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
// Read-only imports: the rail owns these queries and Home reuses them, so the
// two surfaces can never disagree about the same working copy.
import {
  collectProblems,
  describeRepo,
  useWorkingCopyOverview,
  useWorkingCopyShelves,
} from '@renderer/components/sidebar/sidebarData';

import {
  buildHomeWorkingCopies,
  describeOperations,
  isCheckedOut,
  summarizeBriefing,
  type OperationKind,
} from './homeBriefing';
import {
  AttentionSection,
  EmptyBriefing,
  HomeShelvesSection,
  IncomingSection,
  OperationsSection,
  RecentLocationsSection,
  WorkingCopiesSection,
} from './HomeSections';
import { useIncomingRevisions } from './useIncomingRevisions';

const AddRepoModal = lazy(() =>
  import('@renderer/components/ui/AddRepoModal').then((m) => ({ default: m.AddRepoModal }))
);
const ImportDialog = lazy(() =>
  import('@renderer/components/ui/ImportDialog').then((m) => ({ default: m.ImportDialog }))
);
const ShelveDialog = lazy(() =>
  import('@renderer/components/ui/ShelveDialog').then((m) => ({ default: m.ShelveDialog }))
);

/** Locations are a shortcut list, not a log — the rail uses the same ceiling. */
const MAX_RECENT_LOCATIONS = 6;

/** Wait for a quiet moment before asking each checkout for its shelves. */
function runWhenIdle(callback: () => void, timeout = 1500): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
}

export function HomeScreen() {
  const navigate = useNavigate();
  const { settings, addRecentRepo } = useSettings();

  const [modal, setModal] = useState<'open' | 'checkout' | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [shelvesFor, setShelvesFor] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [isIdle, setIsIdle] = useState(false);
  // Checkouts the user has asked the server about. Empty on load: counting
  // incoming revisions is a network round trip, never something a screen does
  // to you on arrival.
  const [checkedForIncoming, setCheckedForIncoming] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  const recentRepos = useMemo(() => settings?.recentRepositories ?? [], [settings]);
  const recentPaths = settings?.recentPaths ?? [];
  const bookmarks = settings?.bookmarks ?? [];

  /* ── the rail's facts, read from the same cache ── */
  const overview = useWorkingCopyOverview(recentRepos);
  const rows = useMemo(() => buildHomeWorkingCopies(recentRepos, overview), [recentRepos, overview]);
  const problems = collectProblems(recentRepos, overview);

  const checkedOut = rows.filter(isCheckedOut);
  const measuredClean = rows.filter((row) => row.status && row.status.problems.total === 0).length;
  const attributeWorkingCopy = checkedOut.length > 1;

  // One `svn shelf-list` per checkout is a process each, so this waits for idle
  // exactly as the rail does — and shares the rail's query keys.
  const shelvesOf = useWorkingCopyShelves(
    checkedOut.map((row) => row.path),
    isIdle
  );

  const incoming = useIncomingRevisions(rows, checkedForIncoming);

  // The operations act on the checkout you last opened — named on screen, so
  // "Commit" is never ambiguous about which working copy it means.
  const target = checkedOut[0];
  const operations = describeOperations(target);

  const locations = recentPaths
    .filter((path) => !recentRepos.includes(path))
    .slice(0, MAX_RECENT_LOCATIONS);

  const isFirstRun =
    recentRepos.length === 0 && recentPaths.length === 0 && bookmarks.length === 0;

  useEffect(() => runWhenIdle(() => setIsIdle(true)), []);

  const openWorkingCopy = useCallback(
    async (path: string) => {
      await addRecentRepo(path);
      navigate({ to: '/files', search: { path } });
    },
    [addRecentRepo, navigate]
  );

  /* ── drag and drop: a folder dropped anywhere on this screen ── */

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      setDropError(null);

      const file = event.dataTransfer.files.item(0);
      if (!file) {
        setDropError('Drop a working-copy folder to open it.');
        return;
      }
      const path = window.api.dialog.getPathForFile(file);
      if (!path) {
        setDropError('The dropped folder path could not be read.');
        return;
      }
      try {
        const info = await window.api.svn.info(path);
        if (!info) {
          setDropError(`${path} is not a Subversion working copy — svn info found nothing there.`);
          return;
        }
        await openWorkingCopy(path);
      } catch {
        setDropError(`${path} is not a Subversion working copy — svn info found nothing there.`);
      }
    },
    [openWorkingCopy]
  );

  const handleCheck = useCallback((path: string) => {
    setCheckedForIncoming((previous) => new Set(previous).add(path));
  }, []);

  const handleRunOperation = useCallback(
    (kind: OperationKind) => {
      if (!target) return;
      // Every one of these runs against a working copy, which is what the
      // working-copy view is: it carries Update, Commit, Revert and Diff.
      void addRecentRepo(target.path);
      navigate({ to: '/files', search: { path: target.path } });
      void kind;
    },
    [addRecentRepo, navigate, target]
  );

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden transition-fast ${
        isDragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header: what this screen is, what it adds up to, and the two ways in. */}
      <div className="flex h-control-md flex-shrink-0 items-center gap-2.5 border-b border-border bg-bg-secondary/60 px-3">
        <h1 className="eyebrow flex-shrink-0">Briefing</h1>
        <span
          className="min-w-0 flex-1 truncate font-mono text-10 text-text-muted"
          title="Counts come from the svn status and svn info reads the sidebar already made for each working copy."
        >
          {isDragOver
            ? 'Drop the folder to open it as a working copy'
            : isFirstRun
              ? 'nothing checked out on this machine yet'
              : summarizeBriefing(rows, problems)}
        </span>
        <button
          type="button"
          onClick={() => setModal('open')}
          className="btn btn-secondary btn-sm flex-shrink-0 gap-1.5 text-11"
          data-testid="browse-button"
          title="Open a folder that is already a working copy"
        >
          <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
          Open working copy…
        </button>
        <button
          type="button"
          onClick={() => setModal('checkout')}
          className="btn btn-primary btn-sm flex-shrink-0 gap-1.5 text-11"
          data-testid="checkout-button"
          title="Check a repository out to this machine — svn checkout"
        >
          <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />
          Checkout…
        </button>
      </div>

      {dropError && (
        <div
          role="alert"
          className="flex-shrink-0 border-b border-svn-conflict/40 bg-svn-conflict/10 px-3 py-1.5 font-mono text-10.5 text-svn-conflict"
        >
          {dropError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-overlay">
        <div className="mx-auto grid max-w-[1180px] gap-3 p-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start">
          {isFirstRun ? (
            <>
              <div className="xl:col-span-2">
                <EmptyBriefing
                  onOpen={() => setModal('open')}
                  onCheckout={() => setModal('checkout')}
                />
              </div>
              <div className="xl:col-span-2">
                <OperationsSection operations={operations} onRun={handleRunOperation} />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3">
                <AttentionSection
                  problems={problems}
                  measuredClean={measuredClean}
                  attributeWorkingCopy={attributeWorkingCopy}
                />
                <WorkingCopiesSection
                  rows={rows}
                  lastPath={recentRepos[0]}
                  onOpen={(path) => void addRecentRepo(path)}
                />
                <OperationsSection
                  operations={operations}
                  targetName={target ? describeRepo(target.path).name : undefined}
                  onRun={handleRunOperation}
                />
              </div>
              <div className="grid gap-3">
                <IncomingSection rows={rows} incoming={incoming} onCheck={handleCheck} />
                <HomeShelvesSection
                  shelves={shelvesOf.shelves}
                  unsupported={shelvesOf.unsupported}
                  attributeWorkingCopy={attributeWorkingCopy}
                  onOpenShelves={setShelvesFor}
                />
                <RecentLocationsSection paths={locations} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex h-control-sm flex-shrink-0 items-center gap-2 border-t border-border px-3 font-mono text-9.5 text-text-faint">
        <Turtle aria-hidden="true" className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">ShellySVN bundles Subversion 1.14.x</span>
        <span className="ml-auto hidden flex-shrink-0 sm:inline">
          no external dependencies required
        </span>
      </div>

      {modal && (
        <Suspense fallback={null}>
          <AddRepoModal
            isOpen={true}
            onClose={() => setModal(null)}
            onOpenRepo={(path) => {
              setModal(null);
              void openWorkingCopy(path);
            }}
            onImport={() => {
              setModal(null);
              setIsImportOpen(true);
            }}
            recentRepos={recentRepos}
            initialTab={modal}
          />
        </Suspense>
      )}

      {isImportOpen && (
        <Suspense fallback={null}>
          <ImportDialog isOpen={true} onClose={() => setIsImportOpen(false)} />
        </Suspense>
      )}

      {shelvesFor && (
        <Suspense fallback={null}>
          <ShelveDialog isOpen={true} onClose={() => setShelvesFor(null)} workingCopyPath={shelvesFor} />
        </Suspense>
      )}
    </div>
  );
}
