/**
 * Home — where the day's work starts.
 *
 * It leads with the working copy you were last in: its local changes, whether
 * the repository has moved on, and the next useful action for it. Below that,
 * problems `svn status` found (only when there are any), every saved working
 * copy with the batch update pipeline, and shelves. Recent locations and the
 * working-copy switcher live in the sidebar and are not repeated here.
 *
 * The app already knows most of this before the route renders: the rail
 * resolves `svn status` and `svn info` once per working copy
 * (`useWorkingCopyOverview`) and lists shelves once per checkout
 * (`useWorkingCopyShelves`). Home is a **second consumer of those same query
 * keys** — every local number here is a cache hit, not another `svn` process.
 * Incoming revisions need a round trip, so they stay "Not checked" until
 * someone asks the server through the batch pipeline.
 *
 * Rules: Subversion's vocabulary (update, commit, BASE, HEAD, shelf — no
 * "push"); local facts belong to a named working copy; no confident zeros.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FolderOpen, GitBranch } from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
// Read-only imports: the rail owns these queries and Home reuses them, so the
// two surfaces can never disagree about the same working copy.
import {
  collectProblems,
  useWorkingCopyOverview,
  useWorkingCopyShelves,
} from '@renderer/components/sidebar/sidebarData';
import {
  getOnboardingChecklist,
  reopenOnboardingChecklist,
  subscribeOnboardingChecklist,
} from '@renderer/lib/onboardingStore';
import { REVIEW_CENTER_OPEN_EVENT } from '@renderer/features/ai-review-center/reviewCenterEvents';
import { useBatchUpdate } from '@renderer/features/working-copy-command-center/BatchUpdateProvider';
import {
  BatchRunBar,
  CommandCenterSection,
} from '@renderer/features/working-copy-command-center/CommandCenterSection';
import {
  batchItemRevisions,
  batchItemStateLabel,
  batchItemTone,
  isBatchItemBusy,
} from '@renderer/features/working-copy-command-center/itemLabels';

import {
  buildHomeWorkingCopies,
  describeLocalState,
  describeOperations,
  isCheckedOut,
  pickFocusWorkingCopy,
  summarizeBriefing,
} from './homeBriefing';
import {
  AttentionSection,
  EmptyBriefing,
  FocusWorkingCopy,
  HomeLoading,
  HomeShelvesSection,
  LOCAL_TONE_CLASS,
} from './HomeSections';
import { PageHeader } from '@renderer/components/ui/PageHeader';
import { OnboardingChecklist } from '@renderer/components/onboarding/OnboardingChecklist';
import { ONBOARDING_STEPS } from '@renderer/components/onboarding/onboardingSteps';

const AddRepoModal = lazy(() =>
  import('@renderer/components/ui/AddRepoModal').then((m) => ({
    default: m.AddRepoModal,
  }))
);
const ImportDialog = lazy(() =>
  import('@renderer/components/ui/ImportDialog').then((m) => ({
    default: m.ImportDialog,
  }))
);
const ShelveDialog = lazy(() =>
  import('@renderer/components/ui/ShelveDialog').then((m) => ({
    default: m.ShelveDialog,
  }))
);

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
  const { settings, isLoading, addRecentRepo, removeRecentRepo } = useSettings();
  const batch = useBatchUpdate();
  const onboarding = useSyncExternalStore(subscribeOnboardingChecklist, getOnboardingChecklist);

  const [modal, setModal] = useState<'open' | 'checkout' | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [shelvesFor, setShelvesFor] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [isIdle, setIsIdle] = useState(false);

  const recentRepos = useMemo(() => settings?.recentRepositories ?? [], [settings]);

  /* ── the rail's facts, read from the same cache ── */
  const overview = useWorkingCopyOverview(recentRepos);
  const rows = useMemo(
    () => buildHomeWorkingCopies(recentRepos, overview),
    [recentRepos, overview]
  );
  const problems = useMemo(() => collectProblems(recentRepos, overview), [recentRepos, overview]);

  const checkedOutPaths = useMemo(() => rows.filter(isCheckedOut).map((row) => row.path), [rows]);
  const attributeWorkingCopy = checkedOutPaths.length > 1;

  // One `svn shelf-list` per checkout is a process each, so this waits for idle
  // exactly as the rail does — and shares the rail's query keys.
  const shelvesOf = useWorkingCopyShelves(checkedOutPaths, isIdle);

  // Every action in the focus panel targets this one working copy, named in
  // its heading — never an unrelated recent path.
  const focus = pickFocusWorkingCopy(rows);
  const focusPath = focus?.path;
  const focusItem = focusPath ? batch.items.find((item) => item.path === focusPath) : undefined;
  const batchActive = batch.summary.running + batch.summary.queued;
  const showList = batch.items.length > 1;

  const isLoadingSettings = isLoading;
  const onboardingComplete = ONBOARDING_STEPS.filter((step) => !step.comingSoon).every((step) =>
    Boolean(onboarding.completedAt[step.id])
  );
  const isFirstRun = !isLoadingSettings && recentRepos.length === 0;

  useEffect(() => runWhenIdle(() => setIsIdle(true)), []);

  const openWorkingCopy = useCallback(
    async (path: string) => {
      await addRecentRepo(path);
      navigate({ to: '/files', search: { path } });
    },
    [addRecentRepo, navigate]
  );

  const localStateOf = useCallback(
    (path: string) => {
      const row = rows.find((candidate) => candidate.path === path);
      if (!row) return undefined;
      const local = describeLocalState(row);
      return { label: local.label, className: LOCAL_TONE_CLASS[local.tone] };
    },
    [rows]
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

  const summary = isDragOver
    ? 'Drop the folder to open it as a working copy'
    : isLoadingSettings
      ? undefined
      : isFirstRun
        ? 'Nothing checked out on this machine yet'
        : summarizeBriefing(rows, problems);

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
      <PageHeader
        title="Home"
        summary={summary}
        summaryTitle="Local counts come from the svn status and svn info reads the sidebar already made for each working copy."
        actions={
          <>
            <button
              type="button"
              onClick={() => setModal('open')}
              className="btn btn-ghost btn-sm gap-1.5"
              data-testid="browse-button"
              title="Open a folder that is already a working copy"
            >
              <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
              Open working copy…
            </button>
            <button
              type="button"
              onClick={() => setModal('checkout')}
              className="btn btn-primary btn-sm gap-1.5"
              data-testid="checkout-button"
              title="Check a repository out to this machine — svn checkout"
            >
              <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />
              Checkout…
            </button>
          </>
        }
      />

      {dropError && (
        <div
          role="alert"
          className="flex flex-shrink-0 items-center gap-2 border-b border-svn-conflict/40 bg-svn-conflict/10 px-4 py-1.5 text-12 text-svn-conflict"
        >
          <span className="min-w-0 flex-1 break-words">{dropError}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm flex-shrink-0"
            onClick={() => setDropError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-overlay">
        <div className="home-content mx-auto flex max-w-[960px] flex-col gap-7 px-4 py-6 sm:px-6">
          {isLoadingSettings ? (
            <HomeLoading />
          ) : isFirstRun ? (
            <>
              <EmptyBriefing
                onOpen={() => setModal('open')}
                onCheckout={() => setModal('checkout')}
                showChecklistLink={onboarding.dismissed}
              />
              <OnboardingChecklist onOpenWorkingCopy={() => setModal('open')} />
            </>
          ) : (
            <>
              <OnboardingChecklist compact onOpenWorkingCopy={() => setModal('open')} />

              {focus && (
                <FocusWorkingCopy
                  row={focus}
                  local={describeLocalState(focus)}
                  operations={describeOperations(isCheckedOut(focus) ? focus : undefined)}
                  remote={
                    focusItem && (focusItem.status !== 'idle' || focusItem.checkedAt)
                      ? {
                          label: batchItemStateLabel(focusItem),
                          className: batchItemTone(focusItem),
                          revisions: batchItemRevisions(focusItem),
                          detail:
                            focusItem.verificationError ??
                            focusItem.error ??
                            focusItem.blockedReason,
                        }
                      : null
                  }
                  updateBusy={
                    batch.isChecking ||
                    batchActive > 0 ||
                    (focusItem ? isBatchItemBusy(focusItem) : false)
                  }
                  isChecking={batch.isChecking}
                  hasOthers={rows.length > 1}
                  onOpenFiles={() => void openWorkingCopy(focus.path)}
                  onUpdate={() => void batch.updatePaths([focus.path])}
                  onCheck={() => void batch.checkAll()}
                  onHistory={() => {
                    void addRecentRepo(focus.path);
                    navigate({ to: '/history', search: { path: focus.path } });
                  }}
                  onReview={() => window.dispatchEvent(new CustomEvent(REVIEW_CENTER_OPEN_EVENT))}
                  onOpenAnother={() => setModal('open')}
                  onForget={() => void removeRecentRepo(focus.path)}
                  footer={showList ? undefined : <BatchRunBar />}
                />
              )}

              <AttentionSection problems={problems} attributeWorkingCopy={attributeWorkingCopy} />

              {showList && <CommandCenterSection localStateOf={localStateOf} />}

              <HomeShelvesSection
                shelves={shelvesOf.shelves}
                unsupported={shelvesOf.unsupported}
                attributeWorkingCopy={attributeWorkingCopy}
                onOpenShelves={setShelvesFor}
              />

              {onboarding.dismissed && !onboardingComplete && (
                <p className="px-1 text-12 text-text-muted">
                  <button
                    type="button"
                    onClick={reopenOnboardingChecklist}
                    className="rounded-6 underline decoration-border-strong underline-offset-2 hover:text-text-secondary"
                  >
                    Show the getting-started checklist
                  </button>
                </p>
              )}
            </>
          )}
        </div>
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
          <ShelveDialog
            isOpen={true}
            onClose={() => setShelvesFor(null)}
            workingCopyPath={shelvesFor}
          />
        </Suspense>
      )}
    </div>
  );
}
