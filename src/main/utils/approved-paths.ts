import { writeFileSync, readFileSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';

const approvedRoots = new Set<string>();

// Set during bootstrap (real main process only); persistence is a no-op until then,
// which keeps unit tests free of any Electron/filesystem dependency.
let persistenceFile: string | null = null;

function normalizePath(path: string): string {
  return resolve(path);
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function savePersisted(): void {
  if (!persistenceFile) return;
  try {
    writeFileSync(persistenceFile, JSON.stringify(Array.from(approvedRoots)), 'utf-8');
  } catch (error) {
    console.error('[approved-paths] Failed to persist approved roots:', error);
  }
}

export function approvePathForIpc(path: string): string {
  const normalized = normalizePath(path);
  if (!approvedRoots.has(normalized)) {
    approvedRoots.add(normalized);
    savePersisted();
  }
  return path;
}

export function clearApprovedPathsForTests(): void {
  approvedRoots.clear();
  persistenceFile = null;
}

export function isPathApprovedForIpc(path: string): boolean {
  const normalized = normalizePath(path);
  for (const root of approvedRoots) {
    if (isInsideRoot(root, normalized)) {
      return true;
    }
  }

  return false;
}

export function assertPathApprovedForIpc(path: string, operation: string): string {
  const normalized = normalizePath(path);
  if (!isPathApprovedForIpc(normalized)) {
    throw new Error(`${operation} is only allowed inside a folder selected through ShellySVN.`);
  }

  return normalized;
}

/**
 * Initialize the approved-roots registry for the running app:
 * - restores roots persisted from previous sessions,
 * - approves the user's home directory (so the file explorer is browsable),
 * - approves the supplied recent repository roots.
 *
 * Lazily imports Electron so this module stays dependency-free for unit tests.
 */
export async function bootstrapApprovedPaths(recentRepoRoots: string[] = []): Promise<void> {
  const { app } = await import('electron');
  persistenceFile = join(app.getPath('userData'), 'approved-paths.json');

  try {
    const parsed = JSON.parse(readFileSync(persistenceFile, 'utf-8'));
    if (Array.isArray(parsed)) {
      for (const root of parsed) {
        if (typeof root === 'string') approvedRoots.add(normalizePath(root));
      }
    }
  } catch {
    // No persisted file yet (or unreadable) — start fresh.
  }

  try {
    approvedRoots.add(normalizePath(app.getPath('home')));
  } catch {
    // home not resolvable — skip
  }

  for (const root of recentRepoRoots) {
    if (root) approvedRoots.add(normalizePath(root));
  }

  savePersisted();
}
