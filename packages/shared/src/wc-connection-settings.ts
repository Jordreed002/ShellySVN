/**
 * Per-working-copy connection overrides (#90/#91) — pure store shapes and
 * resolution rules shared by the renderer settings UI and the main-process
 * SVN executor, so a value saved in settings can never route one way in the
 * UI preview and another way at spawn time (same single-source pattern as
 * `external-tool-templates.ts`).
 *
 * Both stores are persisted through the renderer's `window.api.store` (and
 * read main-side via `getStore()`); the main process only ever READS them —
 * writes stay with the settings UI.
 *
 * Resolution order for every advised field: working-copy override → linked
 * connection profile → (for repository-URL operations) URL-pattern-matched
 * profile → global settings. Profiles REFERENCE credentials
 * (`credentialsProfileId` is a realm string into the existing auth store) —
 * nothing here stores or handles secret material beyond the proxy password,
 * exactly like the global proxy settings.
 */

import type { ConnectionProfile, ProxySettings, SvnExecutionContext, WorkingCopyOverride } from './types';

export const WORKING_COPY_OVERRIDES_STORE_KEY = 'shellysvn:wc-overrides:v1';
export const CONNECTION_PROFILES_STORE_KEY = 'shellysvn:connection-profiles:v1';

const MAX_OVERRIDE_ENTRIES = 500;
export const MAX_PROFILES = 100;
const MAX_NAME_LENGTH = 100;
const MAX_PATTERN_LENGTH = 500;

export type WorkingCopyOverrideMap = Record<string, WorkingCopyOverride>;

export interface WorkingCopyOverrideStorePayload {
  version: 1;
  overrides: WorkingCopyOverrideMap;
}

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
  for (const [rawPath, entry] of Object.entries(container).slice(0, MAX_OVERRIDE_ENTRIES)) {
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
    const repoUrlPattern = optionalTrimmed(entry.repoUrlPattern, MAX_PATTERN_LENGTH);
    const credentialsProfileId = optionalTrimmed(entry.credentialsProfileId, 200);
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

/**
 * Lookup key for override-map entries. The renderer keys the map by whatever
 * path string it listed the working copy under, which can differ from the
 * executor's resolved absolute path by separator or drive-letter case on
 * Windows — normalize both sides before comparing (never compare a joined
 * Windows path against a posix literal).
 */
export function normalizeWcPathKey(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Index an override map by `normalizeWcPathKey` for separator/case-insensitive lookup. */
export function indexOverridesByPath(
  overrides: WorkingCopyOverrideMap
): Map<string, WorkingCopyOverride> {
  const index = new Map<string, WorkingCopyOverride>();
  for (const override of Object.values(overrides)) {
    if (!override?.workingCopyPath) continue;
    index.set(normalizeWcPathKey(override.workingCopyPath), override);
  }
  return index;
}

export type WcOperationContextSource = 'override' | 'profile' | 'url-profile' | 'none';

export interface ResolvedWcOperationContext {
  /** Fields the override/profile advise; anything absent falls through to global settings. */
  context: Partial<SvnExecutionContext>;
  /** Auth-store realm the resolved override/profile references, if any (never a secret). */
  credentialsProfileId?: string;
  source: WcOperationContextSource;
  /** Profile name when a profile supplied the values (for logging/UI parity). */
  profileName?: string;
}

const NONE: ResolvedWcOperationContext = { context: {}, source: 'none' };

function contextFrom(
  proxy: ProxySettings | undefined,
  credentialsProfileId: string | undefined,
  source: WcOperationContextSource,
  profileName?: string
): ResolvedWcOperationContext {
  return {
    context: proxy ? { proxySettings: proxy } : {},
    ...(credentialsProfileId ? { credentialsProfileId } : {}),
    source,
    ...(profileName ? { profileName } : {}),
  };
}

/**
 * Effective per-operation context (#90 completion): working-copy override →
 * override's linked profile → URL-pattern-matched profile → nothing (global
 * settings apply). `workingCopyPath` should already be the working-copy ROOT
 * (walk up to `.svn` before calling — see main's wc-operation-context service).
 */
export function resolveWcOperationContext(input: {
  overrides: WorkingCopyOverrideMap;
  profiles: readonly ConnectionProfile[];
  workingCopyPath?: string;
  repoUrl?: string;
}): ResolvedWcOperationContext {
  const override = input.workingCopyPath
    ? indexOverridesByPath(input.overrides).get(normalizeWcPathKey(input.workingCopyPath))
    : undefined;

  if (override) {
    const linked = override.profileId
      ? input.profiles.find((profile) => profile.id === override.profileId)
      : undefined;
    const proxy = override.proxy ?? linked?.proxy;
    const credentialsProfileId = override.credentialsProfileId ?? linked?.credentialsProfileId;
    if (override.proxy || override.credentialsProfileId) {
      // The override pins at least one field itself; unpinned fields still
      // fall through to the linked profile before reaching global settings.
      return contextFrom(proxy, credentialsProfileId, 'override', linked?.name);
    }
    // An override that only links a profile still routes through the profile.
    if (proxy || credentialsProfileId) {
      return contextFrom(proxy, credentialsProfileId, 'profile', linked?.name);
    }
  }

  if (input.repoUrl) {
    const matched = findSuggestedProfile(input.profiles, input.repoUrl);
    if (matched && (matched.proxy || matched.credentialsProfileId)) {
      return contextFrom(matched.proxy, matched.credentialsProfileId, 'url-profile', matched.name);
    }
  }

  return NONE;
}
