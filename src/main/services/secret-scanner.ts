import type {
  SecretFinding,
  SecretPatternId,
  SecretScanOptions,
  SecretScanResult,
  SecretSeverity,
} from '@shared/types';
import { open, stat, type FileHandle } from 'fs/promises';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import { debug } from '../utils/debug';

// ============================================================================
// Pre-commit secret scanner (item 76, scanner backend).
//
// Scans the CONTENTS of changed files for likely secrets: known token shapes
// (AWS access keys, GitHub/GitLab tokens, private key headers, plus Slack /
// Google / JWT shapes), generic api_key/password/secret assignments with
// literal values, and high-entropy string detection. Purely hand-rolled
// regex + Shannon entropy — no new dependencies.
//
// The result is DATA-ONLY: every finding carries a severity so the caller can
// implement their own blocking/override policy (suggested default:
// DEFAULT_BLOCKING_SEVERITIES). Previews are redacted — the full secret value
// never leaves this module.
//
// The Secret* shapes live in @shared/types (they cross IPC); they are
// re-exported here for compatibility with existing main-process imports.
// ============================================================================

export type {
  SecretFileError,
  SecretFinding,
  SecretPatternId,
  SecretScanOptions,
  SecretScanResult,
  SecretSeverity,
} from '@shared/types';

/** Suggested caller policy: findings at these severities block, others warn. */
export const DEFAULT_BLOCKING_SEVERITIES: readonly SecretSeverity[] = ['critical', 'high'];

/** Files larger than this are skipped entirely (counted, not scanned). */
export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Files at or below this size are read in one call; larger ones stream. */
const INLINE_READ_MAX_BYTES = 256 * 1024;
/** Bytes sampled from the head of each file for the binary sniff. */
const BINARY_SNIFF_BYTES = 8192;
/** Only the first slice of very long (minified) lines is scanned. */
const MAX_SCANNED_LINE_LENGTH = 10_000;
const DEFAULT_MAX_FINDINGS_PER_FILE = 50;
const MAX_ERRORS = 50;

interface TokenPattern {
  id: SecretPatternId;
  severity: SecretSeverity;
  pattern: RegExp;
}

const TOKEN_PATTERNS: readonly TokenPattern[] = [
  { id: 'aws-access-key', severity: 'critical', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', severity: 'high', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
  { id: 'gitlab-token', severity: 'high', pattern: /\bglpat-[A-Za-z0-9_-]{20,255}\b/g },
  {
    id: 'private-key-header',
    severity: 'critical',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { id: 'slack-token', severity: 'high', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,250}\b/g },
  { id: 'google-api-key', severity: 'high', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    id: 'jwt',
    severity: 'high',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
];

/**
 * Generic assignment: `api_key = "…"`, `password: hunter2`, `SECRET_TOKEN := …`
 * (shell). Only `=`, `:=`, and `:` forms — arrow functions (`=>`) are not
 * assignments. The value must be a literal (env refs, placeholders, and
 * non-secrets are filtered by isLiteralSecretValue).
 */
const ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*(?::=|[:=])\s*(?:"([^"\n]{6,})"|'([^'\n]{6,})'|([^\s"'`,;)\]}&|]{6,}))/g;

const SECRET_NAME = /(api[_-]?key|apikey|secret|pass(?:word|wd|phrase)?|pwd|token|access[_-]?key|private[_-]?key|client[_-]?secret|credential)/i;

/** Standalone token candidates for entropy analysis. */
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{20,}/g;

/** Value shapes that look like an assignment but are not literal secrets. */
const NON_LITERAL_VALUE =
  /^(?:\$\{?[A-Za-z_][A-Za-z0-9_]*(?::?[-+=?][^}]*)?\}?|%[A-Za-z_][A-Za-z0-9_]*%|<[^>]*>|\*+|x{3,}|\.{3,}|…|-(?:-)?[A-Za-z][\w-]*$)/;
const PLACEHOLDER_WORDS = new Set([
  'none',
  'null',
  'nil',
  'undefined',
  'true',
  'false',
  'changeme',
  'change-me',
  'placeholder',
  'todo',
  'example',
  'dummy',
  'redacted',
  'removed',
  'password',
  'secret',
  'token',
  'your_api_key',
  'your-api-key',
  'your_password',
  'your-password',
]);

function isLiteralSecretValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6) return false;
  if (NON_LITERAL_VALUE.test(trimmed)) return false;
  const lowered = trimmed.toLowerCase();
  if (PLACEHOLDER_WORDS.has(lowered)) return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return false; // numbers/versions
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return false; // hex literals
  if (/^https?:\/\//i.test(trimmed)) return false; // URLs (use URL-credentials pattern territory)
  // Environment references (process.env.X, os.environ[...], ENV_VAR indirection).
  if (/(?:^|[._-])env(?:[._-]|\[|$)/i.test(trimmed)) return false;
  if (trimmed.includes('${') || trimmed.includes('<') || trimmed.includes('>')) return false;
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_HASH = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/i;

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

const HIGH_ENTROPY_THRESHOLD = 4.0;

function looksLikeHighEntropySecret(token: string): boolean {
  if (token.length < 20) return false;
  if (UUID.test(token) || CONTENT_HASH.test(token)) return false;
  if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) return false;
  return shannonEntropy(token) >= HIGH_ENTROPY_THRESHOLD;
}

/** Redact a matched value: at most 4 leading chars survive, never for short values. */
function redact(value: string): string {
  const prefixLength = Math.min(4, Math.max(1, value.length - 4));
  return `${value.slice(0, prefixLength)}…(${value.length} chars)`;
}

interface LineFinding {
  column: number;
  patternId: SecretPatternId;
  severity: SecretSeverity;
  redactedPreview: string;
}

/** Scan a single line (up to MAX_SCANNED_LINE_LENGTH chars); 1-based columns. */
function scanLine(line: string): LineFinding[] {
  const findings: LineFinding[] = [];
  const scanned = line.length > MAX_SCANNED_LINE_LENGTH ? line.slice(0, MAX_SCANNED_LINE_LENGTH) : line;

  const tokenTexts: string[] = [];
  for (const { id, severity, pattern } of TOKEN_PATTERNS) {
    for (const match of scanned.matchAll(pattern)) {
      tokenTexts.push(match[0]);
      findings.push({
        column: (match.index ?? 0) + 1,
        patternId: id,
        severity,
        redactedPreview:
          id === 'private-key-header' ? '-----BEGIN … PRIVATE KEY-----' : redact(match[0]),
      });
    }
  }

  for (const match of scanned.matchAll(ASSIGNMENT)) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (!value || !SECRET_NAME.test(name)) continue;
    if (!isLiteralSecretValue(value)) continue;
    // A value already covered by a known token pattern is reported once,
    // under the more specific pattern id.
    if (tokenTexts.some((text) => value.includes(text))) continue;
    findings.push({
      column: (match.index ?? 0) + 1,
      patternId: 'secret-assignment',
      severity: 'medium',
      redactedPreview: `${name}=${redact(value)}`,
    });
  }

  // Entropy backstop runs only when no known token shape already matched, so
  // an AWS key is not double-reported as a high-entropy string. Assignment
  // findings do not suppress it — a different secret may share the line — but
  // the assigned value itself is never re-reported.
  if (findings.every((finding) => finding.patternId === 'secret-assignment')) {
    for (const match of scanned.matchAll(LONG_TOKEN)) {
      const token = match[0];
      if (!looksLikeHighEntropySecret(token)) continue;
      if (tokenTexts.some((text) => token.includes(text))) continue;
      if (findings.some((finding) => finding.redactedPreview.endsWith(redact(token)))) continue;
      findings.push({
        column: (match.index ?? 0) + 1,
        patternId: 'high-entropy-string',
        severity: 'low',
        redactedPreview: redact(token),
      });
    }
  }

  return findings;
}

/**
 * Pure text scan: findings for `path: ''` with 1-based lines/columns. Exposed
 * for reuse (e.g. AI privacy gates) and for tests.
 */
export function scanTextForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const finding of scanLine(lines[index])) {
      findings.push({
        path: '',
        line: index + 1,
        column: finding.column,
        patternId: finding.patternId,
        severity: finding.severity,
        redactedPreview: finding.redactedPreview,
      });
    }
  }
  return findings;
}

