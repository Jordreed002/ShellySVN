import type {
  PristineAnalysisOptions,
  PristineAnalysisResult,
  PristineLargestFile,
  PristineSizeBucket,
  PristineVacuumReason,
  PristineVacuumRecommendation,
} from '@shared/types';
import { existsSync } from 'fs';
import { opendir, stat } from 'fs/promises';
import { basename, dirname, join, relative } from 'path';
import { debug } from '../utils/debug';

// ============================================================================
// Pristine-store analyzer (item 61, analyzer backend).
//
// Streams `.svn/pristine` with opendir (O(1) memory except the top-N largest
// list) so multi-gigabyte stores analyze without loading the file list.
// Orphan detection is filename-shape only: pristine entries are named
// `<sha1>.svn-base` inside a shard dir matching the checksum's first two hex
// chars, so anything violating that layout is definitely unreferenced. Full
// unreferenced-checksum detection needs wc.db SQLite access (PRAGMA + a join
// over NODES.checksum) which is deliberately out of scope; when wc.db itself
// is gone the whole store is orphaned, which IS cheaply derivable.
//
// The Pristine* shapes live in @shared/types (they cross IPC); they are
// re-exported here for compatibility with existing main-process imports.
// ============================================================================

export type {
  PristineAnalysisOptions,
  PristineAnalysisResult,
  PristineLargestFile,
  PristineOrphanEstimate,
  PristineSizeBucket,
  PristineVacuumReason,
  PristineVacuumRecommendation,
} from '@shared/types';

/** Recommend vacuum when the pristine store alone crosses this size. */
export const PRISTINE_VACUUM_ABSOLUTE_THRESHOLD_BYTES = 1024 ** 3; // 1 GiB
/** Recommend vacuum when pristine bytes / working-copy bytes crosses this. */
export const PRISTINE_VACUUM_RATIO_THRESHOLD = 0.5;
/** Stores below this size skip the working-copy walk (ratio cannot trigger). */
export const PRISTINE_RATIO_ELIGIBLE_MIN_BYTES = 64 * 1024 * 1024;
/** Cap on entries visited during the working-copy size walk. */
export const PRISTINE_WC_SCAN_MAX_ENTRIES = 200_000;
const MAX_LARGEST_FILES = 10;
const MAX_ERRORS = 20;
const MAX_ROOT_HOPS = 4;
const ABORT_CHECK_EVERY = 128;

const PRISTINE_NAME = /^[0-9a-f]{40}\.svn-base$/i;

/** Default histogram buckets; maxBytes is exclusive, null = unbounded. */
export const PRISTINE_SIZE_BUCKETS: ReadonlyArray<Pick<PristineSizeBucket, 'label' | 'minBytes' | 'maxBytes'>> = [
  { label: '< 4 KiB', minBytes: 0, maxBytes: 4 * 1024 },
  { label: '4 KiB – 64 KiB', minBytes: 4 * 1024, maxBytes: 64 * 1024 },
  { label: '64 KiB – 512 KiB', minBytes: 64 * 1024, maxBytes: 512 * 1024 },
  { label: '512 KiB – 1 MiB', minBytes: 512 * 1024, maxBytes: 1024 * 1024 },
  { label: '1 MiB – 16 MiB', minBytes: 1024 * 1024, maxBytes: 16 * 1024 * 1024 },
  { label: '≥ 16 MiB', minBytes: 16 * 1024 * 1024, maxBytes: null },
];

function emptyHistogram(): PristineSizeBucket[] {
  return PRISTINE_SIZE_BUCKETS.map((bucket) => ({ ...bucket, fileCount: 0, totalBytes: 0 }));
}

