import type { FsStatusResult, SvnStatusChar } from '@shared/types';

import { detectCaseCollisions } from '../utils/unicode-paths';

export const DEEP_STATUS_CACHE_TTL_MS = 2 * 60 * 1000;
export const DEEP_STATUS_CACHE_MAX_ENTRIES = 500;

interface DeepStatusCacheEntry {
  result: FsStatusResult;
  cachedAt: number;
}

const STATUS_PRIORITY: Record<SvnStatusChar, number> = {
  C: 100,
  '!': 90,
  '~': 85,
  M: 80,
  D: 70,
  R: 60,
  A: 50,
  X: 40,
  '?': 30,
  I: 20,
  O: 10,
  ' ': 0,
};

function normalizeStatusPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSameOrDescendantPath(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

function getWorstStatus(current: SvnStatusChar, next: SvnStatusChar): SvnStatusChar {
  return STATUS_PRIORITY[next] > STATUS_PRIORITY[current] ? next : current;
}

/**
 * Deep scans arrive from the worker pool directly (ipc/fs.ts), so the
 * synchronous part of unicode detection — case collisions over the scanned
 * entry set, a single pass over a case-folded map — happens here before
 * caching. Enrichment is additive and in place, so the caller's reference
 * (returned to the renderer right after) observes the same warnings as the
 * cache, and nothing is added when there is nothing to report. Normalization
 * mismatch detection needs async readdir and lives in svn-status-worker.
 * Detection and reporting only — files are never renamed automatically.
 */
function attachUnicodeWarningsInPlace(result: FsStatusResult): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  const collisions = detectCaseCollisions(result.allEntries.map((entry) => entry.fullPath));
  if (collisions.length === 0) return;
  result.unicodeWarnings = { normalizationMismatches: [], caseCollisions: collisions };
}

export class StatusService {
  private readonly deepStatusCache = new Map<string, DeepStatusCacheEntry>();

  constructor(private readonly maxEntries = DEEP_STATUS_CACHE_MAX_ENTRIES) {}

  getDeepStatus(path: string, maxAgeMs = DEEP_STATUS_CACHE_TTL_MS): FsStatusResult | null {
    const cacheKey = normalizeStatusPath(path);
    const cached = this.deepStatusCache.get(cacheKey);
    if (!cached) return null;

    if (Date.now() - cached.cachedAt > maxAgeMs) {
      this.deepStatusCache.delete(cacheKey);
      return null;
    }

    this.deepStatusCache.delete(cacheKey);
    this.deepStatusCache.set(cacheKey, cached);
    return cached.result;
  }

  setDeepStatus(path: string, result: FsStatusResult): void {
    attachUnicodeWarningsInPlace(result);
    const cacheKey = normalizeStatusPath(path);
    this.deepStatusCache.delete(cacheKey);
    this.deepStatusCache.set(cacheKey, {
      result,
      cachedAt: Date.now(),
    });

    while (this.deepStatusCache.size > this.maxEntries) {
      const oldestKey = this.deepStatusCache.keys().next().value;
      if (!oldestKey) break;
      this.deepStatusCache.delete(oldestKey);
    }
  }

  getCachedPathStatus(path: string): SvnStatusChar | null {
    const normalizedPath = normalizeStatusPath(path);
    let worstStatus: SvnStatusChar = ' ';
    let matched = false;

    for (const cached of this.deepStatusCache.values()) {
      for (const entry of cached.result.allEntries) {
        const entryPath = normalizeStatusPath(entry.fullPath);
        if (entryPath === normalizedPath || entryPath.startsWith(`${normalizedPath}/`)) {
          matched = true;
          worstStatus = getWorstStatus(worstStatus, entry.status);
        }
      }
    }

    return matched ? worstStatus : null;
  }

  invalidatePath(path: string): void {
    const normalizedPath = normalizeStatusPath(path);
    for (const cachedPath of Array.from(this.deepStatusCache.keys())) {
      if (
        isSameOrDescendantPath(normalizedPath, cachedPath) ||
        isSameOrDescendantPath(cachedPath, normalizedPath)
      ) {
        this.deepStatusCache.delete(cachedPath);
      }
    }
  }

  invalidatePaths(paths: string[]): void {
    for (const path of paths) {
      this.invalidatePath(path);
    }
  }

  clear(): void {
    this.deepStatusCache.clear();
  }

  getStateForTests() {
    return {
      deepStatusCacheSize: this.deepStatusCache.size,
      cachedPaths: Array.from(this.deepStatusCache.keys()),
      maxEntries: this.maxEntries,
    };
  }
}

let statusService: StatusService | null = null;

export function getStatusService(): StatusService {
  statusService ??= new StatusService();
  return statusService;
}

export function resetStatusServiceForTests(service: StatusService | null = null): void {
  statusService = service;
}
