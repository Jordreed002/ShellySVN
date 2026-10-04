/**
 * Named connection profiles (#91): reusable bundles of repository URL pattern,
 * proxy settings, and a credential reference, persisted through
 * `window.api.store` under a versioned key (same pattern as
 * `lib/shortcutStore.ts`).
 *
 * The pure parsing/glob-matching half lives in `@shared/wc-connection-settings`
 * (single source of truth) so the main-process SVN executor resolves profiles
 * with exactly the rules this UI previews; this module keeps the store IO and
 * CRUD helpers. Profiles only REFERENCE credentials — `credentialsProfileId`
 * is a realm string into the existing auth store.
 */

import type { ConnectionProfile } from '@shared/types';

import {
  CONNECTION_PROFILES_STORE_KEY,
  MAX_PROFILES,
  parseConnectionProfiles,
  type ConnectionProfileStorePayload,
} from '@shared/wc-connection-settings';

// Re-exported for existing callers (tests, settings UI); the implementations
// are shared with the main process.
export {
  CONNECTION_PROFILES_STORE_KEY,
  MAX_PROFILES,
  parseConnectionProfiles,
  patternToRegExp,
  profileMatchesRepoUrl,
  findSuggestedProfile,
  SECRET_PROFILE_ROOT_KEYS,
  type ConnectionProfileStorePayload,
} from '@shared/wc-connection-settings';

const SCHEMA_VERSION = 1;

function createProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `profile-${crypto.randomUUID()}`;
  }
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createProfile(name: string): ConnectionProfile {
  const now = Date.now();
  return { id: createProfileId(), name, createdAt: now, updatedAt: now };
}

/** Insert or replace by id, preserving list order. */
export function upsertProfile(
  profiles: readonly ConnectionProfile[],
  profile: ConnectionProfile
): ConnectionProfile[] {
  const index = profiles.findIndex((candidate) => candidate.id === profile.id);
  if (index === -1) {
    return [...profiles.slice(0, MAX_PROFILES - 1), profile];
  }
  return profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate));
}

/** Copy a profile under a new id with a "(copy)" suffix. */
export function duplicateProfile(
  profiles: readonly ConnectionProfile[],
  profileId: string
): ConnectionProfile[] {
  const source = profiles.find((candidate) => candidate.id === profileId);
  if (!source) return [...profiles];
  const copy: ConnectionProfile = {
    ...source,
    id: createProfileId(),
    name: `${source.name} (copy)`.slice(0, 100),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return [...profiles.slice(0, MAX_PROFILES - 1), copy];
}

export function renameProfile(
  profiles: readonly ConnectionProfile[],
  profileId: string,
  name: string
): ConnectionProfile[] {
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return [...profiles];
  return profiles.map((candidate) =>
    candidate.id === profileId ? { ...candidate, name: trimmed, updatedAt: Date.now() } : candidate
  );
}

export function removeProfile(
  profiles: readonly ConnectionProfile[],
  profileId: string
): ConnectionProfile[] {
  return profiles.filter((candidate) => candidate.id !== profileId);
}

/** Load persisted profiles; storage failures degrade to an empty list. */
export async function loadConnectionProfiles(): Promise<ConnectionProfile[]> {
  try {
    const stored = await window.api?.store?.get<unknown>(CONNECTION_PROFILES_STORE_KEY);
    return parseConnectionProfiles(stored);
  } catch {
    return [];
  }
}

/** Persist the list inside the versioned envelope. */
export async function saveConnectionProfiles(profiles: readonly ConnectionProfile[]): Promise<void> {
  const payload: ConnectionProfileStorePayload = {
    version: SCHEMA_VERSION,
    profiles: parseConnectionProfiles(profiles),
  };
  await window.api?.store?.set(CONNECTION_PROFILES_STORE_KEY, payload);
}

/**
 * Re-read, apply `mutate`, and persist — a get-merge-set so concurrent writers
 * (e.g. two settings tabs) cannot clobber each other's rows.
 */
export async function mutateConnectionProfiles(
  mutate: (current: ConnectionProfile[]) => ConnectionProfile[]
): Promise<ConnectionProfile[]> {
  const current = await loadConnectionProfiles();
  const next = mutate(current);
  await saveConnectionProfiles(next);
  return next;
}
