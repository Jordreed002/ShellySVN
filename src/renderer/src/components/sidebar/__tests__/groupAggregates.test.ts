import { describe, expect, it } from 'vitest';

import { aggregateTone, aggregateWorkingCopyStatus, describeAggregate } from '../groupAggregates';
import type { WorkingCopySummary } from '../workingCopyOverview';

function summary(partial: Partial<WorkingCopySummary>): WorkingCopySummary {
  return { presence: 'full', ...partial };
}

describe('aggregateWorkingCopyStatus', () => {
  it('sums changes and conflicts across measured members', () => {
    const overview = new Map<string, WorkingCopySummary>([
      ['/a', summary({ status: { changes: 3, conflicts: 0, problems: { total: 0, blocking: 0, summary: '' }, source: 'network', cacheAge: 0 } })],
      ['/b', summary({ status: { changes: 2, conflicts: 1, problems: { total: 1, blocking: 1, summary: 'x' }, source: 'network', cacheAge: 0 } })],
    ]);
    expect(aggregateWorkingCopyStatus(['/a', '/b'], overview)).toMatchObject({
      changes: 5,
      conflicts: 1,
      missing: 0,
      unmeasured: 0,
      measured: 2,
    });
  });

  it('counts missing folders and unmeasured members instead of guessing them clean', () => {
    const overview = new Map<string, WorkingCopySummary>([
      ['/gone', summary({ presence: 'none' })],
      ['/loading', summary({ presence: 'unknown' })],
      ['/here', summary({ status: undefined })],
    ]);
    const aggregate = aggregateWorkingCopyStatus(['/gone', '/loading', '/here', '/absent'], overview);
    expect(aggregate.missing).toBe(1);
    expect(aggregate.unmeasured).toBe(3);
    expect(aggregate.changes).toBe(0);
    expect(aggregate.measured).toBe(0);
  });

  it('returns the empty aggregate for an empty section', () => {
    expect(aggregateWorkingCopyStatus([], new Map())).toEqual({
      changes: 0,
      conflicts: 0,
      missing: 0,
      unmeasured: 0,
      measured: 0,
    });
  });
});

describe('aggregateTone', () => {
  it('conflicts outrank modifications, which outrank missing-only', () => {
    expect(aggregateTone({ changes: 1, conflicts: 2, missing: 0, unmeasured: 0, measured: 1 })).toBe('conflict');
    expect(aggregateTone({ changes: 1, conflicts: 0, missing: 3, unmeasured: 0, measured: 1 })).toBe('modified');
    expect(aggregateTone({ changes: 0, conflicts: 0, missing: 1, unmeasured: 0, measured: 0 })).toBe('neutral');
    expect(aggregateTone({ changes: 0, conflicts: 0, missing: 0, unmeasured: 2, measured: 0 })).toBeNull();
  });
});

describe('describeAggregate', () => {
  it('names every non-zero part and never claims clean while unmeasured', () => {
    expect(
      describeAggregate({ changes: 2, conflicts: 1, missing: 1, unmeasured: 1, measured: 3 })
    ).toBe('2 pending changes · 1 conflict · 1 missing working copy · 1 still checking');
    expect(describeAggregate({ changes: 0, conflicts: 0, missing: 0, unmeasured: 0, measured: 4 })).toBe(
      'No pending changes'
    );
  });
});
