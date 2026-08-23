import { describe, expect, it } from 'vitest';

import {
  allResolved,
  batchPlanHasDestructiveSteps,
  classifyConflictFromArtifacts,
  conflictStats,
  createConflictItems,
  looksBinaryContent,
  markItemFailed,
  markItemInFlight,
  markItemResolved,
  markItemSkipped,
  nextUnresolvedIndex,
  planBatchResolve,
  reopenItem,
  summarizeBatchPlan,
  withConflictKind,
} from '../conflictWizardState';

describe('createConflictItems', () => {
  it('defaults bare paths to text conflicts', () => {
    expect(createConflictItems(['a.ts', 'b.ts'])).toEqual([
      { path: 'a.ts', kind: 'text', status: 'pending' },
      { path: 'b.ts', kind: 'text', status: 'pending' },
    ]);
  });

  it('honors richer descriptors', () => {
    expect(
      createConflictItems([{ path: 'dir', kind: 'tree' }, { path: 'x.png', kind: 'binary' }, { path: 'y' }])
    ).toEqual([
      { path: 'dir', kind: 'tree', status: 'pending' },
      { path: 'x.png', kind: 'binary', status: 'pending' },
      { path: 'y', kind: 'text', status: 'pending' },
    ]);
  });
});

describe('classifyConflictFromArtifacts', () => {
  it('recognizes text conflict artifacts', () => {
    const result = classifyConflictFromArtifacts('wc/src/app.ts', [
      'app.ts',
      'app.ts.mine',
      'app.ts.r10',
      'app.ts.r14',
      'other.txt',
    ]);
    expect(result.kind).toBe('text');
    expect(result.hasMineArtifact).toBe(true);
    expect(result.revisionRevisions).toEqual([10, 14]);
    expect(result.propertyRevisions).toEqual([]);
  });

  it('recognizes property conflict .prej artifacts', () => {
    const result = classifyConflictFromArtifacts('wc/src/app.ts', [
      'app.ts',
      'app.ts.mine.prej',
      'app.ts.merge-prej.r14.prej',
    ]);
    expect(result.kind).toBe('property');
    expect(result.propertyRevisions).toEqual([14]);
  });

  it('falls back to tree when no artifacts exist', () => {
    const result = classifyConflictFromArtifacts('wc/src/renamed.ts', ['renamed.ts']);
    expect(result.kind).toBe('tree');
    expect(result.hasMineArtifact).toBe(false);
  });

  it('ignores sibling files that merely share the prefix', () => {
    const result = classifyConflictFromArtifacts('wc/src/app.ts', ['app.ts.bak', 'app.ts.orig']);
    expect(result.kind).toBe('tree');
  });
});

describe('looksBinaryContent', () => {
  it('flags embedded NUL bytes', () => {
    expect(looksBinaryContent('text\u0000more')).toBe(true);
  });

  it('accepts plain text with tabs and newlines', () => {
    expect(looksBinaryContent('line one\n\ttabbed\r\nline two')).toBe(false);
    expect(looksBinaryContent('')).toBe(false);
  });
});

describe('item transitions', () => {
  const items = createConflictItems(['a.ts', 'b.ts', 'c.ts']);

  it('marks in-flight then resolved', () => {
    const inFlight = markItemInFlight(items, 'b.ts', 'theirs-full');
    expect(inFlight[1]).toMatchObject({ status: 'in-progress', resolution: 'theirs-full' });
    const resolved = markItemResolved(inFlight, 'b.ts');
    expect(resolved[1]).toMatchObject({ status: 'resolved' });
    expect(conflictStats(resolved)).toMatchObject({ total: 3, resolved: 1, pending: 2 });
  });

  it('records failures back to pending with the error', () => {
    const failed = markItemFailed(markItemInFlight(items, 'a.ts', 'base'), 'a.ts', 'boom');
    expect(failed[0]).toMatchObject({ status: 'pending', error: 'boom' });
  });

  it('defers and reopens cleanly', () => {
    const skipped = markItemSkipped(items, 'a.ts');
    expect(skipped[0].status).toBe('skipped');
    const reopened = reopenItem(skipped, 'a.ts');
    expect(reopened[0]).toMatchObject({ status: 'pending', resolution: undefined, error: undefined });
  });

  it('reclassifies kinds without touching other items', () => {
    const reclassified = withConflictKind(items, 'c.ts', 'binary');
    expect(reclassified[2].kind).toBe('binary');
    expect(reclassified[0].kind).toBe('text');
  });
});

