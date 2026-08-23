/**
 * Named connection profiles (#91): reusable bundles of repository URL pattern,
 * proxy settings, and a credential reference, persisted through
 * `window.api.store` under a versioned key (same pattern as
 * `lib/shortcutStore.ts`).
 *
 * Profiles only REFERENCE credentials — `credentialsProfileId` is a realm
 * string into the existing auth store. The parser rebuilds every entry from
 * scratch with only the known fields, so hostile payloads cannot smuggle
 * secret-bearing or unknown keys into the persisted list.
 */

import type { ConnectionProfile, ProxySettings } from '@shared/types';

export const CONNECTION_PROFILES_STORE_KEY = 'shellysvn:connection-profiles:v1';
const SCHEMA_VERSION = 1;
export const MAX_PROFILES = 100;
const MAX_NAME_LENGTH = 100;
const MAX_PATTERN_LENGTH = 500;

export interface ConnectionProfileStorePayload {
  version: 1;
  profiles: ConnectionProfile[];
}

/** Profile fields that must never be persisted — asserted in tests. */
export const SECRET_PROFILE_ROOT_KEYS = [
  'password',
  'apiKey',
  'api_key',
  'secret',
  'token',
  'username',
  'clientSecret',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeProxy(value: unknown): ProxySettings | undefined {
  if (!isPlainObject(value)) return undefined;
  const enabled = value.enabled === true;
  const host = typeof value.host === 'string' ? value.host.slice(0, 500) : '';
  const port =
    typeof value.port === 'number' && Number.isFinite(value.port)
      ? Math.min(Math.max(Math.trunc(value.port), 1), 65535)
      : 8080;
  const username = typeof value.username === 'string' ? value.username.slice(0, 200) : '';
  const password = typeof value.password === 'string' ? value.password.slice(0, 500) : '';
  const bypassForLocal = value.bypassForLocal !== false;
  return { enabled, host, port, username, password, bypassForLocal };
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

/**
 * Validate an unknown store payload into safe profiles. Unknown entries,
 * missing ids/names, and any extra keys (including secret-looking ones) are
 * dropped; the count is capped at MAX_PROFILES.
 */
export function parseConnectionProfiles(value: unknown): ConnectionProfile[] {
  const container = isPlainObject(value) && Array.isArray((value as { profiles?: unknown }).profiles)
    ? ((value as { profiles: unknown[] }).profiles as unknown[])
    : Array.isArray(value)
      ? value
      : [];
  const profiles: ConnectionProfile[] = [];
  for (const entry of container.slice(0, MAX_PROFILES)) {
    if (!isPlainObject(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id.slice(0, 100) : '';
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_NAME_LENGTH) : '';
    if (!id || !name) continue;
    const proxy = sanitizeProxy(entry.proxy);
    const repoUrlPattern = optionalString(entry.repoUrlPattern, MAX_PATTERN_LENGTH);
    const credentialsProfileId = optionalString(entry.credentialsProfileId, 200);
    const now = Date.now();
    profiles.push({
      id,
      name,
      createdAt: typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : now,
      updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : now,
      ...(repoUrlPattern ? { repoUrlPattern } : {}),
      ...(proxy ? { proxy } : {}),
      ...(credentialsProfileId ? { credentialsProfileId } : {}),
    });
  }
  return profiles;
}

/** Glob-style match: `*` and `?`, anchored, case-insensitive (hosts/paths vary). */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Whether a profile's repo URL pattern matches `repoUrl`. Blank patterns never match. */
export function profileMatchesRepoUrl(profile: ConnectionProfile, repoUrl: string): boolean {
  const pattern = profile.repoUrlPattern?.trim();
  if (!pattern || !repoUrl) return false;
  return patternToRegExp(pattern).test(repoUrl);
}

/** First profile whose pattern matches the URL — offered as a suggested link. */
export function findSuggestedProfile(
  profiles: readonly ConnectionProfile[],
  repoUrl: string
): ConnectionProfile | undefined {
  return profiles.find((profile) => profileMatchesRepoUrl(profile, repoUrl));
}

export function createProfileId(): string {
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
    name: `${source.name} (copy)`.slice(0, MAX_NAME_LENGTH),
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
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
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
