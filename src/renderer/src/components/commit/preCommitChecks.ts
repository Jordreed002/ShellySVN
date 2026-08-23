/**
 * Client-side pre-commit checklist scanners (#75).
 *
 * Pure content scanners (debug leftovers, TODO markers, forbidden patterns)
 * plus an async runner that reads the selected files through the existing
 * `fs:readFile` IPC (which already enforces a 1 MB preview cap server-side —
 * reads can never balloon) and, when the main process exposes it, surfaces the
 * server-side secret scanner (`svn.scanSecrets`). Every check is advisory:
 * findings never block the commit, they are summarized for "commit anyway".
 *
 * Config (forbidden patterns, size threshold, per-check toggles) persists
 * through `window.api.store` with the same parse/normalize/persist split as
 * `lib/shortcutStore.ts`.
 */

import type { SecretScanResult } from '@shared/types';

export const PRE_COMMIT_CHECKS_KEY = 'shellysvn:pre-commit-checks:v1';

export type PreCommitCheckId =
  | 'debug-leftover'
  | 'todo-marker'
  | 'forbidden-pattern'
  | 'oversized-file'
  | 'secret';

export type PreCommitSeverity = 'danger' | 'warning' | 'info';

export interface PreCommitFinding {
  /** Stable within one run: `${check}:${file}:${line}:${counter}`. */
  id: string;
  check: PreCommitCheckId;
  severity: PreCommitSeverity;
  file: string;
  line?: number;
  snippet?: string;
  message: string;
}

export interface PreCommitCheckToggles {
  debugLeftovers: boolean;
  todoMarkers: boolean;
  forbiddenPatterns: boolean;
  oversizedFiles: boolean;
  secrets: boolean;
}

export interface PreCommitCheckConfig {
  /** Regex source strings, one finding per hit. Default empty. */
  forbiddenPatterns: string[];
  /** Oversized-file warning threshold in bytes. Default 5 MB. */
  oversizedThresholdBytes: number;
  toggles: PreCommitCheckToggles;
}

export const DEFAULT_OVERSIZED_THRESHOLD_BYTES = 5 * 1024 * 1024;
/** Never scan more than this much text per file (the IPC read caps at 1 MB). */
export const MAX_CONTENT_SCAN_BYTES = 1024 * 1024;
/** Per-file finding cap so one generated file cannot flood the panel. */
export const MAX_FINDINGS_PER_FILE = 20;
/** Snippet shown per finding. */
const MAX_SNIPPET_LENGTH = 160;

export const DEFAULT_PRE_COMMIT_CHECK_CONFIG: PreCommitCheckConfig = {
  forbiddenPatterns: [],
  oversizedThresholdBytes: DEFAULT_OVERSIZED_THRESHOLD_BYTES,
  toggles: {
    debugLeftovers: true,
    todoMarkers: true,
    forbiddenPatterns: true,
    oversizedFiles: true,
    secrets: true,
  },
};

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

export function parsePreCommitCheckConfig(value: unknown): PreCommitCheckConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PRE_COMMIT_CHECK_CONFIG };
  const { forbiddenPatterns, oversizedThresholdBytes, toggles } = value as {
    forbiddenPatterns?: unknown;
    oversizedThresholdBytes?: unknown;
    toggles?: unknown;
  };

  const patterns = Array.isArray(forbiddenPatterns)
    ? [
        ...new Set(
          forbiddenPatterns
            .filter((pattern): pattern is string => typeof pattern === 'string')
            .map((pattern) => pattern.trim())
            .filter(Boolean)
        ),
      ]
    : [];

  const threshold = Math.floor(Number(oversizedThresholdBytes));
  const safeThreshold =
    Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_OVERSIZED_THRESHOLD_BYTES;

  const parsedToggles =
    toggles && typeof toggles === 'object' ? (toggles as Partial<PreCommitCheckToggles>) : {};

  return {
    forbiddenPatterns: patterns,
    oversizedThresholdBytes: safeThreshold,
    toggles: {
      debugLeftovers: parsedToggles.debugLeftovers !== false,
      todoMarkers: parsedToggles.todoMarkers !== false,
      forbiddenPatterns: parsedToggles.forbiddenPatterns !== false,
      oversizedFiles: parsedToggles.oversizedFiles !== false,
      secrets: parsedToggles.secrets !== false,
    },
  };
}

