/**
 * Pure state machine for the conflict-resolution flows (#55, #56).
 *
 * The wizard dialogs keep per-conflict state in one array of items; every
 * transition (resolve, defer, reopen, batch planning, confirmation summaries)
 * is a pure function over that array so the behavior is unit-testable without
 * rendering anything. The components own only IO: SVN calls, filesystem reads,
 * and focus/navigation.
 */

import {
  type ConflictKind,
  type ConflictResolutionMode,
  acceptModeLabel,
  acceptModeOutcome,
  isModeApplicable,
} from './conflictAcceptModes';

export type ConflictItemStatus = 'pending' | 'in-progress' | 'resolved' | 'skipped';

export interface ConflictItem {
  path: string;
  kind: ConflictKind;
  status: ConflictItemStatus;
  /** The accept mode chosen/applied (historical aliases `merged`/`custom` map to `working`). */
  resolution?: ConflictResolutionMode | 'merged' | 'custom';
  error?: string;
}

/** Optional richer input callers can pass when they already know conflict kinds. */
export interface ConflictDescriptor {
  path: string;
  kind?: ConflictKind;
}

export function createConflictItems(
  conflicts: readonly (string | ConflictDescriptor)[]
): ConflictItem[] {
  return conflicts.map((conflict) =>
    typeof conflict === 'string'
      ? { path: conflict, kind: 'text' as const, status: 'pending' as const }
      : { path: conflict.path, kind: conflict.kind ?? 'text', status: 'pending' as const }
  );
}

/** Reclassify an item's kind in place (artifact probing refines `text` later). */
export function withConflictKind(
  items: readonly ConflictItem[],
  path: string,
  kind: ConflictKind
): ConflictItem[] {
  return items.map((item) => (item.path === path ? { ...item, kind } : item));
}

export interface ConflictArtifactClassification {
  kind: ConflictKind;
  /** `path.mine` — your version of the file as it stood before the merge. */
  hasMineArtifact: boolean;
  /** `path.rN` pristine-revision files (lowest = base, highest = theirs). */
  revisionRevisions: number[];
  /** `path.*.prej` property-reject artifacts (lowest = base, highest = theirs). */
  propertyRevisions: number[];
}

function baseNameOf(filePath: string): string {
  const lastSepIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSepIndex >= 0 ? filePath.substring(lastSepIndex + 1) : filePath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify a conflict from its on-disk artifact siblings.
 *
 * - Property conflicts leave `name.*.prej` reject files behind
 *   (`name.mine.prej`, `name.merge-prej.rN`, `name.rN.prej`).
 * - Text conflicts leave `name.mine` plus `name.rN` pristine snapshots.
 * - Binary conflicts produce the same text artifacts (SVN treats them as
 *   unmergeable *text* conflicts); the caller sniffs file content via
 *   {@link looksBinaryContent} to upgrade `text` → `binary`.
 * - Tree conflicts leave no artifacts at all.
 */
export function classifyConflictFromArtifacts(
  filePath: string,
  siblingNames: readonly string[]
): ConflictArtifactClassification {
  const baseName = baseNameOf(filePath);
  const prefix = `${baseName}.`;
  const siblings = siblingNames.filter((name) => name.startsWith(prefix));

  const mineArtifact = siblings.find((name) => name === `${baseName}.mine`);
  const revisionPattern = new RegExp(`^${escapeRegExp(baseName)}\\.r(\\d+)$`);
  const revisionRevisions = siblings
    .map((name) => revisionPattern.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => parseInt(value, 10))
    .toSorted((a, b) => a - b);

  const prejPattern = new RegExp(`^${escapeRegExp(baseName)}\\..*\\.prej$`);
  const prejNames = siblings.filter((name) => prejPattern.test(name) || name === `${baseName}.prej`);
  const prejRevisionPattern = new RegExp(`^${escapeRegExp(baseName)}\\.(?:merge-prej\\.)?r(\\d+)\\.prej$`);
  const propertyRevisions = prejNames
    .map((name) => prejRevisionPattern.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => parseInt(value, 10))
    .toSorted((a, b) => a - b);

  let kind: ConflictKind = 'tree';
  if (prejNames.length > 0) kind = 'property';
  else if (mineArtifact !== undefined || revisionRevisions.length > 0) kind = 'text';

  return {
    kind,
    hasMineArtifact: mineArtifact !== undefined,
    revisionRevisions,
    propertyRevisions,
  };
}

/**
 * Cheap binary sniff for preview decisions: content that decodes with an
 * embedded NUL (or a control-character-heavy first block) cannot be shown as
 * text. Mirrors the commit pre-check heuristic without reaching into the
 * commit feature.
 */
export function looksBinaryContent(content: string): boolean {
  if (content.includes('\u0000')) return true;
  const probe = content.slice(0, 2000);
  if (probe.length === 0) return false;
  let controls = 0;
  for (let index = 0; index < probe.length; index += 1) {
    const code = probe.charCodeAt(index);
    // Tab/LF/CR are text; anything else below 0x20 (plus DEL) counts as binary.
    const isTextControl = code === 9 || code === 10 || code === 13;
    if (!isTextControl && (code < 32 || code === 127)) controls += 1;
  }
  return controls / probe.length > 0.1;
}

/** Mark one item as being worked on with a chosen mode (no status change yet). */
export function markItemInFlight(
  items: readonly ConflictItem[],
  path: string,
  resolution: ConflictResolutionMode | 'merged' | 'custom'
): ConflictItem[] {
  return items.map((item) =>
    item.path === path ? { ...item, status: 'in-progress', resolution, error: undefined } : item
  );
}

export function markItemResolved(items: readonly ConflictItem[], path: string): ConflictItem[] {
  return items.map((item) =>
    item.path === path ? { ...item, status: 'resolved', error: undefined } : item
  );
}

export function markItemFailed(
  items: readonly ConflictItem[],
  path: string,
  error: string
): ConflictItem[] {
  return items.map((item) =>
    item.path === path ? { ...item, status: 'pending', error } : item
  );
}

/** Defer an item: keep it out of the active queue but resumable. */
export function markItemSkipped(items: readonly ConflictItem[], path: string): ConflictItem[] {
  return items.map((item) =>
    item.path === path ? { ...item, status: 'skipped' } : item
  );
}

/** Reopen a resolved/deferred item for a different choice. */
export function reopenItem(items: readonly ConflictItem[], path: string): ConflictItem[] {
  return items.map((item) =>
    item.path === path ? { ...item, status: 'pending', resolution: undefined, error: undefined } : item
  );
}

const isUnresolved = (item: ConflictItem): boolean => item.status !== 'resolved';

/** Index of the next unresolved item after `fromIndex` (wraps to earlier ones). */
export function nextUnresolvedIndex(
  items: readonly ConflictItem[],
  fromIndex: number
): number | null {
  for (let index = fromIndex + 1; index < items.length; index += 1) {
    if (isUnresolved(items[index])) return index;
  }
  for (let index = 0; index < fromIndex; index += 1) {
    if (isUnresolved(items[index])) return index;
  }
  return null;
}

export function conflictStats(items: readonly ConflictItem[]) {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    inProgress: items.filter((item) => item.status === 'in-progress').length,
    resolved: items.filter((item) => item.status === 'resolved').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
  };
}