describe('nextUnresolvedIndex', () => {
  it('walks forward past resolved items', () => {
    let current = createConflictItems(['a', 'b', 'c']);
    current = markItemResolved(current, 'a');
    expect(nextUnresolvedIndex(current, 0)).toBe(1);
  });

  it('wraps around to earlier unresolved items', () => {
    let current = createConflictItems([{ path: 'a', kind: 'text' }, { path: 'b', kind: 'text' }, { path: 'c', kind: 'text' }]);
    current = markItemResolved(current, 'b');
    expect(nextUnresolvedIndex(current, 2)).toBe(0);
  });

  it('returns null when everything is resolved', () => {
    const localItems = createConflictItems(['a', 'b', 'c']);
    expect(nextUnresolvedIndex(markItemResolved(localItems, 'a'), 0)).toBe(1);
    const all = ['a', 'b', 'c'].reduce((acc, path) => markItemResolved(acc, path), localItems);
    expect(nextUnresolvedIndex(all, 1)).toBeNull();
    expect(allResolved(all)).toBe(true);
  });
});

describe('planBatchResolve', () => {
  it('applies the default mode to every unresolved conflict', () => {
    let items = createConflictItems([
      { path: 'a.ts', kind: 'text' },
      { path: 'b.ts', kind: 'text' },
    ]);
    items = markItemResolved(items, 'b.ts');
    const plan = planBatchResolve(items, 'mine-full');
    expect(plan.steps).toEqual([{ path: 'a.ts', kind: 'text', mode: 'mine-full' }]);
    expect(plan.postponedPaths).toEqual([]);
  });

  it('honors per-conflict mode overrides', () => {
    const items = createConflictItems([
      { path: 'a.ts', kind: 'text' },
      { path: 'b.ts', kind: 'text' },
      { path: 'c.ts', kind: 'text' },
    ]);
    const plan = planBatchResolve(items, 'mine-full', {
      'b.ts': 'theirs-full',
      'c.ts': 'postpone',
    });
    expect(plan.steps.map((step) => [step.path, step.mode])).toEqual([
      ['a.ts', 'mine-full'],
      ['b.ts', 'theirs-full'],
    ]);
    expect(plan.postponedPaths).toEqual(['c.ts']);
  });

  it('downgrades inapplicable overrides to working instead of failing the run', () => {
    const items = createConflictItems([{ path: 'moved', kind: 'tree' }]);
    const plan = planBatchResolve(items, 'mine-full', { moved: 'base' });
    expect(plan.steps[0].mode).toBe('working');
  });
});

describe('summarizeBatchPlan', () => {
  it('produces one plain-language line per conflict', () => {
    const plan = planBatchResolve(
      createConflictItems([
        { path: 'a.ts', kind: 'text' },
        { path: 'b.ts', kind: 'text' },
      ]),
      'mine-full',
      { 'b.ts': 'working' }
    );
    const lines = summarizeBatchPlan(plan);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ path: 'a.ts', mode: 'mine-full', destructive: true });
    expect(lines[0].label).toContain('my version');
    expect(lines[0].outcome).toContain('yours');
    expect(lines[1]).toMatchObject({ path: 'b.ts', mode: 'working', destructive: false });
  });

  it('flags destructive batches', () => {
    const safe = planBatchResolve(createConflictItems(['a.ts']), 'working');
    expect(batchPlanHasDestructiveSteps(safe)).toBe(false);
    const destructive = planBatchResolve(createConflictItems(['a.ts']), 'theirs-full');
    expect(batchPlanHasDestructiveSteps(destructive)).toBe(true);
  });
});