export async function loadPreCommitCheckConfig(): Promise<PreCommitCheckConfig> {
  try {
    return parsePreCommitCheckConfig(
      await window.api?.store?.get<unknown>(PRE_COMMIT_CHECKS_KEY)
    );
  } catch {
    return { ...DEFAULT_PRE_COMMIT_CHECK_CONFIG };
  }
}

export async function savePreCommitCheckConfig(config: PreCommitCheckConfig): Promise<void> {
  await window.api?.store?.set(PRE_COMMIT_CHECKS_KEY, config);
}

// ---------------------------------------------------------------------------
// Content scanners (pure)
// ---------------------------------------------------------------------------

const DEBUG_LEFTOVER_RULES: Record<string, RegExp[]> = {
  js: [
    /\bconsole\.(log|debug|trace|table)\s*\(/,
    /\bdebugger\b/,
  ],
  py: [/\bprint\s*\(/, /\bpdb\.set_trace\s*\(/, /\bbreakpoint\s*\(/],
  rb: [/\bputs\s+.+/, /\bp\s+["']/, /\bbinding\.pry\b/, /\bbyebug\b/],
  java: [/\bSystem\.out\.print(ln)?\s*\(/],
  go: [/\bfmt\.Println\s*\(/, /\bspew\./],
  php: [/\b(var_dump|print_r|dd)\s*\(/],
  cs: [/\bConsole\.Write(Line)?\s*\(/, /\bDebugger\.Launch\b/],
  c: [/\bprintf\s*\(/],
  cpp: [/\bprintf\s*\(/, /\bstd::cout\s*<</],
};

const DEBUG_LEFTOVER_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py', 'rb', 'java', 'go', 'php', 'cs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
]);

const TODO_MARKER_PATTERN = /\b(TODO|FIXME|HACK)\b/;
const BINARY_MARKER = '\u0000';

export function getExtension(path: string): string {
  const filename = path.split(/[/\\]/).pop() ?? '';
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function isBinaryContent(content: string): boolean {
  return content.includes(BINARY_MARKER);
}

function debugLeftoverRules(path: string): RegExp[] | null {
  const extension = getExtension(path);
  if (!DEBUG_LEFTOVER_EXTENSIONS.has(extension)) return null;
  // The whole JS/TS family shares the console/debugger rules.
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'].includes(extension)) {
    return DEBUG_LEFTOVER_RULES.js;
  }
  if (extension === 'h' || extension === 'cc' || extension === 'cxx' || extension === 'hpp') {
    return [...(DEBUG_LEFTOVER_RULES.c ?? []), ...(DEBUG_LEFTOVER_RULES.cpp ?? [])];
  }
  return DEBUG_LEFTOVER_RULES[extension] ?? null;
}

function truncateSnippet(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_SNIPPET_LENGTH
    ? `${trimmed.slice(0, MAX_SNIPPET_LENGTH - 1)}…`
    : trimmed;
}

class FindingCollector {
  private count = 0;
  constructor(private readonly cap: number) {}
  get isFull(): boolean {
    return this.count >= this.cap;
  }
  next(check: PreCommitCheckId, file: string, line: number | undefined, message: string, snippet: string | undefined, severity: PreCommitSeverity): PreCommitFinding | null {
    if (this.count >= this.cap) return null;
    this.count += 1;
    return {
      id: `${check}:${file}:${line ?? 0}:${this.count}`,
      check,
      severity,
      file,
      line,
      snippet,
      message,
    };
  }
}

/** Scan one file's already-read content. Binary content yields no findings. */
export function scanTextContent(
  path: string,
  content: string,
  config: PreCommitCheckConfig
): PreCommitFinding[] {
  if (!content || isBinaryContent(content)) return [];

  const findings: PreCommitFinding[] = [];
  const collector = new FindingCollector(MAX_FINDINGS_PER_FILE);
  const debugRules =
    config.toggles.debugLeftovers || config.toggles.todoMarkers || config.toggles.forbiddenPatterns
      ? debugLeftoverRules(path)
      : null;

  const forbidden: RegExp[] = [];
  if (config.toggles.forbiddenPatterns) {
    for (const source of config.forbiddenPatterns) {
      try {
        forbidden.push(new RegExp(source, 'g'));
      } catch {
        // Invalid user patterns are surfaced by the runner, not per file.
      }
    }
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length && !collector.isFull; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const lineNumber = index + 1;

    if (config.toggles.debugLeftovers && debugRules) {
      for (const rule of debugRules) {
        if (rule.test(line)) {
          const finding = collector.next(
            'debug-leftover',
            path,
            lineNumber,
            'Debug leftover statement',
            truncateSnippet(line),
            'warning'
          );
          if (finding) findings.push(finding);
          break;
        }
      }
      if (collector.isFull) break;
    }

    if (config.toggles.todoMarkers && TODO_MARKER_PATTERN.test(line)) {
      const marker = TODO_MARKER_PATTERN.exec(line)?.[0];
      const finding = collector.next(
        'todo-marker',
        path,
        lineNumber,
        `${marker || 'TODO'} marker left in code`,
        truncateSnippet(line),
        'info'
      );
      if (finding) findings.push(finding);
      if (collector.isFull) break;
    }

    for (const pattern of forbidden) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        const finding = collector.next(
          'forbidden-pattern',
          path,
          lineNumber,
          `Matches forbidden pattern /${pattern.source}/`,
          truncateSnippet(line),
          'warning'
        );
        if (finding) findings.push(finding);
        break;
      }
    }
  }

  return findings;
}

/** Byte length of a string (UTF-8), used for the size check. */
export function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/** Size-threshold finding for one file. */
export function scanFileSize(
  path: string,
  sizeBytes: number,
  thresholdBytes: number
): PreCommitFinding | null {
  if (thresholdBytes <= 0 || sizeBytes <= thresholdBytes) return null;
  return {
    id: `oversized-file:${path}:0:1`,
    check: 'oversized-file',
    severity: 'warning',
    file: path,
    message: `File is ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB (threshold ${(thresholdBytes / (1024 * 1024)).toFixed(0)} MB)`,
  };
}

/** Report invalid user patterns once per run rather than once per file. */
export function findInvalidForbiddenPatterns(patterns: string[]): string[] {
  return patterns.filter((source) => {
    try {
      RegExp(source);
      return false;
    } catch {
      return true;
    }
  });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface PreCommitFileInput {
  path: string;
  isDirectory?: boolean;
}

export interface ReadFileLike {
  (path: string): Promise<{ success: boolean; content?: string; error?: string }>;
}

export interface ScanSecretsLike {
  (paths: string[], options?: { maxFileBytes?: number; maxFindingsPerFile?: number }): Promise<
    SecretScanResult | undefined
  >;
}

export interface PreCommitRunOptions {
  files: PreCommitFileInput[];
  config: PreCommitCheckConfig;
  readFile: ReadFileLike;
  /** Optional server-side secret scanner; absent → skipped gracefully. */
  scanSecrets?: ScanSecretsLike;
  onProgress?: (progress: PreCommitProgress) => void;
  signal?: AbortSignal;
}

export interface PreCommitProgress {
  completed: number;
  total: number;
  currentFile?: string;
}

export interface PreCommitSecretScanSummary {
  /** True when the scanner exists and produced a result. */
  ran: boolean;
  findingCount: number;
  scannedFileCount?: number;
  error?: string;
}

export interface PreCommitRunResult {
  findings: PreCommitFinding[];
  scannedFiles: number;
  skipped: { directories: number; unreadable: number; binary: number; tooLargeToScan: number };
  invalidPatterns: string[];
  secretScan: PreCommitSecretScanSummary;
  cancelled: boolean;
  durationMs: number;
}

function looksLikeTooLargeError(error: string): boolean {
  return /too large/i.test(error);
}

/** Map a server-side secret finding severity onto the panel's scale. */
export function secretSeverity(severity: string): PreCommitSeverity {
  return severity === 'critical' || severity === 'high' ? 'danger' : 'warning';
}

export async function runPreCommitChecks(options: PreCommitRunOptions): Promise<PreCommitRunResult> {
  const { files, config, readFile, scanSecrets, onProgress, signal } = options;
  const startedAt = Date.now();
  const findings: PreCommitFinding[] = [];
  const skipped = { directories: 0, unreadable: 0, binary: 0, tooLargeToScan: 0 };
  let scannedFiles = 0;
  let cancelled = false;

  const invalidPatterns = findInvalidForbiddenPatterns(config.forbiddenPatterns);
  for (const source of invalidPatterns) {
    findings.push({
      id: `forbidden-pattern:invalid:${findings.length + 1}`,
      check: 'forbidden-pattern',
      severity: 'info',
      file: '',
      message: `Forbidden pattern /${source}/ is not a valid regex and was ignored`,
    });
  }

  const candidates = files.filter((file) => {
    if (file.isDirectory) {
      skipped.directories += 1;
      return false;
    }
    return true;
  });
  const total = candidates.length;

  let firstReaderError: unknown = null;
  for (let index = 0; index < candidates.length; index++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    const file = candidates[index];
    onProgress?.({ completed: index, total, currentFile: file.path });

    let result: { success: boolean; content?: string; error?: string };
    try {
      result = await readFile(file.path);
    } catch (error) {
      // A reader that *throws* (vs returning success:false) means the fs
      // bridge itself is broken; remember it to fail the whole run below.
      firstReaderError ??= error;
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (!result.success || typeof result.content !== 'string') {
      // The fs IPC rejects files above its 1 MB preview cap; that is our only
      // reliable size signal for big files, so it becomes the size finding.
      if (config.toggles.oversizedFiles && looksLikeTooLargeError(result.error ?? '')) {
        findings.push({
          id: `oversized-file:${file.path}:0:1`,
          check: 'oversized-file',
          severity: 'warning',
          file: file.path,
          message: `File exceeds the ${MAX_CONTENT_SCAN_BYTES / (1024 * 1024)} MB read cap (threshold ${(config.oversizedThresholdBytes / (1024 * 1024)).toFixed(0)} MB)`,
        });
      } else {
        skipped.unreadable += 1;
      }
      continue;
    }

    scannedFiles += 1;
    const content = result.content;
    if (isBinaryContent(content)) {
      skipped.binary += 1;
      continue;
    }

    if (config.toggles.oversizedFiles) {
      const sizeFinding = scanFileSize(file.path, byteLength(content), config.oversizedThresholdBytes);
      if (sizeFinding) findings.push(sizeFinding);
    }

    if (byteLength(content) > MAX_CONTENT_SCAN_BYTES) {
      skipped.tooLargeToScan += 1;
      continue;
    }

    findings.push(...scanTextContent(file.path, content, config));
  }

  if (!signal?.aborted) {
    onProgress?.({ completed: total, total });
  }

  // Nothing was readable because the reader kept throwing: fail the run so
  // the panel can show its ErrorPanel + retry instead of "no findings".
  if (firstReaderError && scannedFiles === 0 && total > 0) {
    throw firstReaderError instanceof Error
      ? firstReaderError
      : new Error(String(firstReaderError));
  }

  const secretScan: PreCommitSecretScanSummary = { ran: false, findingCount: 0 };
  const secretTargets = candidates.map((file) => file.path);
  if (config.toggles.secrets && secretTargets.length > 0 && typeof scanSecrets === 'function') {
    secretScan.ran = true;
    try {
      const result = await scanSecrets(secretTargets, {
        maxFileBytes: MAX_CONTENT_SCAN_BYTES,
        maxFindingsPerFile: MAX_FINDINGS_PER_FILE,
      });
      if (result) {
        secretScan.scannedFileCount = result.scannedFileCount;
        for (const finding of result.findings) {
          secretScan.findingCount += 1;
          findings.push({
            id: `secret:${finding.path}:${finding.line}:${secretScan.findingCount}`,
            check: 'secret',
            severity: secretSeverity(finding.severity),
            file: finding.path,
            line: finding.line,
            snippet: finding.redactedPreview,
            message: `Possible secret (${finding.patternId})`,
          });
        }
      }
    } catch (error) {
      // Degrade gracefully: the checklist still shows the client-side results.
      secretScan.error = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    findings,
    scannedFiles,
    skipped,
    invalidPatterns,
    secretScan,
    cancelled,
    durationMs: Date.now() - startedAt,
  };
}
