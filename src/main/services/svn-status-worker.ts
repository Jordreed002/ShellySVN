import { readdir } from 'fs/promises';
import { basename, dirname, isAbsolute, join } from 'path';

import type {
  NormalizationMismatch,
  SvnStatusResult,
  UnicodePathWarnings,
} from '@shared/types';

import type { SvnStatusMap } from '../ipc/fs';
import {
  detectCaseCollisions,
  detectNormalizationMismatch,
  mayDifferByUnicodeNormalization,
  normalizePathForComparison,
} from '../utils/unicode-paths';
import { getSharedWorkerPool } from '../workers/WorkerPool';
import type { FsSvnStatusEntry } from '../workers/types';
import { resolveSvnExecution } from './svn-executor';

export type FsStatusDepth = 'empty' | 'files' | 'immediates' | 'infinity';

export interface FsStatusResult {
  directStatus: SvnStatusMap;
  allEntries: FsSvnStatusEntry[];
  /**
   * Present only when the scan detected unicode problems (NFC/NFD mismatches,
   * case collisions) — detection and reporting only, nothing is renamed.
   * Declared on the shared SvnStatusResult / FsStatusResult payloads.
   */
  unicodeWarnings?: UnicodePathWarnings;
}

const activeFsStatusRequests = new Map<string, Promise<FsStatusResult>>();

export function getWorkerFsStatus(
  dirPath: string,
  depth: FsStatusDepth = 'immediates'
): Promise<FsStatusResult> {
  const jobId = `fs-status:${depth}:${dirPath}`;
  const activeRequest = activeFsStatusRequests.get(jobId);
  if (activeRequest) return activeRequest;

  const request = (async () => {
    const { svnCommand, context } = await resolveSvnExecution();
    const result = await getSharedWorkerPool().run(
      'svn:fsStatus',
      {
        dirPath,
        svnCommand,
        context,
        depth,
      },
      {
        id: jobId,
        priority: 'interactive',
        joinExisting: true,
      }
    );
    return withUnicodeWarnings(result, result.allEntries.map((entry) => entry.fullPath));
  })();

  activeFsStatusRequests.set(jobId, request);
  const removeCompletedRequest = () => {
    if (activeFsStatusRequests.get(jobId) === request) {
      activeFsStatusRequests.delete(jobId);
    }
  };
  void request.then(removeCompletedRequest, removeCompletedRequest);
  return request;
}

export interface WorkerSvnStatusOptions {
  showUpdates?: boolean;
  trustSslFailures?: boolean;
  trustedSslFailures?: string;
  credentials?: { username: string; password: string };
  jobId?: string;
}

/**
 * Unicode/case detection for the status pipeline. Everything here is
 * detection and reporting only — files are never renamed or "fixed".
 *
 * Case collisions matter only where the filesystem is case-insensitive (the
 * macOS and Windows defaults); case-sensitive hosts (Linux) skip the pass so
 * legitimately distinct entries never produce warnings.
 */
function isCaseInsensitiveFilesystem(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32';
}

/** Best-effort directory listing: warnings must never break a status scan. */
async function readDirectoryNames(dirPath: string): Promise<string[] | null> {
  try {
    return await readdir(dirPath);
  } catch {
    return null;
  }
}

interface OnDiskNameIndex {
  exact: Set<string>;
  /** NFC key → first on-disk name that could differ by normalization form. */
  byComparisonKey: Map<string, string>;
}

function buildOnDiskNameIndex(names: readonly string[]): OnDiskNameIndex {
  const exact = new Set<string>();
  const byComparisonKey = new Map<string, string>();
  for (const name of names) {
    exact.add(name);
    if (!mayDifferByUnicodeNormalization(name)) continue;
    const key = normalizePathForComparison(name);
    if (!byComparisonKey.has(key)) byComparisonKey.set(key, name);
  }
  return { exact, byComparisonKey };
}

