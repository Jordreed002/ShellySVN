import type {
  StaleWorkingCopyLockInfo,
  SvnStatusEntry,
  WorkingCopyHealthIssue,
  WorkingCopyHealthReport,
  WorkingCopyHealthSeverity,
} from '@shared/types';
import { XMLParser } from 'fast-xml-parser';
import { lstat, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { parseSvnStatusXml } from '@shared/svn-parsers';
import { withSvnTargets } from '../utils/svn-targets';
import { runSvnText } from './svn-executor';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
});
const LARGE_LOCAL_FILE_BYTES = 50 * 1024 * 1024;
const MAX_LOCAL_FILES_TO_STAT = 500;
const MAX_DIRECTORIES_TO_SCAN = 5_000;

function infoRevisions(xml: string): number[] {
  const parsed = xmlParser.parse(xml) as {
    info?: {
      entry?: Array<{ '@_revision'?: number | string }> | { '@_revision'?: number | string };
    };
  };
  const raw = parsed.info?.entry;
  const entries = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return entries
    .map((entry) => Number(entry['@_revision']))
    .filter((revision) => Number.isInteger(revision) && revision >= 0);
}

function issue(
  kind: WorkingCopyHealthIssue['kind'],
  severity: WorkingCopyHealthSeverity,
  title: string,
  detail: string,
  paths: string[]
): WorkingCopyHealthIssue {
  return { id: kind, kind, severity, title, detail, paths };
}

function deriveWorkingCopyHealth(
  workingCopyPath: string,
  entries: SvnStatusEntry[],
  revisions: number[],
  largeLocalFiles: Array<{ path: string; ignored: boolean }> = [],
  nestedWorkingCopies: string[] = []
): WorkingCopyHealthReport {
  const pathsFor = (predicate: (entry: SvnStatusEntry) => boolean) =>
    entries.filter(predicate).map((entry) => entry.path);
  const conflicts = pathsFor((entry) => entry.status === 'C');
  const missing = pathsFor((entry) => entry.status === '!');
  const obstructed = pathsFor((entry) => entry.status === '~');
  const switched = pathsFor((entry) => entry.switched === true);
  const externals = pathsFor((entry) => entry.status === 'X');
  const localLocks = pathsFor((entry) => entry.lock !== undefined);
  const unversioned = pathsFor((entry) => entry.status === '?');
  const ignored = pathsFor((entry) => entry.status === 'I');
  const uniqueRevisions = new Set(revisions);
  const issues: WorkingCopyHealthIssue[] = [];

  if (conflicts.length)
    issues.push(
      issue(
        'conflict',
        'danger',
        'Unresolved conflicts',
        `${conflicts.length} path${conflicts.length === 1 ? '' : 's'} must be resolved.`,
        conflicts
      )
    );
  if (missing.length)
    issues.push(
      issue(
        'missing',
        'warning',
        'Missing versioned paths',
        `${missing.length} versioned path${missing.length === 1 ? ' is' : 's are'} absent locally.`,
        missing
      )
    );
  if (obstructed.length)
    issues.push(
      issue(
        'obstructed',
        'danger',
        'Obstructed working-copy paths',
        'Filesystem nodes do not match the repository node kind.',
        obstructed
      )
    );
  if (switched.length)
    issues.push(
      issue(
        'switched',
        'warning',
        'Switched paths',
        `${switched.length} path${switched.length === 1 ? ' points' : 's point'} at a different repository URL.`,
        switched
      )
    );
  if (externals.length)
    issues.push(
      issue(
        'external',
        'info',
        'SVN externals present',
        `${externals.length} external working cop${externals.length === 1 ? 'y is' : 'ies are'} managed separately.`,
        externals
      )
    );
  if (uniqueRevisions.size > 1)
    issues.push(
      issue(
        'mixed-revisions',
        'warning',
        'Mixed working-copy revisions',
        `Nodes span r${Math.min(...uniqueRevisions)}–r${Math.max(...uniqueRevisions)}.`,
        []
      )
    );
  if (localLocks.length)
    issues.push(
      issue(
        'local-lock',
        'info',
        'Locally locked paths',
        `${localLocks.length} path${localLocks.length === 1 ? ' has' : 's have'} working-copy lock metadata.`,
        localLocks
      )
    );
  const largeUnversioned = largeLocalFiles.filter((file) => !file.ignored).map((file) => file.path);
  const largeIgnored = largeLocalFiles.filter((file) => file.ignored).map((file) => file.path);
  if (largeUnversioned.length)
    issues.push(
      issue(
        'large-unversioned',
        'warning',
        'Large unversioned files',
        'Large local files may be accidental build artifacts.',
        largeUnversioned
      )
    );
  if (largeIgnored.length)
    issues.push(
      issue(
        'large-ignored',
        'info',
        'Large ignored files',
        'Ignored files consume significant working-copy disk space.',
        largeIgnored
      )
    );
  if (nestedWorkingCopies.length)
    issues.push(
      issue(
        'nested-working-copy',
        'warning',
        'Nested working copies',
        'Nested SVN administrative roots can make parent operations incomplete or surprising.',
        nestedWorkingCopies
      )
    );

  return {
    workingCopyPath,
    scannedAt: new Date().toISOString(),
    minimumRevision: revisions.length ? Math.min(...revisions) : null,
    maximumRevision: revisions.length ? Math.max(...revisions) : null,
    counts: {
      changes: entries.filter((entry) => ![' ', 'I', 'X'].includes(entry.status)).length,
      conflicts: conflicts.length,
      switched: switched.length,
      externals: externals.length,
      unversioned: unversioned.length,
      ignored: ignored.length,
    },
    issues,
  };
}

