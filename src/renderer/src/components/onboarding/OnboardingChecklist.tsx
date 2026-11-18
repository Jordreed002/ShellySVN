/**
 * OnboardingChecklist (#88) — the first-run checklist card on the home route.
 *
 * Every step auto-checks from state the app already has (settings recents, the
 * svn command timeline, the review-center open event — see
 * ./onboardingSteps.ts); nothing new is collected. Steps stay checked across
 * sessions (lib/onboardingStore.ts persists the seen-done record), the card is
 * dismissible, and Home can bring it back. Home renders it compact (one
 * summary line with the next step) once a working copy exists.
 *
 * The "Create a sample repo" step runs `svn:createSampleRepository` (a seeded
 * local repository via svnadmin) and then the existing checkout flow: the user
 * picks a parent folder, the trunk is checked out into it as
 * `shellysvn-sample`, and the working-copy view opens.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Circle, X } from 'lucide-react';

import { useSettings } from '@renderer/hooks/useSettings';
import { svnCommandTimeline } from '@renderer/lib/queryKeys';
import {
  dismissOnboardingChecklist,
  ensureOnboardingHydrated,
  getOnboardingChecklist,
  markOnboardingStepsDone,
  subscribeOnboardingChecklist,
} from '@renderer/lib/onboardingStore';
import { REVIEW_CENTER_OPEN_EVENT } from '@renderer/features/ai-review-center/reviewCenterEvents';
import {
  deriveOnboardingSteps,
  doneStepIdsToRecord,
  type OnboardingStepState,
} from './onboardingSteps';

const TIMELINE_REFETCH_MS = 5000;

export interface OnboardingChecklistProps {
  /** Opens the "Open working copy…" dialog on the home screen. */
  onOpenWorkingCopy?: () => void;
  /**
   * Start as a single summary line (progress + the next step) that expands to
   * the full list. Home uses this once a working copy exists, so the checklist
   * does not push the day's work below the fold for a returning user.
   */
  compact?: boolean;
}

