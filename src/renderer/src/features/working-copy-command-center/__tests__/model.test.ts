import { describe, expect, it } from 'vitest';
import {
  deriveEligibility,
  mapWithConcurrency,
  measureLocalStatus,
  resetAfterExternalMutation,
  summarizeBatch,
} from '../model';
import type { BatchUpdateItem } from '../types';

function item(overrides: Partial<BatchUpdateItem> = {}): BatchUpdateItem {
  return {
    path: '/wc',
    name: 'wc',
    selected: false,
    requiresDirtyConfirmation: false,
    status: 'checking',
    filesProcessed: 0,
    baseRevision: 4,
    headRevision: 7,
    incomingCount: 3,
    localChangeCount: 0,
    conflictCount: 0,
    ...overrides,
  };
}

describe('working-copy command center model', () => {
  it('selects only clean measured working copies behind HEAD by default', () => {
    expect(deriveEligibility(item()).selected).toBe(true);
    expect(deriveEligibility(item({ headRevision: 4 })).selected).toBe(false);
    expect(deriveEligibility(item({ localChangeCount: 1 })).selected).toBe(false);
    expect(deriveEligibility(item({ blockedKind: 'conflicted' })).selected).toBe(false);
    expect(deriveEligibility(item({ baseRevision: undefined })).blockedKind).toBe('unmeasured');
  });

  it('marks dirty copies as manually confirmable', () => {
    const result = deriveEligibility(item({ localChangeCount: 2 }));
    expect(result.status).toBe('ready');
    expect(result.requiresDirtyConfirmation).toBe(true);
    expect(result.selected).toBe(false);
  });

  it('derives conflicts, changes, and cleanup blockers from status', () => {
    expect(
      measureLocalStatus({
        path: '/wc',
        revision: 4,
        entries: [
          { path: 'a', status: 'M', isDirectory: false },
          { path: 'b', status: 'C', isDirectory: false },
        ],
        error: 'E155004 working copy locked; run cleanup',
      })
    ).toEqual({ changes: 2, conflicts: 1, cleanupRequired: true, staleLock: false });
  });

  it('treats property-only modifications and conflicts as local changes', () => {
    expect(
      measureLocalStatus({
        path: '/wc',
        revision: 4,
        entries: [
          { path: 'a', status: ' ', propsStatus: 'M', isDirectory: false },
          { path: 'b', status: ' ', propsStatus: 'C', isDirectory: false },
        ],
      })
    ).toMatchObject({ changes: 2, conflicts: 1 });
  });

  it('discards stale eligibility after another mutation completes', () => {
    expect(resetAfterExternalMutation(item({ selected: true }))).toMatchObject({
      status: 'idle',
      selected: false,
      baseRevision: undefined,
      headRevision: undefined,
      localChangeCount: undefined,
    });
  });

  it('never exceeds the requested concurrency and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return value * 2;
    });
    expect(result).toEqual([0, 2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });

  it('summarizes every operation state', () => {
    const summary = summarizeBatch([
      item({ selected: true, status: 'ready' }),
      item({ status: 'queued' }),
      item({ status: 'running' }),
      item({ status: 'completed' }),
      item({ status: 'cancelled' }),
      item({ status: 'failed' }),
      item({ status: 'blocked' }),
    ]);
    expect(summary).toMatchObject({
      total: 7,
      selected: 1,
      queued: 1,
      running: 1,
      completed: 1,
      cancelled: 1,
      failed: 1,
      blocked: 1,
    });
  });
});