function bucketFor(histogram: PristineSizeBucket[], bytes: number): PristineSizeBucket | undefined {
  return histogram.find(
    (bucket) => bytes >= bucket.minBytes && (bucket.maxBytes === null || bytes < bucket.maxBytes)
  );
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

/** Resolve the working-copy root owning the `.svn` admin area, or null. */
function resolveWorkingCopyRoot(candidate: string): string | null {
  let current = candidate;
  for (let hops = 0; hops < MAX_ROOT_HOPS; hops += 1) {
    if (existsSync(join(current, '.svn'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function unavailableResult(
  workingCopyPath: string,
  reason: 'not_a_working_copy' | 'pristine_store_missing',
  startedAt: number
): PristineAnalysisResult {
  return {
    available: false,
    unavailableReason: reason,
    workingCopyPath,
    pristineRoot: '',
    totalBytes: 0,
    fileCount: 0,
    largestFileBytes: 0,
    largestFiles: [],
    histogram: emptyHistogram(),
    orphanEstimate: {
      storeOrphaned: false,
      malformedFileCount: 0,
      malformedBytes: 0,
      limitationNote: '',
    },
    workingCopySize: null,
    vacuumRecommendation: { recommended: false, reasons: [], confidence: 'low' },
    cancelled: false,
    errors: [],
    durationMs: Date.now() - startedAt,
    scannedAt: new Date().toISOString(),
  };
}

interface StoreAggregate {
  totalBytes: number;
  fileCount: number;
  largestFileBytes: number;
  largestFiles: PristineLargestFile[];
  histogram: PristineSizeBucket[];
  malformedFileCount: number;
  malformedBytes: number;
  cancelled: boolean;
  errors: string[];
}

function insertLargest(largest: PristineLargestFile[], file: PristineLargestFile): void {
  let index = largest.length;
  while (index > 0 && largest[index - 1].bytes < file.bytes) index -= 1;
  if (index >= MAX_LARGEST_FILES) return;
  largest.splice(index, 0, file);
  if (largest.length > MAX_LARGEST_FILES) largest.length = MAX_LARGEST_FILES;
}

/**
 * Stream the pristine store. Layout: `<root>/<shard2>/<sha1>.svn-base`, where
 * shard2 equals the first two hex chars of the checksum. Anything else (wrong
 * name shape, shard mismatch, leftover tmp files) is definitely unreferenced.
 */
async function walkPristineStore(
  pristineRoot: string,
  signal?: AbortSignal
): Promise<StoreAggregate> {
  const aggregate: StoreAggregate = {
    totalBytes: 0,
    fileCount: 0,
    largestFileBytes: 0,
    largestFiles: [],
    histogram: emptyHistogram(),
    malformedFileCount: 0,
    malformedBytes: 0,
    cancelled: false,
    errors: [],
  };

  const pending: string[] = [pristineRoot];
  let sinceAbortCheck = 0;

  while (pending.length > 0) {
    if (isAborted(signal)) {
      aggregate.cancelled = true;
      return aggregate;
    }
    const dirPath = pending.pop() as string;
    let directory;
    try {
      directory = await opendir(dirPath);
    } catch (error) {
      aggregate.errors.push(`opendir ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    for await (const entry of directory) {
      if ((sinceAbortCheck += 1) % ABORT_CHECK_EVERY === 0 && isAborted(signal)) {
        aggregate.cancelled = true;
        return aggregate;
      }
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks/sockets never hold pristine data

      let bytes = 0;
      try {
        bytes = (await stat(entryPath)).size;
      } catch (error) {
        aggregate.errors.push(
          `stat ${entryPath}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      aggregate.totalBytes += bytes;
      aggregate.fileCount += 1;
      if (bytes > aggregate.largestFileBytes) aggregate.largestFileBytes = bytes;
      insertLargest(aggregate.largestFiles, { name: relativeToRoot(pristineRoot, entryPath), bytes });

      const bucket = bucketFor(aggregate.histogram, bytes);
      if (bucket) {
        bucket.fileCount += 1;
        bucket.totalBytes += bytes;
      }

      if (!PRISTINE_NAME.test(entry.name) || !shardMatches(dirPath, entry.name)) {
        aggregate.malformedFileCount += 1;
        aggregate.malformedBytes += bytes;
      }
    }
  }
  return aggregate;
}

function relativeToRoot(root: string, path: string): string {
  const rel = relative(root, path);
  return rel ? rel : path;
}

function shardMatches(dirPath: string, fileName: string): boolean {
  return basename(dirPath).toLowerCase() === fileName.slice(0, 2).toLowerCase();
}

/**
 * Streamed working-copy payload size (every regular file, skipping `.svn`
 * admin areas). Bounded by PRISTINE_WC_SCAN_MAX_ENTRIES; sets truncated when
 * the cap fires so the ratio heuristic can lower its confidence.
 */
async function measureWorkingCopySize(
  wcRoot: string,
  signal?: AbortSignal
): Promise<{ bytes: number; truncated: boolean }> {
  let bytes = 0;
  let visited = 0;
  let truncated = false;
  const pending: string[] = [wcRoot];
  let sinceAbortCheck = 0;

  while (pending.length > 0) {
    if (isAborted(signal)) return { bytes, truncated: true };
    const dirPath = pending.pop() as string;
    let directory;
    try {
      directory = await opendir(dirPath);
    } catch {
      continue; // unreadable dirs must not abort the aggregate
    }
    for await (const entry of directory) {
      if ((sinceAbortCheck += 1) % ABORT_CHECK_EVERY === 0 && isAborted(signal)) {
        return { bytes, truncated: true };
      }
      if (visited >= PRISTINE_WC_SCAN_MAX_ENTRIES) {
        truncated = true;
        return { bytes, truncated };
      }
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.svn') pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      try {
        bytes += (await stat(entryPath)).size;
      } catch {
        // Transient stat races fall out of the total silently.
      }
    }
  }
  return { bytes, truncated };
}

/**
 * Pure vacuum heuristic, exported so the UI can preview thresholds and tests
 * can exercise it without multi-gigabyte fixtures:
 * - ORPHANED_STORE: wc.db is gone (confidence high on its own);
 * - PRISTINE_ABSOLUTE_SIZE: store ≥ PRISTINE_VACUUM_ABSOLUTE_THRESHOLD_BYTES;
 * - PRISTINE_TO_WC_RATIO: pristine/payload ≥ PRISTINE_VACUUM_RATIO_THRESHOLD
 *   (confidence drops to low when the payload walk was truncated).
 */
export function evaluatePristineVacuumRecommendation(
  pristineBytes: number,
  storeOrphaned: boolean,
  workingCopySize: { bytes: number; truncated: boolean } | null
): PristineVacuumRecommendation {
  const reasons: PristineVacuumReason[] = [];
  if (storeOrphaned) reasons.push('ORPHANED_STORE');
  if (pristineBytes >= PRISTINE_VACUUM_ABSOLUTE_THRESHOLD_BYTES) {
    reasons.push('PRISTINE_ABSOLUTE_SIZE');
  }
  if (
    workingCopySize !== null &&
    workingCopySize.bytes > 0 &&
    pristineBytes / workingCopySize.bytes >= PRISTINE_VACUUM_RATIO_THRESHOLD
  ) {
    reasons.push('PRISTINE_TO_WC_RATIO');
  }

  let confidence: PristineVacuumRecommendation['confidence'] = 'low';
  if (storeOrphaned) confidence = 'high';
  else if (reasons.includes('PRISTINE_ABSOLUTE_SIZE') && reasons.includes('PRISTINE_TO_WC_RATIO')) {
    confidence = 'high';
  } else if (reasons.length > 0) {
    confidence =
      reasons.includes('PRISTINE_TO_WC_RATIO') && workingCopySize?.truncated ? 'low' : 'medium';
  }

  return { recommended: reasons.length > 0, reasons, confidence };
}

/**
 * Analyze a working copy's pristine store: total disk usage, file count,
 * size histogram, definite-orphan breakdown, and a vacuum recommendation.
 * Data-only — actually running `svn cleanup --vacuum` is the caller's policy.
 */
export async function analyzePristineStore(
  workingCopyPath: string,
  options: PristineAnalysisOptions = {}
): Promise<PristineAnalysisResult> {
  const startedAt = Date.now();
  if (typeof workingCopyPath !== 'string' || !workingCopyPath.trim()) {
    throw new Error('A working copy path is required to analyze the pristine store.');
  }

  const wcRoot = resolveWorkingCopyRoot(workingCopyPath);
  if (!wcRoot) return unavailableResult(workingCopyPath, 'not_a_working_copy', startedAt);

  const pristineRoot = join(wcRoot, '.svn', 'pristine');
  if (!existsSync(pristineRoot)) {
    return unavailableResult(workingCopyPath, 'pristine_store_missing', startedAt);
  }

  const storeOrphaned = !existsSync(join(wcRoot, '.svn', 'wc.db'));
  const aggregate = await walkPristineStore(pristineRoot, options.signal);

  let workingCopySize: { bytes: number; truncated: boolean } | null = null;
  const wantWcSize =
    options.computeWorkingCopySize ??
    aggregate.totalBytes >= PRISTINE_RATIO_ELIGIBLE_MIN_BYTES;
  if (wantWcSize && !aggregate.cancelled) {
    workingCopySize = await measureWorkingCopySize(wcRoot, options.signal);
  } else if (wantWcSize && aggregate.cancelled) {
    workingCopySize = { bytes: 0, truncated: true };
  }

  const result: PristineAnalysisResult = {
    available: true,
    workingCopyPath: wcRoot,
    pristineRoot,
    totalBytes: aggregate.totalBytes,
    fileCount: aggregate.fileCount,
    largestFileBytes: aggregate.largestFileBytes,
    largestFiles: aggregate.largestFiles,
    histogram: aggregate.histogram,
    orphanEstimate: {
      storeOrphaned,
      malformedFileCount: aggregate.malformedFileCount,
      malformedBytes: aggregate.malformedBytes,
      limitationNote: storeOrphaned
        ? 'wc.db is missing: the entire pristine store is unreferenced.'
        : 'Definite orphans only (filename-shape + missing wc.db). Full unreferenced-checksum detection requires wc.db SQLite access, which this analyzer does not attempt.',
    },
    workingCopySize,
    vacuumRecommendation: evaluatePristineVacuumRecommendation(
      aggregate.totalBytes,
      storeOrphaned,
      workingCopySize
    ),
    cancelled: aggregate.cancelled,
    errors: aggregate.errors.slice(0, MAX_ERRORS),
    durationMs: Date.now() - startedAt,
    scannedAt: new Date().toISOString(),
  };

  if (result.cancelled) debug.warn('[pristine] Analysis cancelled mid-scan; aggregates are partial.');
  return result;
}
