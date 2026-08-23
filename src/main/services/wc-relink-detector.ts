import type {
  ApplyRelinkResult,
  KnownWorkingCopyEntry,
  RelinkMatchBasis,
  RelinkProposal,
  WcRelinkDetectionResult,
} from '@shared/types';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { parseSvnInfoXml } from '../svn/parsers';
import { runSvnText } from './svn-executor';
import { withSvnTargets } from '../utils/svn-targets';
import { debug } from '../utils/debug';

// ============================================================================
// Working-copy auto-relink detection (item 60, detection backend).
//
// Detects that a REGISTERED working copy's folder was moved/renamed on disk:
// when a known WC path is missing, bounded cheap locations are searched —
// sibling directories of the missing path (renamed in place) and targeted
// cousin paths `<sibling-of-parent>/<old-name>` (parent renamed) — restricted
// to the same volume. A candidate counts only when its `svn info` identity
// (repository UUID preferred, URL as fallback) matches the identity recorded
// for the missing working copy.
//
// Nothing relinks automatically: detection only produces RelinkProposal
// values; applying is an explicit applyRelinkProposal() call with a
// registry-update callback supplied by the caller. The in-memory monitor
// registry helper lives in src/main/ipc/monitor.ts
// (renameMonitoredWorkingCopy); the settings recentRepositories update path
// is owned by the integration wiring (see follow-up note at the bottom).
//
// The KnownWorkingCopyEntry / Relink* / WcRelinkDetectionResult /
// ApplyRelinkResult shapes live in @shared/types (they cross IPC); they are
// re-exported here for compatibility with existing main-process imports.
// Test seams (SvnInfoRunner, WcIdentity, WcRelinkDetectionOptions) stay local.
// ============================================================================

export type {
  ApplyRelinkResult,
  KnownWorkingCopyEntry,
  RelinkConfidence,
  RelinkMatchBasis,
  RelinkProposal,
  WcRelinkDetectionResult,
} from '@shared/types';

/** Identity tuple returned by the `svn info` seam. */
export interface WcIdentity {
  url: string;
  repositoryUuid: string;
  workingCopyRoot?: string;
}

/** Seam over `svn info --xml`; injectable so tests avoid spawning svn. */
export type SvnInfoRunner = (path: string) => Promise<WcIdentity | null>;

export interface WcRelinkDetectionOptions {
  signal?: AbortSignal;
  /** Cap on sibling directories enumerated per level. Default 64. */
  maxSiblingsPerLevel?: number;
  /** Overrides the default svn-executor-backed runner (test seam). */
  runSvnInfo?: SvnInfoRunner;
}

export type RelinkRegistryUpdate = (oldPath: string, newPath: string) => void | Promise<void>;

/** Default runner: the same svn-executor seam every other service uses. */
async function runSvnInfoViaExecutor(path: string): Promise<WcIdentity | null> {
  try {
    const xml = await runSvnText(withSvnTargets(['info', '--xml'], [path]), { cwd: path });
    const info = parseSvnInfoXml(xml);
    if (!info.url && !info.repositoryUuid) return null;
    return {
      url: info.url,
      repositoryUuid: info.repositoryUuid,
      workingCopyRoot: info.workingCopyRoot,
    };
  } catch {
    // Not a working copy, or svn failed; either way the candidate is not a match.
    return null;
  }
}