export function OnboardingChecklist({
  onOpenWorkingCopy,
  compact = false,
}: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const { settings, addRecentRepo } = useSettings();
  const checklist = useSyncExternalStore(subscribeOnboardingChecklist, getOnboardingChecklist);
  const [sampleState, setSampleState] = useState<
    { phase: 'idle' } | { phase: 'creating' } | { phase: 'error'; message: string }
  >({ phase: 'idle' });
  const [expanded, setExpanded] = useState(!compact);

  useEffect(() => {
    void ensureOnboardingHydrated();
  }, []);

  const recentRepos = useMemo(() => settings?.recentRepositories ?? [], [settings]);
  const workingCopyPath = recentRepos[0];

  /*
   * The derivable steps that still need watching decide whether the timeline
   * query runs (and refreshes). Once every step is done the observation stops —
   * nothing here keeps polling for its own sake.
   */
  const needsTimeline = useMemo(
    () => !checklist.completedAt['first-update'] || !checklist.completedAt['first-commit'],
    [checklist.completedAt]
  );

  const { data: timeline } = useQuery({
    queryKey: svnCommandTimeline(),
    queryFn: () => window.api.svn.commandTimeline(),
    enabled: !checklist.dismissed && needsTimeline,
    refetchInterval: TIMELINE_REFETCH_MS,
  });

  // The review center's open event — the same one the command palette sends.
  // Observing it auto-checks the step no matter how the center was opened.
  const [reviewCenterOpened, setReviewCenterOpened] = useState(false);
  useEffect(() => {
    const listener = () => setReviewCenterOpened(true);
    window.addEventListener(REVIEW_CENTER_OPEN_EVENT, listener);
    return () => window.removeEventListener(REVIEW_CENTER_OPEN_EVENT, listener);
  }, []);

  const steps = useMemo(() => {
    const successful = new Set(
      (timeline ?? [])
        .filter((entry) => entry.status === 'success')
        .map((entry) => entry.operation)
    );
    return deriveOnboardingSteps(
      {
        recentRepoCount: recentRepos.length,
        successfulOperations: successful,
        reviewCenterOpened:
          reviewCenterOpened || Boolean(checklist.completedAt['review-center']),
      },
      checklist.completedAt
    );
  }, [checklist.completedAt, recentRepos.length, reviewCenterOpened, timeline]);

  // Record observed completions so they survive the session (idempotent).
  useEffect(() => {
    const done = doneStepIdsToRecord(steps);
    if (done.length > 0) markOnboardingStepsDone(done);
  }, [steps]);

  const completable = steps.filter((step) => !step.comingSoon);
  const doneCount = completable.filter((step) => step.done).length;
  const allDone = completable.length > 0 && doneCount === completable.length;

  /**
   * Sample-repo step (#88): create the seeded playground, then run the existing
   * checkout flow — the user picks a parent folder and the trunk lands in
   * `<parent>/shellysvn-sample`, which opens as the active working copy.
   */
  const runSampleRepoStep = useCallback(async () => {
    setSampleState({ phase: 'creating' });
    try {
      const created = await window.api.svn.createSampleRepository();
      if (!created.success || !created.url) {
        setSampleState({
          phase: 'error',
          message: created.error ?? 'The sample repository could not be created.',
        });
        return;
      }
      markOnboardingStepsDone(['sample-repo']);
      const parent = await window.api.dialog.openDirectory();
      if (!parent) {
        // Repository exists now; the checkout can happen any time via Checkout…
        setSampleState({ phase: 'idle' });
        return;
      }
      const checkoutPath = `${parent.replace(/[\\/]+$/, '')}/shellysvn-sample`;
      const checkout = await window.api.svn.checkout(created.url, checkoutPath);
      if (!checkout.success) {
        setSampleState({
          phase: 'error',
          message: `Checking out ${created.url} failed.`,
        });
        return;
      }
      setSampleState({ phase: 'idle' });
      await addRecentRepo(checkoutPath);
      navigate({ to: '/files', search: { path: checkoutPath } });
    } catch (error) {
      setSampleState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [addRecentRepo, navigate]);

  // Hooks before the early return below — hiding the card mid-session must not
  // change the hook count between renders.
  const runStep = useCallback(
    (step: OnboardingStepState) => {
      switch (step.id) {
        case 'open-working-copy':
          onOpenWorkingCopy?.();
          break;
        case 'first-update':
        case 'first-commit':
          // Both run in the working-copy view, which carries Update and Commit.
          navigate({ to: '/files', search: { path: workingCopyPath ?? '/' } });
          break;
        case 'review-center':
          window.dispatchEvent(new CustomEvent(REVIEW_CENTER_OPEN_EVENT));
          break;
        case 'sample-repo':
          void runSampleRepoStep();
          break;
      }
    },
    [navigate, onOpenWorkingCopy, runSampleRepoStep, workingCopyPath]
  );

  // Hidden once dismissed or finished; Home can re-open it.
  if (checklist.dismissed || allDone) return null;

  const nextStep = steps.find((step) => !step.done && !step.comingSoon);
  const isBusy = (step: OnboardingStepState) =>
    step.id === 'sample-repo' && sampleState.phase === 'creating';
  const percent = completable.length ? (doneCount / completable.length) * 100 : 0;

  return (
    <section
      aria-labelledby="onboarding-checklist-title"
      className="overflow-hidden rounded-10 border border-border bg-bg-secondary"
      data-testid="onboarding-checklist"
    >
      <div className="flex min-h-control-md flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <h2
          id="onboarding-checklist-title"
          className="flex-shrink-0 text-13 font-semibold text-text"
        >
          Getting started
        </h2>
        <span
          className="flex flex-shrink-0 items-center gap-2 text-12 text-text-muted"
          title="Checked from what the app already knows — nothing new is collected"
        >
          <span
            className="block h-1 w-16 overflow-hidden rounded-full bg-bg-tertiary"
            role="progressbar"
            aria-label="Getting-started progress"
            aria-valuemin={0}
            aria-valuemax={completable.length}
            aria-valuenow={doneCount}
          >
            <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </span>
          {doneCount} of {completable.length} done
        </span>
        {!expanded && nextStep && (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate text-12 text-text-secondary" title={nextStep.detail}>
              Next: {nextStep.title}
            </span>
            <button
              type="button"
              onClick={() => runStep(nextStep)}
              disabled={isBusy(nextStep)}
              className="btn btn-secondary btn-sm flex-shrink-0"
              aria-label={`Continue: ${nextStep.title}`}
              title={nextStep.detail}
            >
              {isBusy(nextStep) ? 'Creating…' : 'Start'}
            </button>
          </span>
        )}
        <span className="ml-auto flex flex-shrink-0 items-center gap-1">
          {compact && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="btn btn-ghost btn-sm gap-1"
              aria-expanded={expanded}
              aria-controls="onboarding-checklist-steps"
            >
              {expanded ? 'Hide steps' : 'All steps'}
              <ChevronDown
                aria-hidden="true"
                className={`h-3.5 w-3.5 transition-fast ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={dismissOnboardingChecklist}
            className="btn-icon-sm flex-shrink-0"
            aria-label="Hide the getting-started checklist"
            title="Hide the checklist — Home can show it again"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
      {sampleState.phase === 'error' && (
        <div
          role="alert"
          className="border-t border-border-muted bg-svn-conflict/10 px-3 py-1.5 text-12 text-svn-conflict"
          data-testid="sample-repo-error"
        >
          <span className="break-words">{sampleState.message}</span>
        </div>
      )}
      {expanded && (
        <ul id="onboarding-checklist-steps" className="list-none border-t border-border-muted">
          {steps.map((step) => {
            const Icon = step.icon;
            const busy = isBusy(step);
            return (
              <li
                key={step.id}
                className="flex min-h-row items-center gap-3 border-b border-border-muted px-3 py-2 last:border-b-0"
              >
                {step.done ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="h-4 w-4 flex-shrink-0 text-svn-normal"
                  />
                ) : (
                  <Circle aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-text-faint" />
                )}
                <Icon
                  aria-hidden="true"
                  className="hidden h-4 w-4 flex-shrink-0 text-text-muted sm:block"
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={`block text-13 font-medium ${
                      step.done ? 'text-text-muted' : 'text-text'
                    }`}
                  >
                    {step.title}
                  </span>
                  {!step.done && (
                    <span className="block text-12 text-text-muted">
                      {step.comingSoon ? 'Coming soon' : step.detail}
                      {step.command && (
                        <span className="ml-1.5 font-mono text-11 text-text-muted">
                          {step.command}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => runStep(step)}
                  disabled={step.done || step.comingSoon || busy}
                  className={`btn btn-sm flex-shrink-0 ${step.done ? 'btn-ghost' : 'btn-secondary'}`}
                  aria-label={
                    step.comingSoon
                      ? `${step.title} (coming soon)`
                      : busy
                        ? `${step.title} (creating…)`
                        : `Go: ${step.title}`
                  }
                  title={
                    step.done ? 'Done' : busy ? 'Creating the sample repository…' : step.detail
                  }
                >
                  {step.done ? 'Done' : step.comingSoon ? 'Soon' : busy ? 'Creating…' : 'Go'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
