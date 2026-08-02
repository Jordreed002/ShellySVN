import { describe, expect, it } from 'vitest';

import type {
  RailProblems,
  RepoStatusCounts,
  WorkingCopyInfo,
  WorkingCopySummary,
} from '@renderer/components/sidebar/sidebarData';

import {
  buildHomeWorkingCopies,
  describeOperations,
  isCheckedOut,
  summarizeBriefing,
  type HomeWorkingCopy,
} from '../homeBriefing';

/**
 * J1 / J4 — Home briefing + commit-readiness, as pure functions.
 *
 * Home is the first screen of the session and the easiest place to print a
 * number nobody measured. These helpers must keep three states apart — measured,
 * not-measured-yet, and not-a-checkout — and must block commit only when
 * Subversion itself would (conflicts), not when a read is merely slow.
 */

function counts(
  changes: number,
  conflicts = 0,
  source: RepoStatusCounts['source'] = 'network'
): RepoStatusCounts {
  return {
    changes,
    conflicts,
    problems: { total: conflicts, blocking: conflicts, summary: '' },
    source,
    cacheAge: 0,
  };
}

function info(overrides: Partial<WorkingCopyInfo> = {}): WorkingCopyInfo {
  return {
    url: 'https://svn.example.com/repo/trunk',
    repositoryRoot: 'https://svn.example.com/repo',
    revision: 42,
    branch: 'trunk',
    branchKind: 'trunk',
    source: 'network',
    cacheAge: 0,
    ...overrides,
  };
}

function row(overrides: Partial<HomeWorkingCopy> = {}): HomeWorkingCopy {
  return {
    path: '/wc/myrepo',
    name: 'myrepo',
    presence: 'full',
    ...overrides,
  };
}

const NO_PROBLEMS: RailProblems = { total: 0, unmeasured: 0 };

describe('buildHomeWorkingCopies', () => {
  it('derives display names from the last path segment', () => {
    const rows = buildHomeWorkingCopies(['/dev/myrepo', '/dev/another'], new Map());
    expect(rows.map((r) => r.name)).toEqual(['myrepo', 'another']);
  });

  it('pulls presence, status, and info from the overview map', () => {
    const overview = new Map<string, WorkingCopySummary>([
      ['/wc/repo', { presence: 'full', status: counts(3), info: info({ revision: 7 }) }],
    ]);
    const [r] = buildHomeWorkingCopies(['/wc/repo'], overview);
    expect(r.presence).toBe('full');
    expect(r.status?.changes).toBe(3);
    expect(r.info?.revision).toBe(7);
  });

  it('defaults to unknown presence with no status/info when the overview has no entry', () => {
    const [r] = buildHomeWorkingCopies(['/wc/repo'], new Map());
    expect(r.presence).toBe('unknown');
    expect(r.status).toBeUndefined();
    expect(r.info).toBeUndefined();
  });
});

describe('isCheckedOut', () => {
  it.each([
    ['full', true],
    ['sparse', true],
    ['none', false],
    ['unknown', false],
  ] as const)('treats presence %s as checkedOut=%s', (presence, expected) => {
    expect(isCheckedOut(row({ presence }))).toBe(expected);
  });
});

describe('summarizeBriefing', () => {
  it('reports zero working copies with nothing else', () => {
    expect(summarizeBriefing([], NO_PROBLEMS)).toBe('0 working copies');
  });

  it('singularizes one working copy', () => {
    expect(summarizeBriefing([row()], NO_PROBLEMS)).toBe('1 working copy');
  });

  it('sums local changes only across measured rows', () => {
    const rows = [
      row({ path: '/a', status: counts(5) }),
      row({ path: '/b', status: counts(3) }),
      row({ path: '/c' }), // not measured yet — must NOT be folded in as zero
    ];
    const out = summarizeBriefing(rows, NO_PROBLEMS);
    expect(out).toContain('3 working copies');
    expect(out).toContain('8 local changes');
    // The unmeasured row is not silently treated as "0 changes".
  });

  it('adds problem and conflict segments only when present', () => {
    const rows = [row({ status: counts(4, 2) })];
    const out = summarizeBriefing(rows, { total: 5, unmeasured: 0 });
    expect(out).toContain('5 problems');
    expect(out).toContain('2 conflicted (C)');
  });

  it('counts not-checked-out and not-measured rows separately', () => {
    const rows = [
      row({ path: '/a', presence: 'none' }),
      row({ path: '/b', presence: 'full' /* no status → not measured */ }),
    ];
    const out = summarizeBriefing(rows, { total: 0, unmeasured: 1 });
    expect(out).toContain('1 not checked out');
    expect(out).toContain('1 not measured');
  });
});

describe('describeOperations', () => {
  it('disables every operation when no working copy is open', () => {
    const ops = describeOperations(undefined);
    expect(ops).toHaveLength(4);
    expect(ops.every((op) => op.enabled === false)).toBe(true);
    expect(ops.every((op) => op.note === 'No working copy open')).toBe(true);
    expect(ops.map((op) => op.kind)).toEqual(['update', 'commit', 'revert', 'diff']);
  });

  it('blocks commit when there are conflicts (Subversion would abort)', () => {
    const ops = describeOperations(row({ status: counts(3, 1) }));
    const commit = ops.find((op) => op.kind === 'commit')!;
    expect(commit.enabled).toBe(false);
    expect(commit.note).toContain('1 conflicted (C) blocks commit');
    // Update and diff stay available.
    expect(ops.find((op) => op.kind === 'update')!.enabled).toBe(true);
    expect(ops.find((op) => op.kind === 'diff')!.enabled).toBe(true);
  });

  it('disables commit and revert when there is nothing modified', () => {
    const ops = describeOperations(row({ status: counts(0) }));
    expect(ops.find((op) => op.kind === 'commit')!.enabled).toBe(false);
    expect(ops.find((op) => op.kind === 'revert')!.enabled).toBe(false);
    expect(ops.find((op) => op.kind === 'commit')!.note).toContain('Nothing modified');
  });

  it('enables commit and revert when there are clean changes', () => {
    const ops = describeOperations(row({ status: counts(5) }));
    expect(ops.find((op) => op.kind === 'commit')!.enabled).toBe(true);
    expect(ops.find((op) => op.kind === 'revert')!.enabled).toBe(true);
  });

  it('keeps commit and revert available while changes are still unmeasured', () => {
    // A slow read must not masquerade as "nothing to commit".
    const ops = describeOperations(row({ presence: 'full' /* no status */ }));
    expect(ops.find((op) => op.kind === 'commit')!.enabled).toBe(true);
    expect(ops.find((op) => op.kind === 'revert')!.enabled).toBe(true);
    expect(ops.find((op) => op.kind === 'commit')!.note).toContain('not measured yet');
  });

  it('includes the BASE revision in the diff note when info is present', () => {
    const ops = describeOperations(row({ status: counts(2), info: info({ revision: 99 }) }));
    expect(ops.find((op) => op.kind === 'diff')!.note).toContain('BASE r99');
  });
});
