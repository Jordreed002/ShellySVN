import type { SvnStatusResult } from '@shared/types';
import type { BatchUpdateItem, BatchUpdateSummary } from './types';

const NON_CHANGE = new Set([' ', '?', 'I', 'X']);

export interface LocalMeasurement {
  changes: number;
  conflicts: number;
  cleanupRequired: boolean;
  staleLock: boolean;
}

export function measureLocalStatus(status: SvnStatusResult): LocalMeasurement {
  let changes = 0;
  let conflicts = 0;
  let staleLock = false;
  for (const entry of status.entries) {
    const textConflict = entry.status === 'C';
    const propertyConflict = entry.propsStatus === 'C';
    if (textConflict || propertyConflict || entry.treeConflict) conflicts += 1;
    if (!NON_CHANGE.has(entry.status) || !NON_CHANGE.has(entry.propsStatus ?? ' ')) changes += 1;
    if (entry.status === '!' || (/lock/i.test(entry.path) && entry.status === '~'))
      staleLock = true;
  }
  const error = `${status.errorCode ?? ''} ${status.error ?? ''}`;
  return {
    changes,
    conflicts,
    cleanupRequired: /E155004|cleanup|working copy.*locked/i.test(error),
    staleLock,
  };
}

export function deriveEligibility(
  item: BatchUpdateItem,
  { autoSelect = true }: { autoSelect?: boolean } = {}
): BatchUpdateItem {
  if (item.blockedKind && item.blockedKind !== 'at-head') {
    return { ...item, selected: false, status: 'blocked' };
  }
  if (item.baseRevision === undefined || item.headRevision === undefined) {
    return {
      ...item,
      selected: false,
      status: 'blocked',
      blockedKind: 'unmeasured',
      blockedReason: 'Local and repository revisions have not been measured.',
    };
  }
  if (item.headRevision <= item.baseRevision) {
    return {
      ...item,
      selected: false,
      status: 'ready',
      blockedKind: 'at-head',
      blockedReason: 'Already at HEAD.',
    };
  }
  const dirty = (item.localChangeCount ?? 0) > 0;
  return {
    ...item,
    status: 'ready',
    blockedKind: undefined,
    blockedReason: undefined,
    requiresDirtyConfirmation: dirty,
    selected: autoSelect && !dirty,
  };
}

export function resetAfterExternalMutation(item: BatchUpdateItem): BatchUpdateItem {
  return {
    ...item,
    baseRevision: undefined,
    headRevision: undefined,
    incomingCount: undefined,
    incomingCapped: undefined,
    localChangeCount: undefined,
    conflictCount: undefined,
    checkedAt: undefined,
    measurementSource: undefined,
    selected: false,
    requiresDirtyConfirmation: false,
    blockedKind: undefined,
    blockedReason: undefined,
    error: undefined,
    status: 'idle',
  };
}

export function summarizeBatch(items: readonly BatchUpdateItem[]): BatchUpdateSummary {
  const summary: BatchUpdateSummary = {
    total: items.length,
    selected: 0,
    queued: 0,
    running: 0,
    completed: 0,
    cancelled: 0,
    failed: 0,
    blocked: 0,
  };
  for (const item of items) {
    if (item.selected) summary.selected += 1;
    if (item.status === 'queued') summary.queued += 1;
    if (item.status === 'running') summary.running += 1;
    if (item.status === 'completed') summary.completed += 1;
    if (item.status === 'cancelled') summary.cancelled += 1;
    if (item.status === 'failed') summary.failed += 1;
    if (item.status === 'blocked') summary.blocked += 1;
  }
  return summary;
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = Array.from<R>({ length: values.length });
  let next = 0;
  async function run(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()));
  return results;
}

export function workingCopyName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;
}
