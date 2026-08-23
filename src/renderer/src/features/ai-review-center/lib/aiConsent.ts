import type { AiWorkingCopyConsent } from '@shared/types';

/**
 * Per-working-copy AI consent (#113).
 *
 * Stored under one store key as `Record<workingCopyRoot, AiWorkingCopyConsent>`
 * and always written get-merge-set so concurrent writers cannot clobber other
 * working copies' entries. A working copy with no entry has never consented —
 * the UI renders "Not set" and asks.
 */

export const AI_CONSENT_STORE_KEY = 'shellysvn:ai-consent:v1';

export type AiConsentMap = Record<string, AiWorkingCopyConsent>;

interface ConsentIpc {
  get: (workingCopyPath: string) => Promise<AiWorkingCopyConsent | null>;
  set: (workingCopyPath: string, aiEnabled: boolean) => Promise<{ success: boolean }>;
}

/**
 * The dedicated consent IPC (preferred — same storage, main-process gating)
 * when the preload surface exposes it; older surfaces fall back to the raw
 * store key below.
 */
function consentIpc(): ConsentIpc | null {
  const api = (
    window.api as { ai?: { consent?: Partial<ConsentIpc> } } | undefined
  )?.ai?.consent;
  if (api && typeof api.get === 'function' && typeof api.set === 'function') {
    return api as ConsentIpc;
  }
  return null;
}

function isConsentEntry(value: unknown): value is AiWorkingCopyConsent {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AiWorkingCopyConsent>;
  return typeof entry.aiEnabled === 'boolean' && typeof entry.updatedAt === 'string';
}

/** Validate whatever the store returned into a safe consent map. */
export function parseAiConsentMap(value: unknown): AiConsentMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const map: AiConsentMap = {};
  for (const [root, entry] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    if (root && isConsentEntry(entry)) map[root.slice(0, 1024)] = entry;
  }
  return map;
}

/** Pure merge used by the writer — exported for tests. */
export function mergeAiConsentEntry(
  map: AiConsentMap,
  workingCopyRoot: string,
  aiEnabled: boolean,
  now = new Date()
): AiConsentMap {
  return {
    ...map,
    [workingCopyRoot]: { aiEnabled, updatedAt: now.toISOString() },
  };
}

/** Pure removal — returns to the "Not set" state for one working copy. */
export function removeAiConsentEntry(map: AiConsentMap, workingCopyRoot: string): AiConsentMap {
  if (!(workingCopyRoot in map)) return map;
  const next = { ...map };
  delete next[workingCopyRoot];
  return next;
}

/** Read the consent entry for one working copy; undefined means "Not set". */
export async function readAiConsent(
  workingCopyRoot: string
): Promise<AiWorkingCopyConsent | undefined> {
  if (!workingCopyRoot) return undefined;
  const ipc = consentIpc();
  if (ipc) {
    try {
      return (await ipc.get(workingCopyRoot)) ?? undefined;
    } catch {
      // Fall through to the store key on IPC failure.
    }
  }
  const stored = await window.api.store.get<unknown>(AI_CONSENT_STORE_KEY);
  return parseAiConsentMap(stored)[workingCopyRoot];
}

/** Get-merge-set one working copy's consent, preserving all other entries. */
export async function writeAiConsent(
  workingCopyRoot: string,
  aiEnabled: boolean
): Promise<AiWorkingCopyConsent> {
  const ipc = consentIpc();
  if (ipc) {
    try {
      await ipc.set(workingCopyRoot, aiEnabled);
      return (
        (await ipc.get(workingCopyRoot)) ?? {
          aiEnabled,
          updatedAt: new Date().toISOString(),
        }
      );
    } catch {
      // Fall through to the store key on IPC failure.
    }
  }
  const stored = await window.api.store.get<unknown>(AI_CONSENT_STORE_KEY);
  const next = mergeAiConsentEntry(parseAiConsentMap(stored), workingCopyRoot, aiEnabled);
  await window.api.store.set(AI_CONSENT_STORE_KEY, next);
  return next[workingCopyRoot]!;
}

/** Remove one working copy's entry (back to "Not set"), preserving all others. */
export async function clearAiConsent(workingCopyRoot: string): Promise<void> {
  const stored = await window.api.store.get<unknown>(AI_CONSENT_STORE_KEY);
  await window.api.store.set(AI_CONSENT_STORE_KEY, removeAiConsentEntry(parseAiConsentMap(stored), workingCopyRoot));
}
