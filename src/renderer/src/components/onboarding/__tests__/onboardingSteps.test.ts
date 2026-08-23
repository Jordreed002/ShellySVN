/**
 * Onboarding checklist derivation (#88): steps check themselves from app state
 * the app already has — recents, the svn command timeline, the review-center
 * event — and stay checked across sessions once persisted.
 */

import { describe, expect, it } from 'vitest';

import {
  deriveOnboardingSteps,
  doneStepIdsToRecord,
  ONBOARDING_STEPS,
} from '../onboardingSteps';

function stepsFor(observations: Parameters<typeof deriveOnboardingSteps>[0]) {
  return deriveOnboardingSteps(observations, {});
}

describe('deriveOnboardingSteps', () => {
  it('marks every step undone for a fresh machine with no history', () => {
    const steps = stepsFor({
      recentRepoCount: 0,
      successfulOperations: new Set(),
      reviewCenterOpened: false,
    });
    expect(steps.map((step) => step.done)).toEqual(ONBOARDING_STEPS.map(() => false));
  });

  it('checks "Open a working copy" from settings recents', () => {
    const steps = stepsFor({
      recentRepoCount: 1,
      successfulOperations: new Set(),
      reviewCenterOpened: false,
    });
    expect(steps.find((step) => step.id === 'open-working-copy')?.done).toBe(true);
  });

  it('checks update/commit from successful svn command timeline operations', () => {
    const steps = stepsFor({
      recentRepoCount: 0,
      successfulOperations: new Set(['update', 'commit']),
      reviewCenterOpened: false,
    });
    expect(steps.find((step) => step.id === 'first-update')?.done).toBe(true);
    expect(steps.find((step) => step.id === 'first-commit')?.done).toBe(true);
  });

  it('does not check update from a failed or unrelated operation', () => {
    const steps = stepsFor({
      recentRepoCount: 0,
      successfulOperations: new Set(['update-failed-is-not-update', 'status']),
      reviewCenterOpened: false,
    });
    expect(steps.find((step) => step.id === 'first-update')?.done).toBe(false);
  });

  it('checks the review-center step from the open event', () => {
    const steps = stepsFor({
      recentRepoCount: 0,
      successfulOperations: new Set(),
      reviewCenterOpened: true,
    });
    expect(steps.find((step) => step.id === 'review-center')?.done).toBe(true);
  });

  it('keeps persisted completions even when this session observes nothing', () => {
    const steps = deriveOnboardingSteps(
      { recentRepoCount: 0, successfulOperations: new Set(), reviewCenterOpened: false },
      { 'first-commit': '2026-08-01T00:00:00.000Z' }
    );
    expect(steps.find((step) => step.id === 'first-commit')?.done).toBe(true);
  });

  it('ships the sample-repo playground step marked coming soon', () => {
    const sample = ONBOARDING_STEPS.find((step) => step.id === 'sample-repo');
    expect(sample?.comingSoon).toBe(true);
    // And no observation can complete it.
    const steps = stepsFor({
      recentRepoCount: 9,
      successfulOperations: new Set(['update', 'commit']),
      reviewCenterOpened: true,
    });
    expect(steps.find((step) => step.id === 'sample-repo')?.done).toBe(false);
  });

  it('records only completable done steps', () => {
    const steps = stepsFor({
      recentRepoCount: 1,
      successfulOperations: new Set(['update', 'commit']),
      reviewCenterOpened: true,
    });
    expect(doneStepIdsToRecord(steps)).toEqual([
      'open-working-copy',
      'first-update',
      'first-commit',
      'review-center',
    ]);
  });
});
