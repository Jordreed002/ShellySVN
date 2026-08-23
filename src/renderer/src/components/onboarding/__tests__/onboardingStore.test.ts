/**
 * Onboarding store (#88): strict parsing, idempotent seen-done recording, and
 * the dismiss/reopen cycle — all against the window.api.store bridge.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';

import {
  DEFAULT_ONBOARDING_CHECKLIST,
  dismissOnboardingChecklist,
  ensureOnboardingHydrated,
  getOnboardingChecklist,
  markOnboardingStepsDone,
  ONBOARDING_CHECKLIST_KEY,
  parseOnboardingChecklist,
  reopenOnboardingChecklist,
  resetOnboardingChecklistForTests,
  withStepsSeenDone,
} from '../../../lib/onboardingStore';

const written: Array<[string, unknown]> = [];

beforeEach(() => {
  window.api = createMockElectronAPI();
  written.length = 0;
  const data = new Map<string, unknown>();
  window.api.store.get = vi.fn(async (key: string) => data.get(key));
  window.api.store.set = vi.fn(async (key: string, value: unknown) => {
    data.set(key, value);
    written.push([key, value]);
  });
  resetOnboardingChecklistForTests();
});

describe('parseOnboardingChecklist', () => {
  it('returns defaults for malformed payloads', () => {
    expect(parseOnboardingChecklist(null)).toEqual(DEFAULT_ONBOARDING_CHECKLIST);
    expect(parseOnboardingChecklist('nope')).toEqual(DEFAULT_ONBOARDING_CHECKLIST);
    expect(parseOnboardingChecklist([1, 2])).toEqual(DEFAULT_ONBOARDING_CHECKLIST);
  });

  it('keeps valid completions and drops malformed ones', () => {
    const parsed = parseOnboardingChecklist({
      version: 1,
      dismissed: true,
      completedAt: { 'first-commit': '2026-08-01T00:00:00.000Z', bad: 42 },
    });
    expect(parsed.dismissed).toBe(true);
    expect(parsed.completedAt).toEqual({ 'first-commit': '2026-08-01T00:00:00.000Z' });
  });
});

describe('withStepsSeenDone', () => {
  it('is idempotent per step and stamps new completions', () => {
    const first = withStepsSeenDone(DEFAULT_ONBOARDING_CHECKLIST, ['first-update'], new Date('2026-08-01T00:00:00Z'));
    expect(first.completedAt['first-update']).toBe('2026-08-01T00:00:00.000Z');
    const again = withStepsSeenDone(first, ['first-update'], new Date('2026-08-02T00:00:00Z'));
    expect(again).toBe(first); // no new object — nothing changed
  });
});

describe('module store', () => {
  it('hydrates from the persisted payload', async () => {
    await window.api.store.set(ONBOARDING_CHECKLIST_KEY, {
      version: 1,
      dismissed: true,
      completedAt: { 'open-working-copy': '2026-08-01T00:00:00.000Z' },
    });
    await ensureOnboardingHydrated();
    expect(getOnboardingChecklist().dismissed).toBe(true);
    expect(getOnboardingChecklist().completedAt['open-working-copy']).toBe(
      '2026-08-01T00:00:00.000Z'
    );
  });

  it('persists dismiss, reopen and seen-done marks', () => {
    dismissOnboardingChecklist();
    expect(getOnboardingChecklist().dismissed).toBe(true);
    reopenOnboardingChecklist();
    expect(getOnboardingChecklist().dismissed).toBe(false);

    markOnboardingStepsDone(['first-update', 'first-commit']);
    markOnboardingStepsDone(['first-update']); // idempotent
    expect(Object.keys(getOnboardingChecklist().completedAt).sort()).toEqual([
      'first-commit',
      'first-update',
    ]);

    const keys = written.map(([key]) => key);
    expect(keys.every((key) => key === ONBOARDING_CHECKLIST_KEY)).toBe(true);
  });

  it('degrades to defaults when the store read fails', async () => {
    window.api.store.get = vi.fn().mockRejectedValue(new Error('unavailable'));
    await ensureOnboardingHydrated();
    expect(getOnboardingChecklist()).toEqual(DEFAULT_ONBOARDING_CHECKLIST);
  });
});