/**
 * Compares SVN-recorded paths with on-disk readdir names (where available)
 * and reports names that are canonically equivalent but not byte-identical —
 * the macOS NFD-disk vs NFC-repo phantom-status case. A single fast
 * pre-filter keeps pure-ASCII scans (the common case) free of any extra I/O,
 * and each directory is read at most once per scan.
 */
async function detectNormalizationMismatches(
  scanPaths: string[]
): Promise<NormalizationMismatch[]> {
  if (!scanPaths.some(mayDifferByUnicodeNormalization)) return [];

  const warnings: NormalizationMismatch[] = [];
  const indexByDir = new Map<string, OnDiskNameIndex | null>();

  for (const scanPath of scanPaths) {
    if (!mayDifferByUnicodeNormalization(scanPath)) continue;

    const dir = dirname(scanPath);
    if (dir === scanPath) continue; // filesystem root — no name to compare

    if (!indexByDir.has(dir)) {
      const names = await readDirectoryNames(dir);
      indexByDir.set(dir, names ? buildOnDiskNameIndex(names) : null);
    }
    const index = indexByDir.get(dir) ?? null;
    if (!index) continue;

    const expectedName = basename(scanPath);
    if (index.exact.has(expectedName)) continue; // byte-identical on disk

    const onDiskName = index.byComparisonKey.get(normalizePathForComparison(expectedName));
    if (!onDiskName) continue; // genuinely absent, not a normalization variant

    const mismatch = detectNormalizationMismatch(scanPath, join(dir, onDiskName));
    if (mismatch) warnings.push(mismatch);
  }

  return warnings;
}

async function collectUnicodeWarnings(scanPaths: string[]): Promise<UnicodePathWarnings | null> {
  const caseCollisions = isCaseInsensitiveFilesystem()
    ? detectCaseCollisions(scanPaths)
    : [];
  const normalizationMismatches = await detectNormalizationMismatches(scanPaths);

  if (caseCollisions.length === 0 && normalizationMismatches.length === 0) return null;
  return { normalizationMismatches, caseCollisions };
}

/**
 * Attaches `unicodeWarnings` to a finished status result — additively and
 * only when there is something to report, so the existing output shape is
 * untouched otherwise.
 */
async function withUnicodeWarnings<T extends object>(
  result: T,
  scanPaths: string[]
): Promise<T & { unicodeWarnings?: UnicodePathWarnings }> {
  const warnings = await collectUnicodeWarnings(scanPaths);
  return warnings ? { ...result, unicodeWarnings: warnings } : result;
}

/** Absolutizes root-relative svn status entry paths ('.', 'src/x', ...). */
function toAbsoluteScanPaths(rootDir: string, entryPaths: string[]): string[] {
  const absolute: string[] = [];
  for (const entryPath of entryPaths) {
    if (!entryPath || entryPath === '.') continue;
    absolute.push(isAbsolute(entryPath) ? entryPath : join(rootDir, entryPath));
  }
  return absolute;
}

export async function getWorkerSvnStatus(
  path: string,
  options: WorkerSvnStatusOptions = {}
): Promise<SvnStatusResult> {
  const { svnCommand, context } = await resolveSvnExecution();
  const result = await getSharedWorkerPool().run(
    'svn:workingCopyStatus',
    {
      dirPath: path,
      svnCommand,
      context,
      showUpdates: options.showUpdates,
      trustSslFailures: options.trustSslFailures,
      trustedSslFailures: options.trustedSslFailures,
      credentials: options.credentials,
    },
    {
      id:
        options.jobId ?? (options.showUpdates ? `svn-status-remote:${path}` : `svn-status:${path}`),
      priority: 'interactive',
      joinExisting: true,
    }
  );

  const scanPaths = toAbsoluteScanPaths(
    path,
    result.entries.map((entry) => entry.path)
  );
  const enriched = await withUnicodeWarnings(result, scanPaths);

  return options.showUpdates ? { ...enriched, remoteChecked: true } : enriched;
}
