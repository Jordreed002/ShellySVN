import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'path';

import { app } from 'electron';

import type { SslFailureKind } from '@shared/types';

import { debug } from '@shared/utils/debug';

/**
 * Certificate-failure kinds understood by svn's
 * `--trust-server-cert-failures` (plus 'other' for anything svn reports as an
 * unclassified certificate error — never trusted automatically by this app).
 * Declared in @shared/types (it crosses IPC with network-security
 * diagnostics); re-exported here for compatibility.
 */
export type { SslFailureKind } from '@shared/types';

/** Structured certificate failure (backlog item #38). */
export interface SslCertFailureInfo {
  /** Primary (most severe/specific) failure kind — expired wins over unknown-ca. */
  failureKind: SslFailureKind;
  /** Every failure kind detected in the message; combined failures are common. */
  failureKinds: SslFailureKind[];
  /** SHA-1 fingerprint when svn exposed one (only interactive prompts do). */
  fingerprint?: string;
  /** Host the failing certificate was presented for. */
  host: string;
  /** Certificate validity end, when svn exposed it (interactive prompt output). */
  validUntil?: string;
  /** Redaction-safe raw stderr (classification input). */
  rawMessage: string;
}

export type SslTrustDecision = 'accepted' | 'rejected';

export interface SslTrustDecisionEntry {
  realm: string;
  decision: SslTrustDecision;
  failures: string;
  failureKind?: SslFailureKind;
  fingerprint?: string;
  validUntil?: string;
}

interface CachedSslTrust {
  realm: string;
  failures: string;
  createdAt: number;
  /** Absent on legacy v1 entries — treated as 'accepted'. */
  decision?: SslTrustDecision;
  failureKind?: SslFailureKind;
  fingerprint?: string;
  validUntil?: string;
}

interface StoredSslTrustCache {
  version: number;
  trusts: CachedSslTrust[];
}

const FAILURE_KIND_PRIORITY: readonly SslFailureKind[] = [
  // Most dangerous/specific first: an expired or not-yet-valid certificate
  // must never be presented as a mere unknown-CA prompt, and must stay
  // distinguishable in diagnostics and the renderer.
  'expired',
  'not-yet-valid',
  'cn-mismatch',
  'unknown-ca',
  'other',
];

/** svn's trust option accepts these four kinds; 'other' is excluded on purpose. */
const TRUSTABLE_FAILURE_KINDS: readonly SslFailureKind[] = [
  'unknown-ca',
  'cn-mismatch',
  'expired',
  'not-yet-valid',
];

const FINGERPRINT_PATTERN = /fingerprint:?\s*([0-9a-f]{2}(?:[:\s][0-9a-f]{2}){4,})/i;
const VALID_UNTIL_PATTERN = /valid:?\s*from\b[^\n]*?\buntil\b\s+(.+)$/im;
const URL_IN_MESSAGE_PATTERN = /https?:\/\/([^/\s'"<>)]+)/i;

/** svn error text that proves a certificate-verification failure occurred. */
const CERT_FAILURE_EVIDENCE_PATTERN =
  /\bE230001\b|SSL certificate verification failed|certificate (?:has expired|is not yet valid|issued for a different hostname|revoked)|issuer is not trusted|not issued by a trusted authority|self[- ]signed certificate/i;

function classifyFailureKinds(message: string): SslFailureKind[] {
  const kinds = new Set<SslFailureKind>();

  if (/issuer is not trusted|not issued by a trusted authority|self[- ]signed/i.test(message)) {
    kinds.add('unknown-ca');
  }
  if (
    /certificate issued for a different hostname|hostname .* does not match|hostname mismatch|CN mismatch/i.test(
      message
    )
  ) {
    kinds.add('cn-mismatch');
  }
  if (/certificate has expired|certificate.*\bhas expired\b|\bhas expired\b/i.test(message)) {
    kinds.add('expired');
  }
  if (/not yet valid/i.test(message)) {
    kinds.add('not-yet-valid');
  }

  if (kinds.size === 0) {
    kinds.add('other');
  }
  // Deterministic severity-ordered output.
  return FAILURE_KIND_PRIORITY.filter((kind) => kinds.has(kind));
}

function primaryFailureKind(kinds: SslFailureKind[]): SslFailureKind {
  for (const kind of FAILURE_KIND_PRIORITY) {
    if (kinds.includes(kind)) {
      return kind;
    }
  }
  return 'other';
}

function extractHost(message: string, url?: string): string {
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.host) return parsed.host;
    } catch {
      // Fall through to message extraction.
    }
  }
  const urlMatch = message.match(URL_IN_MESSAGE_PATTERN);
  return urlMatch ? urlMatch[1] : 'unknown';
}

