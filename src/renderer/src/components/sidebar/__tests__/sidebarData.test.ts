/**
 * The rules these tests exist to defend, both about local facts in the rail:
 *
 * 1. A count of zero is not the same as "not measured". A working copy the rail
 *    has read and found clean must not be confused with one it has not read.
 * 2. Shelves and problems belong to a *named* working copy. With several
 *    checkouts on screen, nothing may be attributed to "the first one".
 */

import { describe, expect, it } from 'vitest';
import type { SvnShelveListResult, SvnStatusEntry, SvnStatusResult } from '@shared/types';

import {
  buildRailShelves,
  collectProblems,
  deriveStatusProblems,
  formatShelfAge,
  reconcileOverviewProblems,
  summarizeProblems,
  type WorkingCopySummary,
} from '../sidebarData';

const statusEntry = (over: Partial<SvnStatusEntry> = {}): SvnStatusEntry => ({
  path: 'src/svn.ts',
  status: 'M',
  isDirectory: false,
  ...over,
});

const status = (entries: SvnStatusEntry[]): SvnStatusResult => ({
  path: '/wc',
  entries,
  revision: 4821,
});

const summary = (over: Partial<WorkingCopySummary> = {}): WorkingCopySummary => ({
  presence: 'full',
  status: {
    changes: 0,
    conflicts: 0,
    problems: { total: 0, blocking: 0, summary: '' },
    source: 'network',
    cacheAge: 0,
  },
  ...over,
});

const withProblems = (
  total: number,
  blocking: number,
  problemSummary: string,
  over: Partial<WorkingCopySummary> = {}
): WorkingCopySummary => {
  const base = summary(over);
  return {
    ...base,
    status: base.status && {
      ...base.status,
      problems: { total, blocking, summary: problemSummary },
    },
  };
};

describe('summarizeProblems', () => {
  it('counts blocking problems separately and words each kind with its status letter', () => {
    const result = summarizeProblems([
      {
        kind: 'text-conflict',
        severity: 'blocking',
        path: 'a',
        title: '',
        explanation: '',
        command: '',
      },
      {
        kind: 'text-conflict',
        severity: 'blocking',
        path: 'b',
        title: '',
        explanation: '',
        command: '',
      },
      {
        kind: 'stale-lock',
        severity: 'warning',
        path: 'c',
        title: '',
        explanation: '',
        command: '',
      },
    ]);

    expect(result).toEqual({ total: 3, blocking: 2, summary: '2 conflicted (C) · 1 stale lock' });
  });

  it('leads with what blocks a commit', () => {
    const result = summarizeProblems([
      {
        kind: 'stale-lock',
        severity: 'warning',
        path: 'c',
        title: '',
        explanation: '',
        command: '',
      },
      {
        kind: 'tree-conflict',
        severity: 'blocking',
        path: 'a',
        title: '',
        explanation: '',
        command: '',
      },
    ]);

    expect(result.summary).toBe('1 tree conflict (C) · 1 stale lock');
  });

  it('says nothing at all when there is nothing wrong', () => {
    expect(summarizeProblems([])).toEqual({ total: 0, blocking: 0, summary: '' });
  });
});

describe('reconcileOverviewProblems', () => {
  it('removes an upstream-deleted missing path from the sidebar count', () => {
    const path = 'C:\\wc';
    const local = status([statusEntry({ path: 'C:\\wc\\old', status: '!' })]);
    const overview = new Map([
      [
        path,
        summary({
          status: {
            changes: 1,
            conflicts: 0,
            problems: deriveStatusProblems(local, path),
            source: 'network',
            cacheAge: 0,
            statusResult: local,
          },
        }),
      ],
    ]);
    const remote = status([statusEntry({ path: 'C:\\wc\\old', status: '!', remoteStatus: 'D' })]);

    const reconciled = reconcileOverviewProblems([path], overview, [remote]);

    expect(reconciled.get(path)?.status?.problems).toEqual({
      total: 0,
      blocking: 0,
      summary: '',
    });
  });
});

describe('deriveStatusProblems', () => {
  it('finds the problems a local status read can see', () => {
    const result = deriveStatusProblems(
      status([statusEntry({ status: 'C' }), statusEntry({ path: 'gone.ts', status: '!' })]),
      '/wc'
    );

    expect(result).toEqual({ total: 2, blocking: 2, summary: '1 conflicted (C) · 1 missing (!)' });
  });

  it('does not invent externals or incoming-revision problems it never fetched', () => {
    expect(deriveStatusProblems(status([statusEntry({ status: 'M' })]), '/wc')).toEqual({
      total: 0,
      blocking: 0,
      summary: '',
    });
  });
});