/** Nearest existing ancestor of `path` (inclusive), or null when the whole chain is gone. */
function nearestExistingAncestor(path: string): string | null {
  let current = path;
  for (let hops = 0; hops < 32; hops += 1) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

async function deviceFor(path: string): Promise<number | null> {
  try {
    return (await stat(path)).dev;
  } catch {
    return null;
  }
}

/** Same-volume check; unknown devices (0 on some platforms) never exclude. */
async function isSameVolume(referenceDev: number | null, candidate: string): Promise<boolean> {
  if (referenceDev === null) return true;
  const candidateDev = await deviceFor(candidate);
  if (candidateDev === null) return false;
  if (candidateDev === 0 || referenceDev === 0) return true;
  return candidateDev === referenceDev;
}

async function listChildDirectories(
  directory: string,
  maxEntries: number,
  errors: string[]
): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(directory, entry.name))
      .sort()
      .slice(0, maxEntries);
  } catch (error) {
    errors.push(`readdir ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return [];
}

/**
 * Bounded candidate set for a missing working copy:
 * 1. siblings of the missing path (renamed in place) — full enumeration,
 *    capped, name-similar first;
 * 2. for each sibling of the PARENT (capped): the targeted path
 *    `<sibling>/<old-basename>` (parent renamed around an intact WC).
 */
async function buildCandidatePaths(
  oldPath: string,
  maxSiblings: number,
  errors: string[]
): Promise<string[]> {
  const parent = dirname(oldPath);
  const oldBasename = basename(oldPath);
  const grandparent = dirname(parent);
  const candidates: string[] = [];

  // Level 1: siblings of the missing path itself.
  if (existsSync(parent)) {
    const siblings = await listChildDirectories(parent, maxSiblings, errors);
    const similar = siblings.filter((dir) => basename(dir).includes(oldBasename));
    const rest = siblings.filter((dir) => !basename(dir).includes(oldBasename));
    candidates.push(...similar, ...rest);
  }

  // Level 2: targeted cousins under the parent's siblings.
  if (existsSync(grandparent)) {
    const parentSiblings = await listChildDirectories(grandparent, maxSiblings, errors);
    for (const sibling of parentSiblings) {
      candidates.push(join(sibling, oldBasename));
    }
  }

  return candidates;
}

function looksLikeWorkingCopyDirectory(path: string): boolean {
  return existsSync(join(path, '.svn'));
}

function compareIdentity(
  entry: KnownWorkingCopyEntry,
  identity: WcIdentity
): RelinkMatchBasis | null {
  if (entry.repositoryUuid && identity.repositoryUuid) {
    return entry.repositoryUuid === identity.repositoryUuid ? 'uuid' : null;
  }
  if (entry.url && identity.url) {
    return entry.url === identity.url ? 'url' : null;
  }
  return null;
}

/**
 * Detect moved/renamed working copies for the given registry entries.
 * Read-only: disk + `svn info` only; produces proposals, never mutates state.
 */
export async function detectWorkingCopyRelinks(
  entries: KnownWorkingCopyEntry[],
  options: WcRelinkDetectionOptions = {}
): Promise<WcRelinkDetectionResult> {
  const maxSiblings = options.maxSiblingsPerLevel ?? 64;
  const runSvnInfo = options.runSvnInfo ?? runSvnInfoViaExecutor;

  const result: WcRelinkDetectionResult = {
    proposals: [],
    unmatchedMissingPaths: [],
    presentPaths: [],
    checkedCandidateCount: 0,
    cancelled: false,
    errors: [],
  };

  for (const entry of entries) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    if (typeof entry?.path !== 'string' || !entry.path.trim()) continue;

    if (existsSync(entry.path)) {
      result.presentPaths.push(entry.path);
      continue;
    }

    const parent = dirname(entry.path);
    const volumeReference = nearestExistingAncestor(parent);
    const referenceDev = volumeReference ? await deviceFor(volumeReference) : null;

    const candidates = await buildCandidatePaths(entry.path, maxSiblings, result.errors);
    let urlFallback: RelinkProposal | null = null;
    let matched = false;

    for (const candidate of candidates) {
      if (options.signal?.aborted) {
        result.cancelled = true;
        return result;
      }
      if (!looksLikeWorkingCopyDirectory(candidate)) continue;
      if (!(await isSameVolume(referenceDev, candidate))) continue;

      result.checkedCandidateCount += 1;
      const identity = await runSvnInfo(candidate);
      if (!identity) continue;

      // A candidate nested inside a larger working copy is not the moved root.
      if (identity.workingCopyRoot && identity.workingCopyRoot !== candidate) continue;

      const basis = compareIdentity(entry, identity);
      if (basis === 'uuid') {
        urlFallback = null;
        matched = true;
        result.proposals.push({
          oldPath: entry.path,
          newPath: candidate,
          matchedOn: 'uuid',
          confidence: 'high',
          url: identity.url || undefined,
          repositoryUuid: identity.repositoryUuid || undefined,
        });
        break;
      }
      if (basis === 'url' && !urlFallback) {
        urlFallback = {
          oldPath: entry.path,
          newPath: candidate,
          matchedOn: 'url',
          confidence: 'medium',
          url: identity.url || undefined,
          repositoryUuid: identity.repositoryUuid || undefined,
        };
      }
    }

    if (urlFallback) {
      matched = true;
      result.proposals.push(urlFallback);
    }

    if (!matched && !result.cancelled) {
      // Basename-only fallback applies ONLY when the registry recorded no
      // identity at all: a same-named folder with an .svn area one level
      // around the old location is a weak (low-confidence) proposal.
      if (!entry.url && !entry.repositoryUuid) {
        const named = candidates.find(
          (candidate) =>
            basename(candidate) === basename(entry.path) && looksLikeWorkingCopyDirectory(candidate)
        );
        if (named) {
          matched = true;
          result.proposals.push({
            oldPath: entry.path,
            newPath: named,
            matchedOn: 'basename',
            confidence: 'low',
          });
        }
      }
      if (!matched) result.unmatchedMissingPaths.push(entry.path);
    }

    if (result.cancelled) break;
  }

  return result;
}

/**
 * Apply a relink proposal EXPLICITLY (never automatic): re-verifies the new
 * path still looks like a working copy, then hands (oldPath, newPath) to the
 * caller's registry-update callback — e.g. monitor's
 * renameMonitoredWorkingCopy plus a settings recentRepositories rewrite.
 */
export async function applyRelinkProposal(
  proposal: RelinkProposal,
  updateRegistry: RelinkRegistryUpdate
): Promise<ApplyRelinkResult> {
  if (!proposal?.oldPath || !proposal?.newPath) {
    return { success: false, error: 'A relink proposal needs both oldPath and newPath.' };
  }
  if (proposal.oldPath === proposal.newPath) {
    return { success: false, error: 'Relink paths are identical; nothing to apply.' };
  }
  if (typeof updateRegistry !== 'function') {
    return { success: false, error: 'A registry-update callback is required to apply a relink.' };
  }
  if (!looksLikeWorkingCopyDirectory(proposal.newPath)) {
    return {
      success: false,
      error: `New path no longer looks like a working copy: ${proposal.newPath}`,
    };
  }

  try {
    await updateRegistry(proposal.oldPath, proposal.newPath);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debug.error('[relink] Registry update failed:', message);
    return { success: false, error: message };
  }
}

/*
 * Integration follow-up (owned by the wiring agent, not this service):
 * - IPC channel that calls detectWorkingCopyRelinks with entries built from
 *   monitor:getWorkingCopies + settings.recentRepositories (the registry
 *   currently records url only; capturing repositoryUuid at add-time would
 *   upgrade proposals from medium to high confidence);
 * - applyRelinkProposal callback that calls renameMonitoredWorkingCopy
 *   (src/main/ipc/monitor.ts) AND rewrites settings.recentRepositories;
 * - watcher close/reopen for the new path via the existing fs watcher API.
 */
