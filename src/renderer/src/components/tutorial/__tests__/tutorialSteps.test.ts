import { describe, expect, it } from 'vitest';

import { TUTORIAL_STEPS, getTutorialStep, getTotalSteps } from '../tutorialSteps';

/**
 * J1 — Onboarding. The tutorial is the first thing a new user sees; these
 * guard the step registry so a reordered/renamed/duplicated step doesn't quietly
 * break the guided tour.
 */
describe('tutorialSteps', () => {
  it('exposes the canonical nine-step tour', () => {
    expect(getTotalSteps()).toBe(9);
    expect(TUTORIAL_STEPS).toHaveLength(9);
  });

  it('starts at Welcome and ends at Complete', () => {
    expect(TUTORIAL_STEPS[0].id).toBe('welcome');
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].id).toBe('complete');
  });

  it('has unique step ids', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every step has a title, description, icon, and component', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
      expect(typeof step.icon).toBe('object'); // lucide icon component
      expect(step.component).toBeDefined();
    }
  });

  it('looks up a step by id', () => {
    expect(getTutorialStep('commit-update')?.title).toBe('Commit & Update');
  });

  it('returns undefined for an unknown step id', () => {
    expect(getTutorialStep('does-not-exist')).toBeUndefined();
  });
});