describe('collectProblems', () => {
  it('omits a measured working copy that is clean rather than reporting a zero row', () => {
    const result = collectProblems(['/wc/a'], new Map([['/wc/a', summary()]]));

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.unmeasured).toBe(0);
  });

  it('counts an unresolved working copy as unmeasured, not as clean', () => {
    const result = collectProblems(
      ['/wc/a'],
      new Map([['/wc/a', { presence: 'unknown' } as WorkingCopySummary]])
    );

    expect(result.rows).toEqual([]);
    expect(result.unmeasured).toBe(1);
  });

  it('treats a path that is not a checkout as having no local facts either way', () => {
    const result = collectProblems(
      ['/not-a-wc'],
      new Map([['/not-a-wc', { presence: 'none' } as WorkingCopySummary]])
    );

    expect(result).toEqual({ rows: [], total: 0, unmeasured: 0 });
  });

  it('names every affected working copy, worst first', () => {
    const result = collectProblems(
      ['/wc/website', '/wc/intranet', '/wc/clean'],
      new Map([
        ['/wc/website', withProblems(1, 0, '1 stale lock')],
        ['/wc/intranet', withProblems(3, 2, '2 conflicted (C) · 1 stale lock')],
        ['/wc/clean', summary()],
      ])
    );

    expect(result.rows.map((row) => row.name)).toEqual(['intranet', 'website']);
    expect(result.rows.map((row) => row.path)).toEqual(['/wc/intranet', '/wc/website']);
    expect(result.total).toBe(4);
  });

  it('marks a row whose status came from the offline cache', () => {
    const result = collectProblems(
      ['/wc/website'],
      new Map([
        [
          '/wc/website',
          withProblems(1, 1, '1 conflicted (C)', {
            status: {
              changes: 1,
              conflicts: 1,
              problems: { total: 1, blocking: 1, summary: '1 conflicted (C)' },
              source: 'cache',
              cacheAge: 120_000,
            },
          }),
        ],
      ])
    );

    expect(result.rows[0].fromCache).toBe(true);
    expect(result.rows[0].cacheAge).toBe(120_000);
  });
});

describe('formatShelfAge', () => {
  const now = Date.parse('2026-07-28T12:00:00Z');

  it('words recent shelves the way the prototype does', () => {
    expect(formatShelfAge('2026-07-27T17:40:00Z', now)).toBe('yesterday');
    expect(formatShelfAge('2026-07-21T12:00:00Z', now)).toBe('last week');
    expect(formatShelfAge('2026-07-28T11:59:30Z', now)).toBe('just now');
  });

  it('says nothing when Subversion gave no usable date', () => {
    expect(formatShelfAge('', now)).toBe('');
    expect(formatShelfAge('not a date', now)).toBe('');
  });
});

describe('buildRailShelves', () => {
  const listing = (over: Partial<SvnShelveListResult> = {}): SvnShelveListResult => ({
    shelves: [],
    ...over,
  });
  const now = Date.parse('2026-07-28T12:00:00Z');

  it('lists shelves newest first and keeps each one attached to its working copy', () => {
    const result = buildRailShelves(
      [
        {
          path: '/wc/website',
          result: listing({
            shelves: [
              { name: 'spike-virtual-list', path: '/wc/website', date: '2026-07-20T09:00:00Z' },
            ],
          }),
        },
        {
          path: '/wc/intranet',
          result: listing({
            shelves: [
              {
                name: 'wip-payments-ui',
                path: '/wc/intranet',
                date: '2026-07-27T17:40:00Z',
                message: 'half-done',
              },
            ],
          }),
        },
      ],
      now
    );

    expect(result.shelves.map((shelf) => [shelf.name, shelf.workingCopyName])).toEqual([
      ['wip-payments-ui', 'intranet'],
      ['spike-virtual-list', 'website'],
    ]);
    expect(result.shelves[0].age).toBe('yesterday');
    expect(result.measured).toEqual(['/wc/website', '/wc/intranet']);
  });

  it('carries "this client cannot shelve" as an answer, not as a failure', () => {
    const result = buildRailShelves(
      [
        {
          path: '/wc/website',
          result: listing({ unsupportedReason: 'svn: E200007: unknown command: shelf-list' }),
        },
      ],
      now
    );

    expect(result.shelves).toEqual([]);
    expect(result.measured).toEqual([]);
    expect(result.unsupported).toEqual([
      {
        path: '/wc/website',
        name: 'website',
        reason: 'svn: E200007: unknown command: shelf-list',
      },
    ]);
  });

  it('does not claim a working copy has no shelves when the read failed', () => {
    const result = buildRailShelves(
      [{ path: '/wc/website', result: listing({ error: 'E155007' }) }],
      now
    );

    expect(result).toEqual({ shelves: [], unsupported: [], measured: [] });
  });

  it('says nothing about a working copy that has not answered yet', () => {
    const result = buildRailShelves([{ path: '/wc/website', result: undefined }], now);

    expect(result).toEqual({ shelves: [], unsupported: [], measured: [] });
  });
});