async function findLargeLocalFiles(
  root: string,
  entries: SvnStatusEntry[]
): Promise<Array<{ path: string; ignored: boolean }>> {
  const candidates = entries
    .filter(
      (entry) =>
        (entry.status === '?' || entry.status === 'I') && isPathWithinRoot(root, entry.path)
    )
    .slice(0, MAX_LOCAL_FILES_TO_STAT);
  const results = await Promise.all(
    candidates.map(async (entry) => {
      try {
        // lstat deliberately avoids following a local symlink beyond the approved root.
        const metadata = await lstat(entry.path);
        return metadata.isFile() && metadata.size >= LARGE_LOCAL_FILE_BYTES
          ? { path: entry.path, ignored: entry.status === 'I' }
          : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter((result): result is { path: string; ignored: boolean } => result !== null);
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return (
    child === '' ||
    (!child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      child !== '..' &&
      !isAbsolute(child))
  );
}

async function findNestedWorkingCopies(root: string): Promise<string[]> {
  const queue = [root];
  const found: string[] = [];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_DIRECTORIES_TO_SCAN) {
    const directory = queue.shift();
    if (!directory) break;
    visited += 1;
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    if (
      directory !== root &&
      children.some((child) => child.isDirectory() && child.name === '.svn')
    ) {
      found.push(directory);
      continue;
    }
    for (const child of children) {
      if (child.isDirectory() && child.name !== '.svn') queue.push(join(directory, child.name));
    }
  }
  return found.slice(0, 100);
}

export async function scanWorkingCopyHealth(path: string): Promise<WorkingCopyHealthReport> {
  const approvedPath = assertPathApprovedForIpc(path, 'Working-copy health scan');
  const [statusXml, infoXml, nestedWorkingCopies] = await Promise.all([
    runSvnText(
      withSvnTargets(['status', '--xml', '--no-ignore', '--depth', 'infinity'], [approvedPath]),
      {
        cwd: approvedPath,
        maxStdoutBytes: 16 * 1024 * 1024,
        maxStderrBytes: 64 * 1024,
      }
    ),
    runSvnText(withSvnTargets(['info', '--xml', '--depth', 'infinity'], [approvedPath]), {
      cwd: approvedPath,
      maxStdoutBytes: 16 * 1024 * 1024,
      maxStderrBytes: 64 * 1024,
    }),
    findNestedWorkingCopies(approvedPath),
  ]);
  const status = parseSvnStatusXml(statusXml, approvedPath);
  if (status.parseError) throw new Error('SVN returned an invalid working-copy status response.');
  // Treat command output as untrusted: never surface or inspect paths outside the approved root.
  const containedEntries = status.entries.filter((entry) =>
    isPathWithinRoot(approvedPath, entry.path)
  );
  const largeLocalFiles = await findLargeLocalFiles(approvedPath, containedEntries);
  return deriveWorkingCopyHealth(
    approvedPath,
    containedEntries,
    infoRevisions(infoXml),
    largeLocalFiles,
    nestedWorkingCopies
  );
}

/**
 * Detect a stale SVN working-copy administrative lock (backlog item #23).
 *
 * A healthy WC-NG working copy only has `<root>/.svn/lock` while an SVN
 * command holds the admin area; a leftover file after a crash or force-quit
 * makes every subsequent SVN command fail with "working copy locked" until
 * it is removed (`svn cleanup` also removes it). Only the file form is
 * reported: the legacy directory-shaped lock belongs to pre-1.7 layouts and
 * is intentionally out of scope.
 */
export async function detectStaleWorkingCopyLock(
  workingCopyPath: string
): Promise<StaleWorkingCopyLockInfo | null> {
  const lockPath = join(workingCopyPath, '.svn', 'lock');
  try {
    const stats = await lstat(lockPath);
    if (!stats.isFile()) return null;
  } catch {
    return null;
  }
  return {
    workingCopyPath,
    lockPath,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Remove a stale `.svn/lock` file after the renderer explicitly confirmed.
 *
 * The working-copy path must already be IPC-approved; the only path ever
 * deleted is the exact `<approved-root>/.svn/lock` file constructed here, and
 * only when it still exists as a regular file. Nothing is removed
 * automatically at detection time.
 */
export async function removeStaleWorkingCopyLock(path: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const approvedPath = assertPathApprovedForIpc(path, 'Stale working-copy lock removal');
  const lockPath = join(approvedPath, '.svn', 'lock');
  try {
    const stats = await lstat(lockPath);
    if (!stats.isFile()) {
      return { success: false, error: 'No stale .svn/lock file found for this working copy.' };
    }
    await rm(lockPath, { force: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: false, error: 'No stale .svn/lock file found for this working copy.' };
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { success: true };
}
