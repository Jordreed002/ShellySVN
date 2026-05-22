import type { FsStatusResult } from '@shared/types';
import type { SvnStatusChar } from '@shared/types';

export const DEEP_STATUS_CACHE_TTL_MS = 2 * 60 * 1000;

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

export class StatusService {
  private readonly deepStatusCache = new Map<string, DeepStatusCacheEntry>();

  getDeepStatus(path: string, maxAgeMs = DEEP_STATUS_CACHE_TTL_MS): FsStatusResult | null {
    const cacheKey = normalizeStatusPath(path);
    const cached = this.deepStatusCache.get(cacheKey);
    if (!cached) return null;

    if (Date.now() - cached.cachedAt > maxAgeMs) {
      this.deepStatusCache.delete(cacheKey);
      return null;
    }

    return cached.result;
  }

  setDeepStatus(path: string, result: FsStatusResult): void {
    this.deepStatusCache.set(normalizeStatusPath(path), {
      result,
      cachedAt: Date.now(),
    });
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
