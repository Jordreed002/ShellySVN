import type {
  BuildInterruptedMutationRecoveryPlanOptions,
  InterruptedMutationRecord,
  InterruptedMutationRecoveryPlan,
  InterruptedMutationRecoveryStep,
  InterruptedMutationRecoveryStepResult,
  PartialMutationDetection,
  PartialMutationEvidence,
  PartialMutationEvidenceKind,
  StaleWorkingCopyLockInfo,
  SvnStatusEntry,
  WorkingCopyHealthIssue,
  WorkingCopyHealthReport,
  WorkingCopyHealthSeverity,
} from '@shared/types';
import { lstat, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { parseSvnStatusXml } from '@shared/svn-parsers';
import { createSvnXmlParser } from '../utils/svn-xml';
import { withSvnTargets } from '../utils/svn-targets';
import { runSerializedWorkingCopyMutation } from './svn-mutation-queue';
import { runSvnText } from './svn-executor';

// Hardened factory (input size/depth guards, entity expansion disabled);
// options preserve the previous raw XMLParser configuration.
const xmlParser = createSvnXmlParser({
  parseAttributeValue: true,
});
const LARGE_LOCAL_FILE_BYTES = 50 * 1024 * 1024;
const MAX_LOCAL_FILES_TO_STAT = 500;
const MAX_DIRECTORIES_TO_SCAN = 5_000;
/**
 * `svn status --xml` on an enterprise-scale working copy (hundreds of
 * thousands of nodes, ignores included) reaches ~16 MB of XML; cap the scan
 * comfortably above that. Truncation is tolerated downstream: the status
 * parse reports `parseError` as a structured failure, and revision
 * extraction falls back to scanning attributes out of the truncated text.
 */
const HEALTH_SCAN_MAX_STDOUT_BYTES = 32 * 1024 * 1024;

function infoRevisions(xml: string): number[] {
  try {
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
  } catch {
    // `svn info --depth infinity` output is capped and working copies large
    // enough to hit that cap produce truncated XML that no parser accepts.
    // The revision attributes are svn-generated and uniform, so scanning them
    // out of the truncated text still yields a usable min/max sample — and,
    // importantly, a failed health scan must not take the handler down.
    const revisions: number[] = [];
    const pattern = /\brevision="(\d+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml)) !== null) {
      revisions.push(Number(match[1]));
    }
    return revisions;
  }
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
        maxStdoutBytes: HEALTH_SCAN_MAX_STDOUT_BYTES,
        maxStderrBytes: 64 * 1024,
      }
    ),
    runSvnText(withSvnTargets(['info', '--xml', '--depth', 'infinity'], [approvedPath]), {
      cwd: approvedPath,
      maxStdoutBytes: HEALTH_SCAN_MAX_STDOUT_BYTES,
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

// ---------------------------------------------------------------------------
// Item #31 — interrupted-mutation recovery (partial update/commit detection)
// ---------------------------------------------------------------------------
//
// The evidence / detection / recovery-plan shapes live in @shared/types (they
// cross IPC on the lifecycle channels); re-exported here for compatibility
// with existing main-process imports.

export type {
  BuildInterruptedMutationRecoveryPlanOptions,
  InterruptedMutationRecoveryPlan,
  InterruptedMutationRecoveryStep,
  InterruptedMutationRecoveryStepKind,
  InterruptedMutationRecoveryStepResult,
  PartialMutationDetection,
  PartialMutationEvidence,
  PartialMutationEvidenceKind,
} from '@shared/types';

const MAX_EVIDENCE_PATHS_LISTED = 10;
const MAX_RECOVERY_STEP_OUTPUT_CHARS = 4_000;
const LOCKED_WORKING_COPY_PATTERN = /\bE155004\b|working copy.*\blocked\b|run 'svn cleanup'/i;
const INCOMPLETE_WORKING_COPY_PATTERN = /\bis incomplete\b|\bE155015\b/i;

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

/** Resolve a status entry path (often relative to the target) and keep it inside the root. */
function containedEntryPath(root: string, entryPath: string): string | null {
  if (!entryPath) return null;
  const resolved = isAbsolute(entryPath) ? entryPath : join(root, entryPath);
  return isPathWithinRoot(root, resolved) ? resolved : null;
}

/**
 * Pull the interrupted-mutation markers out of a `svn status --xml` response:
 * `item="missing"` (versioned path never materialized / deleted mid-update)
 * and `item="incomplete"` (directory whose update was cut short).
 */
function parseInterruptedStatusMarkers(
  xml: string,
  root: string
): { missing: string[]; incomplete: string[] } {
  const parsed = xmlParser.parse(xml) as {
    status?: {
      target?: {
        entry?:
          | Array<{ '@_path'?: string; 'wc-status'?: { '@_item'?: string } }>
          | {
              '@_path'?: string;
              'wc-status'?: { '@_item'?: string };
            };
        changelist?:
          | Array<{ entry?: Array<{ '@_path'?: string; 'wc-status'?: { '@_item'?: string } }> }>
          | { entry?: Array<{ '@_path'?: string; 'wc-status'?: { '@_item'?: string } }> };
      };
    };
  };

  const rawEntries = parsed.status?.target?.entry;
  const entries = rawEntries ? (Array.isArray(rawEntries) ? rawEntries : [rawEntries]) : [];
  const changelists = parsed.status?.target?.changelist;
  for (const changelist of changelists
    ? Array.isArray(changelists)
      ? changelists
      : [changelists]
    : []) {
    for (const entry of changelist.entry ?? []) entries.push(entry);
  }

  const missing: string[] = [];
  const incomplete: string[] = [];
  for (const entry of entries) {
    const item = entry['wc-status']?.['@_item'];
    const resolved = containedEntryPath(root, entry['@_path'] ?? '');
    if (!resolved) continue;
    if (item === 'missing') missing.push(resolved);
    else if (item === 'incomplete') incomplete.push(resolved);
  }
  return { missing, incomplete };
}

/**
 * Scan a working copy for evidence that a mutation (update/commit) was
 * interrupted (backlog item #31). Evidence, in order of reliability:
 * 1. a leftover `.svn/lock` administrative file (reuses the item #23 detector),
 * 2. SVN itself refusing to operate — "working copy locked" / E155004,
 * 3. `svn status` markers: `missing` and `incomplete` entries,
 * 4. `svn info` reporting the working copy as incomplete.
 *
 * Read-only probes only, and deliberately no IPC-approval assert: like the
 * item #23 startup scan, this runs against recently used paths that may not be
 * approved yet. The mutating recovery executor below does assert approval.
 */
export async function detectPartialWorkingCopyMutation(
  workingCopyPath: string
): Promise<PartialMutationDetection> {
  const evidence: PartialMutationEvidence[] = [];
  const notes: string[] = [];
  const has = (kind: PartialMutationEvidenceKind) => evidence.some((item) => item.kind === kind);

  try {
    const stale = await detectStaleWorkingCopyLock(workingCopyPath);
    if (stale) {
      evidence.push({
        kind: 'stale-admin-lock',
        detail: `Leftover administrative lock file: ${stale.lockPath}`,
        paths: [stale.lockPath],
      });
    }
  } catch (error) {
    notes.push(`Lock probe failed: ${summarizeError(error)}`);
  }

  try {
    const statusXml = await runSvnText(
      withSvnTargets(['status', '--xml', '--no-ignore'], [workingCopyPath]),
      { cwd: workingCopyPath, maxStdoutBytes: 16 * 1024 * 1024, maxStderrBytes: 64 * 1024 }
    );
    if (typeof statusXml === 'string') {
      const { missing, incomplete } = parseInterruptedStatusMarkers(statusXml, workingCopyPath);
      if (missing.length > 0 && !has('missing-versioned-paths')) {
        evidence.push({
          kind: 'missing-versioned-paths',
          detail: `${missing.length} versioned path${missing.length === 1 ? '' : 's'} ${
            missing.length === 1 ? 'is' : 'are'
          } missing — consistent with an interrupted update.`,
          paths: missing.slice(0, MAX_EVIDENCE_PATHS_LISTED),
        });
      }
      if (incomplete.length > 0 && !has('incomplete-tree')) {
        evidence.push({
          kind: 'incomplete-tree',
          detail: `${incomplete.length} director${
            incomplete.length === 1 ? 'y was' : 'ies were'
          } left incomplete by a cut-short update.`,
          paths: incomplete.slice(0, MAX_EVIDENCE_PATHS_LISTED),
        });
      }
    }
  } catch (error) {
    const message = summarizeError(error);
    if (LOCKED_WORKING_COPY_PATTERN.test(message) && !has('stale-admin-lock')) {
      evidence.push({
        kind: 'stale-admin-lock',
        detail: 'SVN reports the working copy as locked (run "svn cleanup").',
        paths: [],
      });
    } else {
      notes.push(`svn status probe failed: ${message}`);
    }
  }

  try {
    await runSvnText(withSvnTargets(['info', '--xml'], [workingCopyPath]), {
      cwd: workingCopyPath,
      maxStdoutBytes: 16 * 1024 * 1024,
      maxStderrBytes: 64 * 1024,
    });
  } catch (error) {
    const message = summarizeError(error);
    if (INCOMPLETE_WORKING_COPY_PATTERN.test(message) && !has('incomplete-tree')) {
      evidence.push({
        kind: 'incomplete-tree',
        detail: 'svn info reports the working copy as incomplete.',
        paths: [],
      });
    } else if (LOCKED_WORKING_COPY_PATTERN.test(message) && !has('stale-admin-lock')) {
      evidence.push({
        kind: 'stale-admin-lock',
        detail: 'SVN reports the working copy as locked (run "svn cleanup").',
        paths: [],
      });
    } else {
      notes.push(`svn info probe failed: ${message}`);
    }
  }

  return {
    workingCopyPath,
    detectedAt: new Date().toISOString(),
    hasEvidence: evidence.length > 0,
    evidence,
    notes,
  };
}

function describeEvidence(evidence: PartialMutationEvidence[]): string {
  if (evidence.length === 0) return 'no current-state evidence';
  return evidence.map((item) => item.kind).join(', ');
}

/**
 * Compose the Phase 1 interruption journal with current-state detection into an
 * ordered, data-only remediation proposal (backlog item #31): the journal says
 * "a mutation was interrupted here", detection confirms the working copy still
 * shows the damage, and the proposal is `svn cleanup` first, then the retry
 * step the evidence supports, then a verification status. Proposals are never
 * executed here — see `executeInterruptedMutationRecoveryPlan`.
 */
export function buildInterruptedMutationRecoveryPlan(
  workingCopyPath: string,
  detection: PartialMutationDetection,
  journal?: InterruptedMutationRecord | null,
  options: BuildInterruptedMutationRecoveryPlanOptions = {}
): InterruptedMutationRecoveryPlan {
  const steps: InterruptedMutationRecoveryStep[] = [];
  const hasJournal = Boolean(journal);
  const suggestsUpdate = detection.evidence.some(
    (item) => item.kind === 'missing-versioned-paths' || item.kind === 'incomplete-tree'
  );

  if (detection.hasEvidence || hasJournal) {
    steps.push({
      kind: 'svn-cleanup',
      command: ['cleanup'],
      description:
        'Release leftover administrative locks and finish any interrupted bookkeeping. Idempotent: safe to re-run.',
    });

    const interruptedOperation = options.interruptedOperation ?? (suggestsUpdate ? 'update' : null);
    if (interruptedOperation === 'update') {
      steps.push({
        kind: 'retry-update',
        command: ['update'],
        description:
          'Re-run the update to fetch the paths the interrupted pass never materialized.',
      });
    } else if (interruptedOperation === 'commit') {
      steps.push({
        kind: 'retry-commit',
        command: ['status'],
        description:
          'List the local changes that were mid-commit, then re-run the commit (its message must be re-confirmed).',
      });
    }

    steps.push({
      kind: 'verify-status',
      command: ['status'],
      description: 'Verify the working copy is healthy again after recovery.',
    });
  }

  const evidenceSummary = describeEvidence(detection.evidence);
  const rationale = hasJournal
    ? `A mutation was interrupted on ${journal?.interruptedAt} (reason: ${journal?.reason}); the journal is corroborated by: ${evidenceSummary}.`
    : `Current working-copy state shows: ${evidenceSummary}.`;

  return {
    workingCopyPath,
    createdAt: new Date().toISOString(),
    source: hasJournal ? (detection.hasEvidence ? 'journal+detection' : 'journal') : 'detection',
    rationale,
    evidence: detection.evidence,
    steps,
  };
}

/**
 * Explicitly invoked executor for a proposed recovery plan (never automatic).
 * Every step runs serialized with other working-copy mutations, targets are
 * pinned to the IPC-approved working copy (step commands carry no paths of
 * their own, so a mismatched plan cannot redirect them), and execution stops
 * at the first failing step — the rest are reported as skipped. Re-running a
 * plan is safe: `svn cleanup`/`svn update`/`svn status` are idempotent on an
 * already-recovered working copy.
 */
export async function executeInterruptedMutationRecoveryPlan(
  workingCopyPath: string,
  plan: InterruptedMutationRecoveryPlan
): Promise<{
  workingCopyPath: string;
  steps: InterruptedMutationRecoveryStepResult[];
  allSucceeded: boolean;
}> {
  const approvedPath = assertPathApprovedForIpc(workingCopyPath, 'Interrupted-mutation recovery');

  return runSerializedWorkingCopyMutation(approvedPath, async () => {
    const results: InterruptedMutationRecoveryStepResult[] = [];
    let failed = false;

    for (const step of plan.steps) {
      const command = withSvnTargets(step.command, [approvedPath]);
      if (failed) {
        results.push({
          kind: step.kind,
          command,
          success: false,
          skipped: true,
          output: '',
          error: 'Skipped because an earlier recovery step failed.',
        });
        continue;
      }

      try {
        const output = await runSvnText(command, {
          cwd: approvedPath,
          maxStdoutBytes: 1024 * 1024,
          maxStderrBytes: 64 * 1024,
        });
        results.push({
          kind: step.kind,
          command,
          success: true,
          skipped: false,
          output: (output ?? '').slice(0, MAX_RECOVERY_STEP_OUTPUT_CHARS),
        });
      } catch (error) {
        failed = true;
        results.push({
          kind: step.kind,
          command,
          success: false,
          skipped: false,
          output: '',
          error: summarizeError(error),
        });
      }
    }

    return { workingCopyPath: approvedPath, steps: results, allSucceeded: !failed };
  });
}
