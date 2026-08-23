/**
 * Onboarding checklist steps (#88) — the derivation half.
 *
 * Every step is checked from facts the app already has:
 *
 * - "Open a working copy" — settings.recentRepositories is non-empty;
 * - "Run your first update" / "Commit a change" — the svn command timeline
 *   (main-process record of every svn invocation, `svn:commandTimeline`)
 *   contains a successful `update` / `commit`;
 * - "Open the Review Center" — the review-center open event fired (the same
 *   event the command palette dispatches), or the step's own CTA was used;
 * - "Create a sample repo" — needs a repo-create IPC pair that does not exist
 *   yet (see the coordination request): shipped marked "coming soon".
 *
 * No new telemetry: observations come from state that exists for other
 * reasons, and once a step is seen done the timestamp is persisted (via
 * lib/onboardingStore.ts) so the timeline's session scope cannot un-complete
 * a step.
 */

import type { ComponentType } from 'react';
import { FolderOpen, Download, Upload, BrainCircuit, FlaskConical } from 'lucide-react';

export type OnboardingStepId =
  | 'open-working-copy'
  | 'first-update'
  | 'first-commit'
  | 'review-center'
  | 'sample-repo';

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  title: string;
  /** What the step means, in Subversion's vocabulary. */
  detail: string;
  icon: ComponentType<{ className?: string }>;
  /** The svn command behind the step, shown mono beside it. */
  command?: string;
  /** Not completable yet — an IPC this app does not expose. */
  comingSoon?: boolean;
}

export const ONBOARDING_STEPS: readonly OnboardingStepDefinition[] = [
  {
    id: 'open-working-copy',
    title: 'Open a working copy',
    detail: 'A folder that is already a Subversion checkout, or a fresh svn checkout.',
    icon: FolderOpen,
  },
  {
    id: 'first-update',
    title: 'Run your first update',
    detail: 'Bring a working copy up to date with the repository.',
    icon: Download,
    command: 'svn update',
  },
  {
    id: 'first-commit',
    title: 'Commit a change',
    detail: 'Send a local change to the repository as a new revision.',
    icon: Upload,
    command: 'svn commit',
  },
  {
    id: 'review-center',
    title: 'Open the Review Center',
    detail: 'Where AI review findings and commit plans are collected.',
    icon: BrainCircuit,
  },
  {
    id: 'sample-repo',
    title: 'Create a sample repo playground',
    detail: 'A throwaway local repository with sample content to try things on.',
    icon: FlaskConical,
    comingSoon: true,
  },
];

/** What the app can observe without collecting anything new. */
export interface OnboardingObservations {
  /** settings.recentRepositories.length — a working copy was opened. */
  recentRepoCount: number;
  /** svn operations that succeeded this session, from the command timeline. */
  successfulOperations: ReadonlySet<string>;
  /** The review center was opened (event observed or CTA used). */
  reviewCenterOpened: boolean;
}

export interface OnboardingStepState extends OnboardingStepDefinition {
  done: boolean;
}

/**
 * Fold observations + the persisted seen-done record into per-step done flags.
 * A step is done when it was seen done before (persisted) OR the current
 * observations say so — the caller persists newly observed completions so the
 * result is stable across sessions.
 */
export function deriveOnboardingSteps(
  observations: OnboardingObservations,
  seenDone: Readonly<Record<string, string>>
): OnboardingStepState[] {
  return ONBOARDING_STEPS.map((step) => {
    let done = Boolean(seenDone[step.id]);
    if (!done) {
      switch (step.id) {
        case 'open-working-copy':
          done = observations.recentRepoCount > 0;
          break;
        case 'first-update':
          done = observations.successfulOperations.has('update');
          break;
        case 'first-commit':
          done = observations.successfulOperations.has('commit');
          break;
        case 'review-center':
          done = observations.reviewCenterOpened;
          break;
        case 'sample-repo':
          done = false; // coming soon — nothing observable yet
          break;
      }
    }
    return { ...step, done };
  });
}

/**
 * The done step ids worth recording: every completable (non-coming-soon) step
 * currently done. Persistence is idempotent, so re-recording is a no-op.
 */
export function doneStepIdsToRecord(steps: readonly OnboardingStepState[]): OnboardingStepId[] {
  return steps
    .filter((step) => step.done && !step.comingSoon)
    .map((step) => step.id) as OnboardingStepId[];
}