export function allResolved(items: readonly ConflictItem[]): boolean {
  return items.length > 0 && items.every((item) => item.status === 'resolved');
}

/* ─────────────────────────── batch resolution plan ───────────────────────── */

/** One planned `svn resolve` call. Postpone entries never become steps. */
export interface BatchResolveStep {
  path: string;
  kind: ConflictKind;
  mode: Exclude<ConflictResolutionMode, 'postpone'>;
}

export interface BatchResolvePlan {
  steps: BatchResolveStep[];
  /** Items left untouched (already resolved, or overridden to postpone). */
  postponedPaths: string[];
}

/**
 * Plan a resolve-all-in-one-action run: one default mode for every unresolved
 * conflict, with optional per-conflict overrides. Overrides for items that are
 * already resolved are ignored.
 */
export function planBatchResolve(
  items: readonly ConflictItem[],
  defaultMode: ConflictResolutionMode,
  overrides: Readonly<Record<string, ConflictResolutionMode>> = {}
): BatchResolvePlan {
  const steps: BatchResolveStep[] = [];
  const postponedPaths: string[] = [];
  for (const item of items) {
    if (item.status === 'resolved') continue;
    const mode = overrides[item.path] ?? defaultMode;
    if (mode === 'postpone') {
      postponedPaths.push(item.path);
      continue;
    }
    // Guard against cross-kind nonsense (e.g. `base` on a tree conflict):
    // fall back to `working`, which every kind accepts.
    const effectiveMode: ConflictResolutionMode = isModeApplicable(mode, item.kind)
      ? mode
      : 'working';
    steps.push({ path: item.path, kind: item.kind, mode: effectiveMode });
  }
  return { steps, postponedPaths };
}

export interface BatchConfirmationLine {
  path: string;
  mode: ConflictResolutionMode;
  label: string;
  outcome: string;
  destructive: boolean;
}

/**
 * The final-confirmation summary: one line per conflict stating the exact
 * action about to run, so the user can veto the batch with full knowledge.
 */
export function summarizeBatchPlan(plan: BatchResolvePlan): BatchConfirmationLine[] {
  return plan.steps.map((step) => ({
    path: step.path,
    mode: step.mode,
    label: acceptModeLabel(step.mode),
    outcome: acceptModeOutcome(step.mode),
    destructive: step.mode !== 'working',
  }));
}

export function batchPlanHasDestructiveSteps(plan: BatchResolvePlan): boolean {
  return plan.steps.some((step) => step.mode !== 'working');
}