/**
 * Parse svn's certificate-failure stderr/rejection text into structured data
 * the renderer can present (backlog item #38). Returns null when the text is
 * not recognisable as a certificate-verification failure — callers must
 * refuse to trust in that case rather than guessing 'unknown-ca'.
 */
export function parseSslCertFailure(errorText: string, url?: string): SslCertFailureInfo | null {
  const message = (errorText || '').trim();
  if (!message || !CERT_FAILURE_EVIDENCE_PATTERN.test(message)) {
    return null;
  }

  const failureKinds = classifyFailureKinds(message);
  const fingerprintMatch = message.match(FINGERPRINT_PATTERN);
  const validUntilMatch = message.match(VALID_UNTIL_PATTERN);

  return {
    failureKind: primaryFailureKind(failureKinds),
    failureKinds,
    ...(fingerprintMatch
      ? { fingerprint: fingerprintMatch[1].replace(/\s+/g, ':').toUpperCase() }
      : {}),
    host: extractHost(message, url),
    ...(validUntilMatch ? { validUntil: validUntilMatch[1].trim() } : {}),
    rawMessage: message,
  };
}

/** Failure kinds that may be passed to `--trust-server-cert-failures`. */
export function trustableFailureKinds(kinds: SslFailureKind[]): SslFailureKind[] {
  return kinds.filter((kind) => TRUSTABLE_FAILURE_KINDS.includes(kind));
}

/** Stable per-failure key: one prompt per (host, fingerprint, failureKind). */
export function sslTrustPromptKey(failure: SslCertFailureInfo): string {
  return `${failure.host.toLowerCase()}|${failure.fingerprint ?? ''}|${failure.failureKind}`;
}

function normalizeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeRealmPath(pathname: string): string {
  if (pathname === '') return '/';
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function isRealmAncestorOfUrl(realm: string, url: string): boolean {
  const parsedRealm = normalizeUrl(realm);
  const parsedUrl = normalizeUrl(url);

  if (!parsedRealm || !parsedUrl || parsedRealm.origin !== parsedUrl.origin) {
    return false;
  }

  const realmPath = normalizeRealmPath(parsedRealm.pathname);
  const urlPath = normalizeRealmPath(parsedUrl.pathname);

  return realmPath === '/' || urlPath === realmPath || urlPath.startsWith(`${realmPath}/`);
}

export class SslTrustCache {
  private trusts = new Map<string, CachedSslTrust>();
  /** Failures already prompted this app session (prompt-once ledger). */
  private promptedKeys = new Set<string>();
  private readonly storePath: string;
  private readonly loadPromise: Promise<void>;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.storePath = join(userDataPath, 'ssl-trust-cache.json');
    this.loadPromise = this.load();
  }

  async ready(): Promise<void> {
    await this.loadPromise;
  }

  set(realm: string, failures: string): void {
    if (!realm.trim() || !failures.trim()) {
      return;
    }

    // Preserve any structured metadata already recorded for this realm; the
    // plain setter only upgrades the decision to accepted.
    const existing = this.trusts.get(realm);
    this.trusts.set(realm, {
      realm,
      failures,
      createdAt: existing?.createdAt ?? Date.now(),
      decision: 'accepted',
      ...(existing?.failureKind ? { failureKind: existing.failureKind } : {}),
      ...(existing?.fingerprint ? { fingerprint: existing.fingerprint } : {}),
      ...(existing?.validUntil ? { validUntil: existing.validUntil } : {}),
    });
    void this.save();
    debug.log('[SSL] Saved certificate trust for realm:', realm);
  }

  /**
   * Persist a structured trust decision (accept or reject) for a classified
   * certificate failure. Rejections shadow broader acceptances for every URL
   * underneath the realm and fail fast instead of re-prompting.
   */
  recordDecision(realm: string, failure: SslCertFailureInfo, decision: SslTrustDecision): void {
    if (!realm.trim()) {
      return;
    }

    const trustable = trustableFailureKinds(failure.failureKinds);
    const failures = (trustable.length > 0 ? trustable : failure.failureKinds).join(',');
    this.trusts.set(realm, {
      realm,
      failures,
      createdAt: Date.now(),
      decision,
      failureKind: failure.failureKind,
      ...(failure.fingerprint ? { fingerprint: failure.fingerprint } : {}),
      ...(failure.validUntil ? { validUntil: failure.validUntil } : {}),
    });
    void this.save();
    debug.log(
      '[SSL] Recorded certificate decision:',
      decision,
      'for realm:',
      realm,
      'kind:',
      failure.failureKind
    );
  }

  /**
   * Accepted trust for a URL, or null. Rejected entries (and acceptances
   * shadowed by a more specific rejection) intentionally return null so no
   * automatic `--trust-server-cert-failures` path can ever resurrect a
   * rejected certificate.
   */
  findForUrl(url: string): { realm: string; failures: string } | null {
    const best = this.findBestMatchForUrl(url);
    if (!best || best.decision === 'rejected') {
      return null;
    }
    return { realm: best.realm, failures: best.failures };
  }

  /** Full decision state for a URL, including rejections. */
  findDecisionForUrl(url: string): SslTrustDecisionEntry | null {
    const best = this.findBestMatchForUrl(url);
    if (!best) {
      return null;
    }
    return {
      realm: best.realm,
      decision: best.decision ?? 'accepted',
      failures: best.failures,
      ...(best.failureKind ? { failureKind: best.failureKind } : {}),
      ...(best.fingerprint ? { fingerprint: best.fingerprint } : {}),
      ...(best.validUntil ? { validUntil: best.validUntil } : {}),
    };
  }

  /** Origins (scheme://host) with an accepted trust — hostnames only, no paths. */
  listTrustedOrigins(): string[] {
    const origins = new Set<string>();
    for (const trust of this.trusts.values()) {
      if (trust.decision === 'rejected') {
        continue;
      }
      const parsed = normalizeUrl(trust.realm);
      if (parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
        origins.add(parsed.origin);
      }
    }
    return Array.from(origins).sort();
  }

  /** True while this exact failure has not been prompted in this app session. */
  hasPrompted(failure: SslCertFailureInfo): boolean {
    return this.promptedKeys.has(sslTrustPromptKey(failure));
  }

  /** Mark a failure as prompted; `hasPrompted` stays true until app restart. */
  markPrompted(failure: SslCertFailureInfo): void {
    this.promptedKeys.add(sslTrustPromptKey(failure));
  }

  private findBestMatchForUrl(url: string): CachedSslTrust | null {
    const exact = this.trusts.get(url);
    if (exact) {
      return exact;
    }

    let bestMatch: CachedSslTrust | null = null;
    for (const trust of this.trusts.values()) {
      if (isRealmAncestorOfUrl(trust.realm, url)) {
        if (!bestMatch || trust.realm.length > bestMatch.realm.length) {
          bestMatch = trust;
        }
      }
    }

    return bestMatch;
  }

  private async load(): Promise<void> {
    try {
      await access(this.storePath);
      const content = await readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(content) as StoredSslTrustCache;
      if (parsed.version !== 1 || !Array.isArray(parsed.trusts)) {
        return;
      }

      for (const trust of parsed.trusts) {
        if (trust.realm && trust.failures) {
          this.trusts.set(trust.realm, trust);
        }
      }
      debug.log('[SSL] Loaded', this.trusts.size, 'trusted certificate entries from disk');
    } catch {
      debug.log('[SSL] No existing SSL trust cache found');
    }
  }

  private async save(): Promise<void> {
    await this.savePromise;

    this.savePromise = (async () => {
      try {
        await mkdir(dirname(this.storePath), { recursive: true });
        const data: StoredSslTrustCache = {
          version: 1,
          trusts: Array.from(this.trusts.values()),
        };
        await writeFile(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
      } catch (error) {
        debug.error('[SSL] Failed to save trust cache:', error);
      }
    })();
  }
}

let sslTrustCacheInstance: SslTrustCache | null = null;

export function getSslTrustCache(): SslTrustCache {
  if (!sslTrustCacheInstance) {
    sslTrustCacheInstance = new SslTrustCache(app.getPath('userData'));
  }
  return sslTrustCacheInstance;
}
