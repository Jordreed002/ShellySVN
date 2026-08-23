/**
 * OnboardingChecklist (#88) — the first-run checklist card on the home route.
 *
 * Every step auto-checks from state the app already has (settings recents, the
 * svn command timeline, the review-center open event — see
 * ./onboardingSteps.ts); nothing new is collected. Steps stay checked across
 * sessions (lib/onboardingStore.ts persists the seen-done record), the card is
 * dismissible, and the welcome screen (EmptyBriefing) can bring it back.
 *
 * The "Create a sample repo" step is shipped marked "coming soon": making a
 * playground needs a repository-create IPC (svnadmin create + checkout pair)
 * the preload bridge does not expose yet — see the coordination request.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, X } from 'lucide-react';

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
}

export function OnboardingChecklist({ onOpenWorkingCopy }: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const checklist = useSyncExternalStore(subscribeOnboardingChecklist, getOnboardingChecklist);

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
          break; // coming soon — the button is disabled
      }
    },
    [navigate, onOpenWorkingCopy, workingCopyPath]
  );

  // Hidden once dismissed or finished; the welcome screen can re-open it.
  if (checklist.dismissed || allDone) return null;

  return (
    <section
      aria-labelledby="onboarding-checklist-title"
      className="overflow-hidden rounded-10 border border-border bg-bg-secondary shadow-card"
      data-testid="onboarding-checklist"
    >
      <div className="flex h-control-md items-center gap-2 border-b border-border px-2.5">
        <h2 id="onboarding-checklist-title" className="eyebrow flex-shrink-0">
          Getting started
        </h2>
        <span className="min-w-0 flex-1 truncate font-mono text-10 text-text-muted">
          {doneCount} of {completable.length} done · checked from what the app already knows
        </span>
        <button
          type="button"
          onClick={dismissOnboardingChecklist}
          className="btn-icon-sm flex-shrink-0"
          aria-label="Hide the getting-started checklist"
          title="Hide the checklist — reopen it from the welcome screen"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <ul className="list-none">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className="flex min-h-row items-center gap-2.5 border-b border-border-muted px-2.5 py-1.5 last:border-b-0"
            >
              {step.done ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="h-4 w-4 flex-shrink-0 text-svn-normal"
                />
              ) : (
                <Circle aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-text-faint" />
              )}
              <Icon aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <span
                  className={`block truncate text-13 font-medium ${
                    step.done ? 'text-text-muted' : 'text-text'
                  }`}
                >
                  {step.title}
                </span>
                <span className="block truncate font-mono text-9.5 text-text-faint">
                  {step.comingSoon ? 'coming soon' : step.detail}
                </span>
              </div>
              {step.command && (
                <span
                  className="hidden flex-shrink-0 font-mono text-9.5 text-text-faint sm:inline"
                  title={step.command}
                >
                  {step.command}
                </span>
              )}
              <button
                type="button"
                onClick={() => runStep(step)}
                disabled={step.done || step.comingSoon}
                className="btn btn-secondary btn-sm flex-shrink-0 gap-1.5 text-10.5"
                aria-label={
                  step.comingSoon ? `${step.title} (coming soon)` : `Go: ${step.title}`
                }
                title={
                  step.comingSoon
                    ? 'Needs a repository-create IPC pair (svnadmin create + checkout) that is not exposed yet'
                    : step.done
                      ? 'Done'
                      : step.detail
                }
              >
                {step.done ? 'Done' : step.comingSoon ? 'Soon' : 'Go'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