/** Tally findings per severity for summary UI. */
export function countSeverities(findings: SecretFinding[]): Record<SecretSeverity, number> {
  const counts: Record<SecretSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function looksBinary(head: Buffer): boolean {
  if (head.includes(0)) return true;
  let suspicious = 0;
  for (const byte of head) {
    // Control bytes other than tab/LF/CR/FF/VT are non-text.
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) suspicious += 1;
  }
  return head.length > 0 && suspicious / head.length > 0.3;
}

async function readSmallFileLines(handle: FileHandle): Promise<string[]> {
  const buffer = await handle.readFile();
  return buffer.toString('utf8').split(/\r?\n/);
}

async function scanLargeFileStreaming(
  path: string,
  signal: AbortSignal | undefined,
  onLine: (line: string) => void
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let sinceCheck = 0;
  try {
    for await (const line of rl) {
      if ((sinceCheck += 1) % 256 === 0 && signal?.aborted) {
        rl.close();
        return;
      }
      onLine(line);
    }
  } finally {
    rl.close();
  }
}

/**
 * Scan the contents of the given files for likely secrets. Data-only result;
 * blocking/override policy belongs to the caller. Files are read line-by-line
 * when large, whole when small; binary files are skipped; oversized files are
 * counted, not scanned.
 */
export async function scanFilesForSecrets(
  paths: string[],
  options: SecretScanOptions = {}
): Promise<SecretScanResult> {
  const startedAt = Date.now();
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFindingsPerFile = options.maxFindingsPerFile ?? DEFAULT_MAX_FINDINGS_PER_FILE;

  const result: SecretScanResult = {
    findings: [],
    scannedFileCount: 0,
    skippedBinaryCount: 0,
    skippedOversizeCount: 0,
    truncatedLineCount: 0,
    errorFiles: [],
    cancelled: false,
    durationMs: 0,
  };

  for (const rawPath of paths) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    const path = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!path) continue;

    try {
      const fileStat = await stat(path);
      if (!fileStat.isFile()) continue;
      if (fileStat.size > maxFileBytes) {
        result.skippedOversizeCount += 1;
        continue;
      }

      const handle = await open(path, 'r');
      try {
        const sniffLength = Math.min(BINARY_SNIFF_BYTES, fileStat.size);
        const head = Buffer.alloc(sniffLength);
        await handle.read(head, 0, sniffLength, 0);
        if (looksBinary(head)) {
          result.skippedBinaryCount += 1;
          continue;
        }

        result.scannedFileCount += 1;
        const fileFindings: SecretFinding[] = [];
        const addLine = (line: string, lineNumber: number): void => {
          if (fileFindings.length >= maxFindingsPerFile) return;
          if (line.length > MAX_SCANNED_LINE_LENGTH) result.truncatedLineCount += 1;
          for (const finding of scanLine(line)) {
            if (fileFindings.length >= maxFindingsPerFile) return;
            fileFindings.push({
              path,
              line: lineNumber,
              column: finding.column,
              patternId: finding.patternId,
              severity: finding.severity,
              redactedPreview: finding.redactedPreview,
            });
          }
        };

        if (fileStat.size <= INLINE_READ_MAX_BYTES) {
          const lines = await readSmallFileLines(handle);
          for (let index = 0; index < lines.length; index += 1) {
            if (options.signal?.aborted) {
              result.cancelled = true;
              break;
            }
            addLine(lines[index], index + 1);
          }
        } else {
          let lineNumber = 0;
          await scanLargeFileStreaming(path, options.signal, (line) => {
            lineNumber += 1;
            addLine(line, lineNumber);
          });
          if (options.signal?.aborted) result.cancelled = true;
        }

        result.findings.push(...fileFindings);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (result.errorFiles.length < MAX_ERRORS) {
        result.errorFiles.push({
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  result.durationMs = Date.now() - startedAt;
  if (result.errorFiles.length > 0) {
    debug.warn(`[secret-scanner] ${result.errorFiles.length} files failed to scan`);
  }
  return result;
}
