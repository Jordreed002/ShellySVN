import { existsSync, realpathSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { realpath } from 'node:fs/promises';
import { writeSecureJson } from './secure-json';
import { hardenPrivateFile, writeSecureJsonSync } from './secure-json';

interface ApprovedPathRecord {
  canonicalPath: string;
  kind: 'directory' | 'file';
  approvedAt: string;
  source: 'native-picker' | 'application-home';
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

async function normalizePathAsync(path: string): Promise<string> {
  const normalized = resolve(path);
  let ancestor = normalized;
  for (;;) {
    try {
      const canonical = await realpath(ancestor);
      return resolve(canonical, relative(ancestor, normalized));
    } catch {
      const parent = dirname(ancestor);
      if (parent === ancestor) return normalized;
      ancestor = parent;
    }
  }
}

let persistenceWrite: Promise<void> = Promise.resolve();
function savePersistedAsync(): Promise<void> {
  const file = persistenceFile;
  if (!file) return Promise.resolve();
  persistenceWrite = persistenceWrite
    .then(async () => {
      const registry: ApprovedPathRegistryV2 = {
        version: 2,
        roots: Array.from(approvedRoots.values()),
      };
      await writeSecureJson(file, registry);
    })
    .catch((error) => console.error('[approved-paths] Failed to persist approved roots:', error));
  return persistenceWrite;
}

export async function approvePathForIpcAsync(
  path: string,
  kind: 'directory' | 'file' = 'directory'
): Promise<string> {
  return approvePathWithSourceAsync(path, kind, 'native-picker');
}

export async function approveApplicationHomeForIpcAsync(path: string): Promise<string> {
  return approvePathWithSourceAsync(path, 'directory', 'application-home');
}

async function approvePathWithSourceAsync(
  path: string,
  kind: 'directory' | 'file',
  source: ApprovedPathRecord['source']
): Promise<string> {
  const canonicalPath = await normalizePathAsync(path);
  if (!approvedRoots.has(canonicalPath)) {
    approvedRoots.set(canonicalPath, {
      canonicalPath,
      kind,
      source,
      approvedAt: new Date().toISOString(),
    });
    await savePersistedAsync();
  }
  return path;
}

export async function isPathApprovedForIpcAsync(path: string): Promise<boolean> {
  return isCanonicalPathApproved(await normalizePathAsync(path));
}

function isCanonicalPathApproved(normalized: string): boolean {
  for (const [root, record] of approvedRoots) {
    if (
      (record.kind === 'file' && root === normalized) ||
      (record.kind === 'directory' && isInsideRoot(root, normalized))
    )
      return true;
  }
  return false;
}

export async function assertPathApprovedForIpcAsync(
  path: string,
  operation: string
): Promise<string> {
  const normalized = await normalizePathAsync(path);
  if (!isCanonicalPathApproved(normalized)) {
    throw new Error(`${operation} is only allowed inside a folder selected through ShellySVN.`);
  }
  return normalized;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function savePersisted(): void {
  if (!persistenceFile) return;
  try {
    const registry: ApprovedPathRegistryV2 = {
      version: 2,
      roots: Array.from(approvedRoots.values()),
    };
    writeSecureJsonSync(persistenceFile, registry);
  } catch (error) {
    console.error('[approved-paths] Failed to persist approved roots:', error);
  }
}

export function approvePathForIpc(path: string, kind: 'directory' | 'file' = 'directory'): string {
  return approvePathWithSource(path, kind, 'native-picker');
}

function approvePathWithSource(
  path: string,
  kind: 'directory' | 'file',
  source: ApprovedPathRecord['source']
): string {
  const normalized = normalizePath(path);
  if (!approvedRoots.has(normalized)) {
    approvedRoots.set(normalized, {
      canonicalPath: normalized,
      kind,
      approvedAt: new Date().toISOString(),
      source,
    });
    savePersisted();
  }
  return path;
}

/** The Files screen intentionally treats the current user's home as its root. */
export function approveApplicationHomeForIpc(path: string): string {
  return approvePathWithSource(path, 'directory', 'application-home');
}

export function clearApprovedPathsForTests(): void {
  approvedRoots.clear();
  persistenceFile = null;
}

export function isPathApprovedForIpc(path: string): boolean {
  const normalized = normalizePath(path);
  for (const [root, record] of approvedRoots) {
    if (
      (record.kind === 'file' && root === normalized) ||
      (record.kind === 'directory' && isInsideRoot(root, normalized))
    ) {
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
 * - restores native-picker approvals and the current user's application home.
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
  const applicationHome = normalizePath(app.getPath('home'));

  try {
    hardenPrivateFile(persistenceFile);
    const parsed = JSON.parse(readFileSync(persistenceFile, 'utf-8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as ApprovedPathRegistryV2).version === 2
    ) {
      for (const record of (parsed as ApprovedPathRegistryV2).roots ?? []) {
        if (
          typeof record?.canonicalPath === 'string' &&
          (record.kind === 'directory' || record.kind === 'file') &&
          (record.source === 'native-picker' ||
            (record.source === 'application-home' &&
              normalizePath(record.canonicalPath) === applicationHome))
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

  approveApplicationHomeForIpc(applicationHome);
  savePersisted();
}
