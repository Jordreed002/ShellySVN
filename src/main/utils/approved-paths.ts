import { existsSync, realpathSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { hardenPrivateFile, writeSecureJsonSync } from './secure-json';

interface ApprovedPathRecord {
  canonicalPath: string;
  kind: 'directory' | 'file';
  approvedAt: string;
  source: 'native-picker';
}

interface ApprovedPathRegistryV2 {
  version: 2;
  roots: ApprovedPathRecord[];
}

const approvedRoots = new Map<string, ApprovedPathRecord>();

// Set during bootstrap (real main process only); persistence is a no-op until then,
// which keeps unit tests free of any Electron/filesystem dependency.
let persistenceFile: string | null = null;

function normalizePath(path: string): string {
  const normalized = resolve(path);
  let existingAncestor = normalized;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) return normalized;
    existingAncestor = parent;
  }

  try {
    const canonicalAncestor = realpathSync.native(existingAncestor);
    return resolve(canonicalAncestor, relative(existingAncestor, normalized));
  } catch {
    return normalized;
  }
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function savePersisted(): void {
  if (!persistenceFile) return;
  try {
    const registry: ApprovedPathRegistryV2 = { version: 2, roots: Array.from(approvedRoots.values()) };
    writeSecureJsonSync(persistenceFile, registry);
  } catch (error) {
    console.error('[approved-paths] Failed to persist approved roots:', error);
  }
}

export function approvePathForIpc(path: string, kind: 'directory' | 'file' = 'directory'): string {
  const normalized = normalizePath(path);
  if (!approvedRoots.has(normalized)) {
    approvedRoots.set(normalized, {
      canonicalPath: normalized,
      kind,
      approvedAt: new Date().toISOString(),
      source: 'native-picker',
    });
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
  for (const [root, record] of approvedRoots) {
    if ((record.kind === 'file' && root === normalized) || (record.kind === 'directory' && isInsideRoot(root, normalized))) {
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
 * - restores only approvals that originated from a native picker.
 *
 * Roots remain approved across restarts until the persisted registry is cleared.
 * Canonical real paths prevent symlinks inside an approved root from escaping it;
 * moved or replaced roots must be selected again.
 *
 * Lazily imports Electron so this module stays dependency-free for unit tests.
 */
export async function bootstrapApprovedPaths(): Promise<void> {
  const { app } = await import('electron');
  persistenceFile = join(app.getPath('userData'), 'approved-paths.json');

  try {
    hardenPrivateFile(persistenceFile);
    const parsed = JSON.parse(readFileSync(persistenceFile, 'utf-8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null && (parsed as ApprovedPathRegistryV2).version === 2) {
      for (const record of (parsed as ApprovedPathRegistryV2).roots ?? []) {
        if (
          record?.source === 'native-picker' &&
          (record.kind === 'directory' || record.kind === 'file') &&
          typeof record.canonicalPath === 'string'
        ) {
          const canonicalPath = normalizePath(record.canonicalPath);
          approvedRoots.set(canonicalPath, { ...record, canonicalPath });
        }
      }
    } else {
      // Legacy registries did not record approval provenance and may contain paths
      // granted by renderer-controlled APIs. They must not be carried forward.
      approvedRoots.clear();
      console.info('[approved-paths] Reset legacy approvals during v2 migration.');
    }
  } catch {
    // No persisted file yet (or unreadable) — start fresh.
  }

  savePersisted();
}
