/**
 * Wording and tone for one working copy's place in the batch update pipeline,
 * shared by the Home focus panel and the working-copy list so both say the
 * same thing about the same checkout.
 */
import type { BatchUpdateItem } from './types';

/** What the server side of a working copy looks like right now. */
export function batchItemStateLabel(item: BatchUpdateItem): string {
  if (item.status === 'checking') return 'Checking…';
  if (item.status === 'queued') return 'Queued';
  if (item.status === 'running')
    return item.cancellationRequested
      ? 'Cancelling…'
      : `Updating · ${item.filesProcessed} ${item.filesProcessed === 1 ? 'file' : 'files'}`;
  if (item.status === 'completed')
    return item.verificationError
      ? 'Updated · verification unavailable'
      : item.revision == null
        ? 'Updated'
        : `Updated to r${item.revision}`;
  if (item.status === 'cancelled') return 'Cancelled';
  if (item.status === 'failed') return 'Update failed';
  if (item.blockedReason) return item.blockedReason;
  if (item.headRevision !== undefined && item.baseRevision !== undefined) {
    if (item.headRevision <= item.baseRevision) return 'Up to date';
    const count = item.incomingCount ?? item.headRevision - item.baseRevision;
    return `${count}${item.incomingCapped ? '+' : ''} incoming ${count === 1 ? 'revision' : 'revisions'}`;
  }
  return 'Not checked';
}

/** Text colour for {@link batchItemStateLabel}. SVN status colours keep their meaning. */
export function batchItemTone(item: BatchUpdateItem): string {
  if (item.status === 'failed' || item.status === 'blocked') return 'text-svn-conflict';
  if (item.status === 'completed')
    return item.verificationError ? 'text-svn-modified' : 'text-svn-normal';
  if (item.status === 'running' || item.status === 'queued' || item.status === 'checking')
    return 'text-accent';
  if (
    item.headRevision !== undefined &&
    item.baseRevision !== undefined &&
    item.headRevision > item.baseRevision
  )
    return 'text-svn-modified';
  return 'text-text-muted';
}

/** BASE → HEAD, with an em dash for a side nobody has asked about yet. */
export function batchItemRevisions(item: BatchUpdateItem): string {
  const base = item.baseRevision === undefined ? '—' : `r${item.baseRevision}`;
  const head = item.headRevision === undefined ? '—' : `r${item.headRevision}`;
  return `BASE ${base} → HEAD ${head}`;
}

/** "fresh · 2m ago" for a measured item; null when it was never checked. */
export function batchItemCheckedLabel(item: BatchUpdateItem, now = Date.now()): string | null {
  if (!item.checkedAt) return null;
  const ageSeconds = Math.max(0, Math.floor((now - item.checkedAt) / 1000));
  const age =
    ageSeconds < 60
      ? 'just now'
      : ageSeconds < 3600
        ? `${Math.floor(ageSeconds / 60)}m ago`
        : `${Math.floor(ageSeconds / 3600)}h ago`;
  return `checked ${age}${item.measurementSource === 'cached' ? ' · cached' : ''}`;
}

/** True while the pipeline is doing something with this working copy. */
export function isBatchItemBusy(item: BatchUpdateItem): boolean {
  return item.status === 'checking' || item.status === 'queued' || item.status === 'running';
}
