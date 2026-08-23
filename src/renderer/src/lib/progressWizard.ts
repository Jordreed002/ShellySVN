/**
 * Pure helpers shared by the import/export wizards (backlog #62).
 *
 * Everything here is string/number shuffling around the *existing* IPC
 * contract — no option is invented client-side. Where the SVN payload has no
 * field for an option (export depth, ignore-externals, native EOL, import
 * excludes) the wizards render the control disabled with a "pending backend"
 * note instead of faking it; see the coordination notes in the dialogs.
 */

import type { SvnRepoEntry } from '@shared/types';

/** Entry cap for the export dry-run estimate — beyond this we say "more than N". */
export const ESTIMATE_ENTRY_CAP = 20_000;

/** How many junk folders get their sizes resolved through `fs:getFolderSizes`. */
export const JUNK_SIZE_LOOKUP_CAP = 8;

/**
 * Folder/file names that are almost never wanted in an `svn import`:
 * dependency caches, VCS metadata, build output, OS artifacts. Advisory only —
 * `svn import` cannot exclude them through the current IPC, so we surface them
 * before the upload instead of silently filtering.
 */
const IMPORT_JUNK_NAMES = new Set([
  // dependency caches
  'node_modules',
  'bower_components',
  '.pnpm-store',
  // VCS / tool metadata
  '.git',
  '.svn',
  '.hg',
  '.gradle',
  '.idea',
  // build output
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '__pycache__',
  // python envs
  '.venv',
  'venv',
  // OS artifacts
  '.DS_Store',
  'Thumbs.db',
]);

/** True when the value looks like a repository URL rather than a local path. */
export function isRepoUrlSource(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
}

export type ExportRevisionPin = 'head' | 'base' | 'number';

/**
 * Collapse the wizard's revision picker into the single `revision` string the
 * `svn:exportWithProgress` IPC accepts. `undefined` means HEAD (the previous
 * dialog behaviour — passing nothing means HEAD on the svn side too).
 * Returns `null` when "specific revision" holds something that is not a
 * positive integer, so the caller can block Start instead of guessing.
 */
export function normalizeExportRevision(
  pin: ExportRevisionPin,
  numberValue: string
): string | null | undefined {
  if (pin === 'head') return undefined;
  if (pin === 'base') return 'BASE';
  const trimmed = numberValue.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

/** Human label mirroring {@link normalizeExportRevision} for summaries. */
export function describeExportRevision(pin: ExportRevisionPin, numberValue: string): string {
  if (pin === 'head') return 'HEAD (latest)';
  if (pin === 'base') return 'BASE (working copy)';
  const trimmed = numberValue.trim();
  return /^\d+$/.test(trimmed) ? `r${trimmed}` : 'Specific revision';
}

export interface ExportEstimate {
  /** Number of file entries counted (capped at {@link ESTIMATE_ENTRY_CAP}). */
  fileCount: number;
  /** Sum of reported file sizes, or null when no entry reported a size. */
  totalBytes: number | null;
  /** True when the listing was cut off at the cap. */
  truncated: boolean;
}

/**
 * Fold a recursive `svn:list` result into a dry-run summary. Only `file`
 * entries count; sizes are optional in SVN listings, so bytes stay `null`
 * until at least one entry reports one (honest unknown, never zero-bytes).
 */
export function summarizeRepoEntries(entries: SvnRepoEntry[]): ExportEstimate {
  let fileCount = 0;
  let totalBytes: number | null = null;
  let truncated = false;

  for (const entry of entries) {
    if (fileCount >= ESTIMATE_ENTRY_CAP) {
      truncated = true;
      break;
    }
    if (entry.kind !== 'file') continue;
    fileCount++;
    if (typeof entry.size === 'number') {
      totalBytes = (totalBytes ?? 0) + entry.size;
    }
  }

  return { fileCount, totalBytes, truncated };
}

export interface JunkCandidate {
  name: string;
  isDirectory: boolean;
}

/** Top-level entries whose names match the unversioned-junk list. */
export function findJunkEntries<T extends { name: string; isDirectory: boolean }>(
  entries: T[]
): T[] {
  return entries.filter((entry) => IMPORT_JUNK_NAMES.has(entry.name));
}

/**
 * Join a repository URL with a path segment without doubling slashes and
 * without touching the scheme part (`svn://host` stays `svn://host`).
 */
export function joinRepoUrl(baseUrl: string, segment: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const part = segment.trim().replace(/^\/+|\/+$/g, '');
  if (!part) return base;
  return base ? `${base}/${part}` : part;
}

/**
 * Parent of a repository URL: strips the last path segment. Returns null at
 * the repository root (`scheme://host` or `scheme://host/repo-root-ish` is
 * judged conservatively: any URL with a single segment has no parent we can
 * compute without `svn:info`).
 */
export function parentRepoUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, '');
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/]+)(\/.*)$/i);
  if (schemeMatch) {
    const path = schemeMatch[3].replace(/\/+$/, '');
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? `${schemeMatch[1]}${schemeMatch[2]}${path.slice(0, lastSlash)}` : null;
  }
  // A URL with no path (`svn://host`) is already a root; only local-looking
  // strings may fall through to plain segment stripping.
  if (isRepoUrlSource(trimmed)) return null;
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return trimmed.slice(0, lastSlash);
}

/** Milliseconds → short duration label ("1.20s", "45s") for completion summaries. */
export function formatWizardDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
