/**
 * Onboarding checklist state (#88) — the seen-state half of the checklist.
 *
 * What the checklist KNOWS is derived, never collected: each step is
 * auto-checked from app state the app already has (settings recents, the svn
 * command timeline, the review-center open event). This store only persists
 * what has been *seen done* (a step completed in a previous session stays
 * completed) plus the dismiss flag — the same `window.api.store` bridge and
 * the same versioned-payload discipline as `lib/logViews.ts`.
 *
 * The store is a small module-level external store (`useSyncExternalStore`)
 * rather than a query because two home surfaces need it at once: the checklist
 * card and the welcome screen's re-open affordance.
 */

/* ── state shape ──────────────────────────────────────────────────────────── */

export interface OnboardingChecklistState {
  version: 1;
  /** True once the user dismissed the checklist card. Re-openable. */
  dismissed: boolean;
  /** Step ids seen done, with the ISO timestamp of when they were recorded. */
  completedAt: Record<string, string>;
}

export const ONBOARDING_CHECKLIST_KEY = 'shellysvn:onboarding-checklist:v1';

export const DEFAULT_ONBOARDING_CHECKLIST: OnboardingChecklistState = {
  version: 1,
  dismissed: false,
  completedAt: {},
};

/** Strict parse of whatever the store hands back; anything else is defaults. */
export function parseOnboardingChecklist(value: unknown): OnboardingChecklistState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_ONBOARDING_CHECKLIST };
  }
  const { dismissed, completedAt } = value as Record<string, unknown>;
  const parsed: Record<string, string> = {};
  if (completedAt && typeof completedAt === 'object' && !Array.isArray(completedAt)) {
    for (const [stepId, at] of Object.entries(completedAt as Record<string, unknown>)) {
      if (typeof at === 'string' && at) parsed[stepId] = at;
    }
  }
  return {
    version: 1,
    dismissed: dismissed === true,
    completedAt: parsed,
  };
}

/** Record that steps were seen done (ids already recorded are left as-is). */
export function withStepsSeenDone(
  state: OnboardingChecklistState,
  stepIds: readonly string[],
  now: Date = new Date()
): OnboardingChecklistState {
  const fresh = stepIds.filter((id) => !state.completedAt[id]);
  if (fresh.length === 0) return state;
  const completedAt = { ...state.completedAt };
  for (const id of fresh) completedAt[id] = now.toISOString();
  return { ...state, completedAt };
}

/* ── module store ─────────────────────────────────────────────────────────── */

let state: OnboardingChecklistState = { ...DEFAULT_ONBOARDING_CHECKLIST };
const listeners = new Set<() => void>();
let hydration: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

/** Read (and hydrate) the persisted checklist. Safe to call repeatedly. */
export function ensureOnboardingHydrated(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const stored = await window.api?.store?.get<unknown>(ONBOARDING_CHECKLIST_KEY);
      state = parseOnboardingChecklist(stored);
      emit();
    } catch {
      // An unreadable store degrades to defaults for this session.
    }
  })();
  return hydration;
}

function persist(next: OnboardingChecklistState): void {
  const previous = state;
  state = next;
  emit();
  void window.api?.store?.set(ONBOARDING_CHECKLIST_KEY, next).catch(() => {
    // Persistence failure should not unwind the session's state.
    void previous;
  });
}

/** `useSyncExternalStore` wiring for React consumers. */
export function subscribeOnboardingChecklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOnboardingChecklist(): OnboardingChecklistState {
  return state;
}

/* ── actions ──────────────────────────────────────────────────────────────── */

/** Hide the checklist card; the welcome screen can bring it back. */
export function dismissOnboardingChecklist(): void {
  persist({ ...state, dismissed: true });
}

/** Bring the checklist card back (the welcome screen's affordance). */
export function reopenOnboardingChecklist(): void {
  persist({ ...state, dismissed: false });
}

/** Record steps as seen done. Idempotent per step. */
export function markOnboardingStepsDone(stepIds: readonly string[]): void {
  const next = withStepsSeenDone(state, stepIds);
  if (next === state) return;
  persist(next);
}

/** Test helper: reset the in-memory store to defaults (no persistence). */
export function resetOnboardingChecklistForTests(): void {
  state = { ...DEFAULT_ONBOARDING_CHECKLIST, completedAt: {} };
  hydration = null;
  emit();
}
