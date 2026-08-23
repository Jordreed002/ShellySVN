/**
 * Per-working-copy settings overrides (#90), persisted via `window.api.store`
 * under a versioned key (following `lib/shortcutStore.ts`).
 *
 * Resolution order for every advised field: working-copy override → linked
 * connection profile → global settings. The renderer surfaces the effective
 * value and its source; features that already read these stores consume them
 * where feasible. AI consent is NOT written here — its store lives at
 * `shellysvn:ai-consent:v1` and the settings UI only reads it (via the
 * existing aiConsent lib) so the toggle has exactly one write path.
 */

import type { AppSettings, ConnectionProfile, ProxySettings, WorkingCopyOverride } from '@shared/types';

import { readAiConsent } from '../features/ai-review-center/lib/aiConsent';
import { findSuggestedProfile } from './connectionProfiles';

export const WORKING_COPY_OVERRIDES_STORE_KEY = 'shellysvn:wc-overrides:v1';
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 500;

export type WorkingCopyOverrideMap = Record<string, WorkingCopyOverride>;

export interface WorkingCopyOverrideStorePayload {
  version: 1;
  overrides: WorkingCopyOverrideMap;
}

export type EffectiveProxySource = 'override' | 'profile' | 'global';

export interface EffectiveProxy {
  proxy: ProxySettings;
  source: EffectiveProxySource;
  /** Profile name when the value comes from a linked profile. */
  profileName?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeProxy(value: unknown): ProxySettings | undefined {
  if (!isPlainObject(value)) return undefined;
  const port =
    typeof value.port === 'number' && Number.isFinite(value.port)
      ? Math.min(Math.max(Math.trunc(value.port), 1), 65535)
      : 8080;
  return {
    enabled: value.enabled === true,
    host: typeof value.host === 'string' ? value.host.slice(0, 500) : '',
    port,
    username: typeof value.username === 'string' ? value.username.slice(0, 200) : '',
    password: typeof value.password === 'string' ? value.password.slice(0, 500) : '',
    bypassForLocal: value.bypassForLocal !== false,
  };
}

function optionalTrimmed(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

/** Validate an unknown store payload into a safe override map; never throws. */
export function parseWorkingCopyOverrides(value: unknown): WorkingCopyOverrideMap {
  const container = isPlainObject(value) ? (value.overrides ?? value) : undefined;
  if (!isPlainObject(container)) return {};
  const map: WorkingCopyOverrideMap = {};
  for (const [rawPath, entry] of Object.entries(container).slice(0, MAX_ENTRIES)) {
    if (rawPath === '__proto__' || rawPath === 'constructor' || rawPath === 'prototype') continue;
    const workingCopyPath = rawPath.slice(0, 1024);
    if (!workingCopyPath || !isPlainObject(entry)) continue;
    const profileId = optionalTrimmed(entry.profileId, 100);
    const credentialsProfileId = optionalTrimmed(entry.credentialsProfileId, 200);
    const proxy = sanitizeProxy(entry.proxy);
    map[workingCopyPath] = {
      version: 1,
      workingCopyPath,
      updatedAt:
        typeof entry.updatedAt === 'string' && entry.updatedAt ? entry.updatedAt.slice(0, 40) : new Date(0).toISOString(),
      ...(profileId ? { profileId } : {}),
      ...(proxy ? { proxy } : {}),
      ...(credentialsProfileId ? { credentialsProfileId } : {}),
      ...(typeof entry.aiOptIn === 'boolean' ? { aiOptIn: entry.aiOptIn } : {}),
    };
  }
  return map;
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
