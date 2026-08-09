import { describe, expect, it } from 'vitest';
import {
  diagnoseCommitStack,
  emptyCommitStack,
  ingestCommitPlan,
  markCommitStackCommitted,
  moveCommitStackPath,
  reorderCommitStack,
  updateCommitStackMessage,
} from '../commitStackStore';

const plan = {
  provider: 'codex' as const,
  model: 'gpt-5.6-luna',
  durationMs: 20,
  truncated: false,
  redacted: false,
  summary: 'Two groups',
  groups: [
    {
      id: 'app',
      title: 'App',
      description: 'App code',
      paths: ['/wc/app.ts'],
      suggestedMessage: 'feat: app',
    },
    {
      id: 'tests',
      title: 'Tests',
      description: 'Tests',
      paths: ['/wc/app.test.ts'],
      suggestedMessage: 'test: app',
    },
  ],
};

describe('commit stack store', () => {
  it('ingests an AI plan as an ordered ready stack', () => {
    const stack = ingestCommitPlan(emptyCommitStack('/wc'), plan, 'checksum');
    expect(stack.groups.map((group) => [group.order, group.status])).toEqual([
      [0, 'ready'],
      [1, 'ready'],
    ]);
    expect(stack.allPaths).toEqual(['/wc/app.ts', '/wc/app.test.ts']);
  });

  it('reorders groups accessibly and preserves draft edits on re-ingest', () => {
    const initial = ingestCommitPlan(emptyCommitStack('/wc'), plan, 'one');
    const edited = updateCommitStackMessage(initial, 'app', 'fix: edited message');
    const reordered = reorderCommitStack(edited, 'tests', -1);
    const refreshed = ingestCommitPlan(reordered, plan, 'two');
    expect(reordered.groups[0].id).toBe('tests');
    expect(refreshed.groups.find((group) => group.id === 'app')?.draftMessage).toBe(
      'fix: edited message'
    );
  });

  it('detects duplicate and unassigned paths and repairs them by moving', () => {
    const initial = ingestCommitPlan(emptyCommitStack('/wc'), plan, 'one');
    const duplicated = {
      ...initial,
      groups: initial.groups.map((group) =>
        group.id === 'tests' ? { ...group, paths: [...group.paths, '/wc/app.ts'] } : group
      ),
    };
    expect(diagnoseCommitStack(duplicated).duplicates.has('/wc/app.ts')).toBe(true);
    const unassigned = moveCommitStackPath(initial, '/wc/app.ts', null);
    expect(diagnoseCommitStack(unassigned).unassigned).toEqual(['/wc/app.ts']);
    const repaired = moveCommitStackPath(unassigned, '/wc/app.ts', 'tests');
    expect(diagnoseCommitStack(repaired).unassigned).toEqual([]);
  });

  it('marks only the completed group and treats its paths as consumed', () => {
    const initial = ingestCommitPlan(emptyCommitStack('/wc'), plan, 'one');
    const committed = markCommitStackCommitted(initial, 'app', 42);
    expect(committed.groups[0]).toMatchObject({ status: 'committed', committedRevision: 42 });
    expect(committed.groups[1].status).toBe('ready');
    expect(diagnoseCommitStack(committed).unassigned).toEqual([]);
  });
});
