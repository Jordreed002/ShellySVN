/**
 * Aggregate dirty badges for working-copy groups (#59).
 *
 * A group header — and the sidebar rail — shows the *union* of its members'
 * local state, derived from the same one-status-read-per-working-copy cache
 * the sidebar rows already consume (`useWorkingCopyOverview`, backed by
 * `['sidebar:overview', …]`). No second status pass is made: if a member has
 * not been measured, it is reported as `unmeasured` rather than guessed.
 */

import type { WorkingCopySummary } from './workingCopyOverview';

export interface GroupStatusAggregate {
  /** Sum of pending changes across measured members. */
  changes: number;
  /** Sum of conflicted entries across measured members. */
  conflicts: number;
  /** Members whose folder is missing (presence 'none'). */
  missing: number;
  /** Members whose status has not resolved — the union is incomplete. */
  unmeasured: number;
  /** Measured members backing the counts. */
  measured: number;
}

export const EMPTY_GROUP_AGGREGATE: GroupStatusAggregate = {
  changes: 0,
  conflicts: 0,
  missing: 0,
  unmeasured: 0,
  measured: 0,
};

/**
 * Fold per-working-copy summaries into one aggregate. `overview` misses are
 * counted as unmeasured, never as clean: a badge claiming "clean" while a
 * member's status is still loading would be a lie.
 */
export function aggregateWorkingCopyStatus(
  paths: readonly string[],
  overview: ReadonlyMap<string, WorkingCopySummary>
): GroupStatusAggregate {
  const aggregate = { ...EMPTY_GROUP_AGGREGATE };
  for (const path of paths) {
    const summary = overview.get(path);
    if (!summary || summary.presence === 'unknown') {
      aggregate.unmeasured += 1;
      continue;
    }
    if (summary.presence === 'none') {
      aggregate.missing += 1;
      continue;
    }
    if (!summary.status) {
      aggregate.unmeasured += 1;
      continue;
    }
    aggregate.measured += 1;
    aggregate.changes += summary.status.changes;
    aggregate.conflicts += summary.status.conflicts;
  }
  return aggregate;
}

/** Badge tone for an aggregate — conflicts outrank plain modifications. */
export function aggregateTone(
  aggregate: GroupStatusAggregate
): 'neutral' | 'modified' | 'conflict' | null {
  if (aggregate.conflicts > 0) return 'conflict';
  if (aggregate.changes > 0) return 'modified';
  if (aggregate.missing > 0) return 'neutral';
  return null;
}

/** Spoken summary for the badge's title, e.g. `3 changes · 1 conflict · 1 missing`. */
export function describeAggregate(aggregate: GroupStatusAggregate): string {
  const parts = [
    aggregate.changes > 0
      ? `${aggregate.changes} pending change${aggregate.changes === 1 ? '' : 's'}`
      : '',
    aggregate.conflicts > 0
      ? `${aggregate.conflicts} conflict${aggregate.conflicts === 1 ? '' : 's'}`
      : '',
    aggregate.missing > 0
      ? `${aggregate.missing} missing working cop${aggregate.missing === 1 ? 'y' : 'ies'}`
      : '',
    aggregate.unmeasured > 0 ? `${aggregate.unmeasured} still checking` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'No pending changes';
}
