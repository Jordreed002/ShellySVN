import type { AiConsentMap, AiWorkingCopyConsent } from '@shared/types';
import { getStore } from '../ipc/store';

/**
 * AI privacy gate (#18, backend half).
 *
 * `scanOutboundPrompt` runs over EVERY outbound prompt payload before any
 * provider call. High-confidence credential shapes (AWS keys, GitHub tokens,
 * private key blocks, JWTs) BLOCK the request with a typed error; trivially
 * safe-to-redact shapes (secret-named env assignments, high-entropy
 * assignments) are masked instead.
 *
 * The per-working-copy consent gate reads the main-side store service under
 * `shellysvn:ai-consent:v1` (Record<workingCopyRoot, {aiEnabled, updatedAt}>).
 * A working copy with an explicit `aiEnabled: false` entry refuses AI requests
 * with a typed `consent_required` error. Absent entries keep current behavior
 * (allowed) so existing users are not locked out.
 */

export const AI_CONSENT_STORE_KEY = 'shellysvn:ai-consent:v1';

export type AiPrivacyFindingAction = 'blocked' | 'redacted';

export interface AiPrivacyFinding {
  kind:
    | 'aws-access-key'
    | 'github-token'
    | 'private-key'
    | 'jwt'
    | 'secret-assignment'
    | 'high-entropy-assignment';
  action: AiPrivacyFindingAction;
  /** Character offset of the finding in the scanned text. */
  index: number;
  /** Masked preview; never contains the matched secret. */
  excerpt: string;
}

export interface AiPrivacyScanOutcome {
  text: string;
  blocked: boolean;
  redacted: boolean;
  findings: AiPrivacyFinding[];
}

const MASK = '[REDACTED]';

interface FindingPattern {
  kind: AiPrivacyFinding['kind'];
  action: AiPrivacyFindingAction;
  pattern: RegExp;
}

const BLOCKING_PATTERNS: readonly FindingPattern[] = [
  { kind: 'aws-access-key', action: 'blocked', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'github-token', action: 'blocked', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: 'private-key', action: 'blocked', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  // JWT: three base64url segments, header must decode to {"alg"-style JSON.
  {
    kind: 'jwt',
    action: 'blocked',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
];

const SECRET_NAME_ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*)(\s*[:=]\s*)("?)([^\s"',;&]{8,})\3/gi;

const GENERIC_ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)("?)([^\s"']{20,})\3/g;

function masked(value: string): string {
  return `${value.slice(0, 3)}…${MASK}`;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function looksLikeHighEntropySecret(value: string): boolean {
  if (value.length < 20) return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return false; // plain numbers
  if (/^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(value)) return false; // common content hashes
  return shannonEntropy(value) >= 3.5;
}

/** Scan one outbound prompt; blocking findings do not mutate `text`. */
export function scanOutboundPrompt(text: string): AiPrivacyScanOutcome {
  const findings: AiPrivacyFinding[] = [];
  let blocked = false;
  for (const { kind, action, pattern } of BLOCKING_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      blocked = true;
      findings.push({ kind, action, index: match.index ?? 0, excerpt: masked(match[0]) });
    }
  }

  let working = text;
  const redactAssignments = (values: { kind: AiPrivacyFinding['kind']; name: string; equals: string; quote: string; value: string }[]): void => {
    for (const { kind, name, equals, quote, value } of values) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(`\\b${escaped}(\\s*[:=]\\s*)"?${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`);
      if (expression.test(working)) {
        working = working.replace(expression, `${name}${equals}${quote}${MASK}${quote}`);
        findings.push({ kind, action: 'redacted', index: working.indexOf(`${name}${equals}`), excerpt: `${name}${equals}${MASK}` });
      }
    }
  };

  const secretNamed: { kind: AiPrivacyFinding['kind']; name: string; equals: string; quote: string; value: string }[] = [];
  SECRET_NAME_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(SECRET_NAME_ASSIGNMENT)) {
    secretNamed.push({
      kind: 'secret-assignment',
      name: match[1],
      equals: match[2],
      quote: match[3] ?? '',
      value: match[4],
    });
  }
  redactAssignments(secretNamed);

  const highEntropy: typeof secretNamed = [];
  GENERIC_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(GENERIC_ASSIGNMENT)) {
    const name = match[1];
    const value = match[4];
    if (looksLikeHighEntropySecret(value) && !secretNamed.some((entry) => entry.name === name && entry.value === value)) {
      highEntropy.push({
        kind: 'high-entropy-assignment',
        name,
        equals: match[2],
        quote: match[3] ?? '',
        value,
      });
    }
  }
  redactAssignments(highEntropy);

  return {
    // Assignment redactions apply even when blocking findings exist, so
    // previews never display secret values that would be masked outbound.
    text: working,
    blocked,
    redacted: secretNamed.length > 0 || highEntropy.length > 0,
    findings,
  };
}

