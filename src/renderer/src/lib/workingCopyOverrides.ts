/**
 * Per-working-copy settings overrides (#90), persisted via `window.api.store`
 * under a versioned key (following `lib/shortcutStore.ts`).
 *
 * Resolution order for every advised field: working-copy override → linked
 * connection profile → global settings. The renderer surfaces the effective
 * value and its source; the MAIN process resolves the same stores for every
 * SVN command it runs (see `@shared/wc-connection-settings`, the single
 * source of truth for parsing and precedence, consumed by main's
 * wc-operation-context service). AI consent is NOT written here — its store
 * lives at `shellysvn:ai-consent:v1` and the settings UI only reads it (via
 * the existing aiConsent lib) so the toggle has exactly one write path.
 */

import type { AppSettings, ConnectionProfile, ProxySettings, WorkingCopyOverride } from '@shared/types';

import {
  WORKING_COPY_OVERRIDES_STORE_KEY,
  parseWorkingCopyOverrides,
  type WorkingCopyOverrideMap,
  type WorkingCopyOverrideStorePayload,
} from '@shared/wc-connection-settings';
import { readAiConsent } from '../features/ai-review-center/lib/aiConsent';
import { findSuggestedProfile } from './connectionProfiles';

// Re-exported for existing callers (tests, settings UI); the implementations
// are shared with the main process.
export {
  WORKING_COPY_OVERRIDES_STORE_KEY,
  parseWorkingCopyOverrides,
  normalizeWcPathKey,
  type WorkingCopyOverrideMap,
  type WorkingCopyOverrideStorePayload,
} from '@shared/wc-connection-settings';

const SCHEMA_VERSION = 1;

export type EffectiveProxySource = 'override' | 'profile' | 'global';

export interface EffectiveProxy {
  proxy: ProxySettings;
  source: EffectiveProxySource;
  /** Profile name when the value comes from a linked profile. */
  profileName?: string;
}

/** Insert or replace one working copy's override (get-merge-set friendly). */
export function upsertOverride(
  map: WorkingCopyOverrideMap,
  workingCopyPath: string,
  patch: Omit<WorkingCopyOverride, 'version' | 'workingCopyPath' | 'updatedAt'>
): WorkingCopyOverrideMap {
  return {
    ...map,
    [workingCopyPath]: {
      version: 1,
      workingCopyPath,
      updatedAt: new Date().toISOString(),
      ...patch,
    },
  };
}

export function removeOverride(
  map: WorkingCopyOverrideMap,
  workingCopyPath: string
): WorkingCopyOverrideMap {
  if (!(workingCopyPath in map)) return { ...map };
  const next = { ...map };
  delete next[workingCopyPath];
  return next;
}

/**
 * Effective proxy for a working copy: override.proxy → linked profile.proxy →
 * the global proxy settings. Returns the winning value plus its source so the
 * UI can label inherited vs overridden values honestly.
 */
export function resolveEffectiveProxy(
  globalProxy: ProxySettings,
  profiles: readonly ConnectionProfile[],
  overrides: WorkingCopyOverrideMap,
  workingCopyPath: string
): EffectiveProxy {
  const override = overrides[workingCopyPath];
  if (override?.proxy) {
    return { proxy: override.proxy, source: 'override' };
  }
  const profile = override?.profileId
    ? profiles.find((candidate) => candidate.id === override.profileId)
    : undefined;
  if (profile?.proxy) {
    return { proxy: profile.proxy, source: 'profile', profileName: profile.name };
  }
  return { proxy: globalProxy, source: 'global' };
}

export type EffectiveCredentialSource = 'override' | 'profile' | 'default';

export interface EffectiveCredential {
  credentialsProfileId?: string;
  source: EffectiveCredentialSource;
  profileName?: string;
}

/**
 * Effective credential reference: override.credentialsProfileId → linked
 * profile.credentialsProfileId → repository default (undefined). References
 * only; secrets stay in the auth store.
 */
export function resolveEffectiveCredential(
  profiles: readonly ConnectionProfile[],
  overrides: WorkingCopyOverrideMap,
  workingCopyPath: string
): EffectiveCredential {
  const override = overrides[workingCopyPath];
  if (override?.credentialsProfileId) {
    return { credentialsProfileId: override.credentialsProfileId, source: 'override' };
  }
  const profile = override?.profileId
    ? profiles.find((candidate) => candidate.id === override.profileId)
    : undefined;
  if (profile?.credentialsProfileId) {
    return {
      credentialsProfileId: profile.credentialsProfileId,
      source: 'profile',
      profileName: profile.name,
    };
  }
  return { source: 'default' };
}

/**
 * Known working copies for the settings list: repository recents plus
 * bookmarks, deduped (bookmarks keep their starred order first).
 */
export function listKnownWorkingCopies(settings: AppSettings): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of [...settings.bookmarks.map((bookmark) => bookmark.path), ...settings.recentRepositories]) {
    const normalized = path?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

/** Suggested profile for a working copy's repository URL, if any pattern matches. */
export function suggestedProfileForWorkingCopy(
  profiles: readonly ConnectionProfile[],
  repoUrl: string | undefined
): ConnectionProfile | undefined {
  if (!repoUrl) return undefined;
  return findSuggestedProfile(profiles, repoUrl);
}

export type AiOptInState = 'enabled' | 'disabled' | 'unset';

/**
 * Read-only view of the per-working-copy AI consent (single write path stays
 * with the consent toggle). Undefined/failed reads render as "unset".
 */
export async function readAiOptInState(workingCopyPath: string): Promise<AiOptInState> {
  try {
    const consent = await readAiConsent(workingCopyPath);
    if (!consent) return 'unset';
    return consent.aiEnabled ? 'enabled' : 'disabled';
  } catch {
    return 'unset';
  }
}

/** Load the override map; storage failures degrade to empty. */
export async function loadWorkingCopyOverrides(): Promise<WorkingCopyOverrideMap> {
  try {
    const stored = await window.api?.store?.get<unknown>(WORKING_COPY_OVERRIDES_STORE_KEY);
    return parseWorkingCopyOverrides(stored);
  } catch {
    return {};
  }
}

/** Persist the map inside the versioned envelope. */
export async function saveWorkingCopyOverrides(map: WorkingCopyOverrideMap): Promise<void> {
  const payload: WorkingCopyOverrideStorePayload = {
    version: SCHEMA_VERSION,
    overrides: parseWorkingCopyOverrides(map),
  };
  await window.api?.store?.set(WORKING_COPY_OVERRIDES_STORE_KEY, payload);
}

/** Get-merge-set one working copy's override, preserving all other entries. */
export async function persistOverride(
  workingCopyPath: string,
  patch: Omit<WorkingCopyOverride, 'version' | 'workingCopyPath' | 'updatedAt'>
): Promise<WorkingCopyOverrideMap> {
  const current = await loadWorkingCopyOverrides();
  const next = upsertOverride(current, workingCopyPath, patch);
  await saveWorkingCopyOverrides(next);
  return next;
}

/** Remove one working copy's override (back to fully inherited). */
export async function persistOverrideRemoval(workingCopyPath: string): Promise<WorkingCopyOverrideMap> {
  const current = await loadWorkingCopyOverrides();
  const next = removeOverride(current, workingCopyPath);
  await saveWorkingCopyOverrides(next);
  return next;
}
