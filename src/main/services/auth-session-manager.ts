import { randomBytes } from 'node:crypto';
import { getAuthCache } from '../auth-cache';

export interface AuthSessionRequest {
  realm: string;
  username: string;
  password: string;
  persistence: 'session' | 'stored';
}

interface SessionRecord {
  id: string;
  ownerId: number;
  realm: string;
  username: string;
  password: string;
  persistent: boolean;
  expiresAt: number | null;
  lastUsedAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const sessions = new Map<string, SessionRecord>();

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new Error(`Invalid ${label}`);
  }
  if (/\p{Cc}/u.test(value)) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function normalizeScope(value: string): string {
  const trimmed = requireText(value, 'authentication realm', 2048);
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

function scopeAllowsTarget(scope: string, target?: string): boolean {
  if (!target) return true;
  try {
    const scopeUrl = new URL(scope);
    const targetUrl = new URL(target);
    return scopeUrl.origin === targetUrl.origin;
  } catch {
    return scope === target;
  }
}

function publicSession(record: SessionRecord) {
  return {
    id: record.id,
    realm: record.realm,
    username: record.username,
    persistent: record.persistent,
    expiresAt: record.expiresAt === null ? null : new Date(record.expiresAt).toISOString(),
  };
}

function createRecord(
  ownerId: number,
  realm: string,
  username: string,
  password: string,
  persistent: boolean
): SessionRecord {
  const now = Date.now();
  const record: SessionRecord = {
    id: randomBytes(32).toString('hex'),
    ownerId,
    realm,
    username,
    password,
    persistent,
    expiresAt: persistent ? null : now + SESSION_TTL_MS,
    lastUsedAt: now,
  };
  sessions.set(record.id, record);
  return record;
}

export async function beginAuthSession(ownerId: number, request: AuthSessionRequest) {
  const realm = normalizeScope(request?.realm);
  const username = requireText(request?.username, 'username', 512);
  if (typeof request?.password !== 'string' || request.password.length > 16_384) {
    throw new Error('Invalid password');
  }
  if (request.persistence !== 'session' && request.persistence !== 'stored') {
    throw new Error('Invalid credential persistence');
  }
  const cache = getAuthCache();
  await cache.ready();
  const persistent = request.persistence === 'stored' && cache.isEncryptionAvailable();
  if (persistent) cache.set(realm, username, request.password);
  return publicSession(createRecord(ownerId, realm, username, request.password, persistent));
}

export async function resumeAuthSession(ownerId: number, realmValue: string) {
  const realm = normalizeScope(realmValue);
  const cache = getAuthCache();
  await cache.ready();
  const credential = cache.get(realm) ?? cache.findForUrl(realm);
  if (!credential) return null;
  return publicSession(
    createRecord(ownerId, realm, credential.username, credential.password, true)
  );
}

export function resolveAuthSession(
  ownerId: number,
  sessionId: string | undefined,
  target?: string
): { username: string; password: string } | undefined {
  if (!sessionId) return undefined;
  const record = sessions.get(sessionId);
  if (!record || record.ownerId !== ownerId) throw new Error('Invalid authentication session');
  if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    throw new Error('Authentication session expired');
  }
  if (!scopeAllowsTarget(record.realm, target)) {
    throw new Error('Authentication session does not match this repository');
  }
  record.lastUsedAt = Date.now();
  if (record.expiresAt !== null) record.expiresAt = record.lastUsedAt + SESSION_TTL_MS;
  return { username: record.username, password: record.password };
}

export function clearAuthSessions(ownerId?: number): void {
  if (ownerId === undefined) {
    sessions.clear();
    return;
  }
  for (const [id, record] of sessions) if (record.ownerId === ownerId) sessions.delete(id);
}

/**
 * Non-secret session summary for settings diagnostics (backlog item #37):
 * counts only — usernames, realms, and passwords never enter diagnostics.
 */
export function getAuthSessionStats(): { active: number; persistent: number } {
  const now = Date.now();
  let active = 0;
  let persistent = 0;
  for (const record of sessions.values()) {
    if (record.expiresAt !== null && record.expiresAt <= now) {
      continue; // Expired; pending lazy eviction, not reported as active.
    }
    active += 1;
    if (record.persistent) persistent += 1;
  }
  return { active, persistent };
}