/**
 * Apply the outbound privacy gate. Throws a typed `[secret_detected]` error
 * for blocking findings BEFORE any provider call; otherwise returns the
 * (possibly redacted) prompt.
 */
export function guardOutboundPrompt(text: string): AiPrivacyScanOutcome {
  const outcome = scanOutboundPrompt(text);
  if (outcome.blocked) {
    const kinds = [...new Set(outcome.findings.filter((f) => f.action === 'blocked').map((f) => f.kind))];
    throw new Error(
      `[secret_detected] The AI request was blocked: the outbound prompt contained potential secrets (${kinds.join(', ')}). Remove or allowlist them before sending repository content to an AI provider.`
    );
  }
  return outcome;
}

function isConsentMap(value: unknown): value is AiConsentMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      typeof (entry as AiWorkingCopyConsent).aiEnabled === 'boolean' &&
      typeof (entry as AiWorkingCopyConsent).updatedAt === 'string'
  );
}

type ConsentReader = () => Promise<AiConsentMap>;

let consentReaderForTests: ConsentReader | undefined;

/** Test seam: inject the consent map source. */
export function setAiConsentReaderForTests(reader: ConsentReader | undefined): void {
  consentReaderForTests = reader;
}

async function readConsentMap(): Promise<AiConsentMap> {
  if (consentReaderForTests) return consentReaderForTests();
  try {
    const store = await getStore();
    const value = await store.get<unknown>(AI_CONSENT_STORE_KEY);
    return isConsentMap(value) ? value : {};
  } catch {
    return {};
  }
}

export async function getAiWorkingCopyConsent(
  workingCopyPath: string
): Promise<AiWorkingCopyConsent | null> {
  return findConsentForPath(workingCopyPath);
}

export async function setAiWorkingCopyConsent(
  workingCopyPath: string,
  aiEnabled: boolean
): Promise<void> {
  if (typeof workingCopyPath !== 'string' || !workingCopyPath.trim()) {
    throw new Error('A working copy path is required to record AI consent.');
  }
  const store = await getStore();
  const value = await store.get<unknown>(AI_CONSENT_STORE_KEY);
  const map: AiConsentMap = isConsentMap(value) ? value : {};
  map[workingCopyPath] = { aiEnabled, updatedAt: new Date().toISOString() };
  await store.set(AI_CONSENT_STORE_KEY, map);
}

/**
 * Find the consent entry governing `path`: the exact key when present,
 * otherwise the nearest ancestor directory with an entry (so gates configured
 * on a working copy root also cover its subpaths).
 */
export async function findConsentForPath(path: string | undefined): Promise<AiWorkingCopyConsent | null> {
  if (!path || typeof path !== 'string') return null;
  const map = await readConsentMap();
  if (Object.keys(map).length === 0) return null;
  const normalized = path.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/);
  for (let depth = segments.length; depth > 0; depth -= 1) {
    const candidate = segments.slice(0, depth).join('/');
    const windowsCandidate = segments.slice(0, depth).join('\\');
    const entry = map[candidate] ?? map[windowsCandidate];
    if (entry) return entry;
  }
  return null;
}

/**
 * Consent gate: refuse with a typed `consent_required` error when the working
 * copy governing this path has AI explicitly disabled.
 */
export async function assertAiConsentForPath(path: string | undefined): Promise<void> {
  const consent = await findConsentForPath(path);
  if (consent && consent.aiEnabled === false) {
    throw new Error(
      '[consent_required] AI features are disabled for this working copy. Enable them in the working copy AI consent settings before sending content to a provider.'
    );
  }
}
