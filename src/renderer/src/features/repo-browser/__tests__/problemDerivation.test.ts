import { describe, expect, it } from 'vitest';

import type { SvnExternalsResult, SvnStatusEntry, SvnStatusResult } from '@shared/types';

import { deriveProblems } from '../problemDerivation';

const DAY = 1000 * 60 * 60 * 24;

function statusEntry(overrides: Partial<SvnStatusEntry>): SvnStatusEntry {
  return {
    path: 'file.txt',
    status: ' ',
    isDirectory: false,
    ...overrides,
  };
}

/**
 * J3 / J5 / J6 — Repository browser & sidebar problem derivation.
 * `deriveProblems` is the single pure function both the repo browser and the
 * sidebar call to decide what warnings to surface (conflicts, stale locks,
 * floating externals, out-of-date, needs-cleanup). The severity it assigns
 * drives whether the UI blocks actions, so each branch needs coverage.
 */
describe('deriveProblems', () => {
  it('returns no problems for a clean working copy', () => {
    const problems = deriveProblems({
      status: { path: '/wc', entries: [], revision: 1 } as SvnStatusResult,
      externals: { externals: [] } as SvnExternalsResult,
      localPath: '/wc',
    });

    expect(problems).toEqual([]);
  });

  it('flags a text conflict ("C") as blocking with a resolve command', () => {
    const problems = deriveProblems({
      status: {
        path: '/wc',
        revision: 1,
        entries: [statusEntry({ path: 'src/conflict.ts', status: 'C' })],
      } as SvnStatusResult,
      externals: { externals: [] } as SvnExternalsResult,
      localPath: '/wc',
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: 'text-conflict',
      severity: 'blocking',
      path: 'src/conflict.ts',
    });
    expect(problems[0].command).toContain('src/conflict.ts');
    expect(problems[0].command).toContain('svn resolve');
  });

  it('flags a plain missing item as missing rather than a tree conflict', () => {
    const problems = deriveProblems({
      status: {
        path: '/wc',
        revision: 1,
        entries: [statusEntry({ path: 'gone.txt', status: '!' })],
      } as SvnStatusResult,
      externals: { externals: [] } as SvnExternalsResult,
      localPath: '/wc',
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('missing');
    expect(problems[0].severity).toBe('blocking');
    expect(problems[0].command).toContain('svn revert');
  });

  it('reserves tree-conflict classification for SVN tree-conflict metadata', () => {
    const problems = deriveProblems({
      status: {
        path: '/wc',
        revision: 1,
        entries: [
          statusEntry({
            path: 'src',
            status: 'C',
            treeConflict: { operation: 'update', action: 'delete', reason: 'edited' },
          }),
        ],
      } as SvnStatusResult,
      externals: { externals: [] } as SvnExternalsResult,
      localPath: '/wc',
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('tree-conflict');
  });

  it('does not flag a missing path that remote status confirms was deleted upstream', () => {
    const problems = deriveProblems({
      status: {
        path: '/wc',
        revision: 1,
        remoteChecked: true,
        entries: [statusEntry({ path: 'old', status: '!', remoteStatus: 'D' })],
      },
      externals: undefined,
      localPath: '/wc',
    });

    expect(problems).toEqual([]);
  });

  it('counts a missing folder once instead of counting all missing descendants', () => {
    const problems = deriveProblems({
      status: {
        path: '/wc',
        revision: 1,
        entries: [
          statusEntry({ path: 'old', status: '!' }),
          statusEntry({ path: 'old/file.txt', status: '!' }),
          statusEntry({ path: 'old/nested/file.txt', status: '!' }),
        ],
      },
      externals: undefined,
      localPath: '/wc',
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe('old');
  });

  it('does not list missing descendants already explained by a parent tree conflict', () => {
    const problems = deriveProblems({
      status: {
        path: '/wc',
        revision: 1,
        entries: [
          statusEntry({ path: '/wc/old', status: 'C', treeConflict: {} }),
          statusEntry({ path: '/wc/old/file.txt', status: '!' }),
        ],
      },
      externals: undefined,
      localPath: '/wc',
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('tree-conflict');
  });

  describe('stale locks', () => {
    it('flags a lock older than the threshold as a warning', () => {
      const problems = deriveProblems({
        status: {
          path: '/wc',
          revision: 1,
          entries: [
            statusEntry({
              path: 'locked.txt',
              status: ' ',
              lock: {
                owner: 'alice',
                comment: 'working on it',
                date: new Date(Date.now() - 30 * DAY).toISOString(),
              },
            }),
          ],
        } as SvnStatusResult,
        externals: { externals: [] } as SvnExternalsResult,
        localPath: '/wc',
      });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: 'stale-lock', severity: 'warning' });
      expect(problems[0].title).toContain('locked.txt');
      expect(problems[0].explanation).toContain('alice');
    });

    it('does not flag a recent lock', () => {
      const problems = deriveProblems({
        status: {
          path: '/wc',
          revision: 1,
          entries: [
            statusEntry({
              path: 'locked.txt',
              status: ' ',
              lock: {
                owner: 'alice',
                comment: '',
                date: new Date(Date.now() - 2 * DAY).toISOString(),
              },
            }),
          ],
        } as SvnStatusResult,
        externals: { externals: [] } as SvnExternalsResult,
        localPath: '/wc',
      });

      expect(problems.find((p) => p.kind === 'stale-lock')).toBeUndefined();
    });

    it('treats an unparseable lock date as age zero (no stale warning)', () => {
      const problems = deriveProblems({
        status: {
          path: '/wc',
          revision: 1,
          entries: [
            statusEntry({
              path: 'locked.txt',
              status: ' ',
              lock: { owner: 'alice', comment: '', date: 'not-a-date' },
            }),
          ],
        } as SvnStatusResult,
        externals: { externals: [] } as SvnExternalsResult,
        localPath: '/wc',
      });

      expect(problems.find((p) => p.kind === 'stale-lock')).toBeUndefined();
    });

    it('respects a custom staleLockDays threshold', () => {
      // 5 days old — stale only if threshold is lower.
      const baseStatus: SvnStatusResult = {
        path: '/wc',
        revision: 1,
        entries: [
          statusEntry({
            path: 'locked.txt',
            status: ' ',
            lock: {
              owner: 'alice',
              comment: '',
              date: new Date(Date.now() - 5 * DAY).toISOString(),
            },
          }),
        ],
      } as SvnStatusResult;

      expect(
        deriveProblems({
          status: baseStatus,
          externals: { externals: [] } as SvnExternalsResult,
          localPath: '/wc',
          staleLockDays: 14,
        }).find((p) => p.kind === 'stale-lock')
      ).toBeUndefined();

      expect(
        deriveProblems({
          status: baseStatus,
          externals: { externals: [] } as SvnExternalsResult,
          localPath: '/wc',
          staleLockDays: 1,
        }).find((p) => p.kind === 'stale-lock')
      ).toBeDefined();
    });
  });

  it('surfaces needsCleanup as a blocking problem scoped to the working copy', () => {
    const problems = deriveProblems({
      status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
      externals: { externals: [] } as SvnExternalsResult,
      localPath: '/wc',
      needsCleanup: true,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'needs-cleanup', severity: 'blocking', path: '/wc' });
    expect(problems[0].command).toContain('svn cleanup');
  });

  describe('externals', () => {
    it('flags an external without a peg or operative revision as advisory', () => {
      const problems = deriveProblems({
        status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
        externals: {
          externals: [{ name: 'dep', url: 'https://repo/dep', path: 'vendor/dep' }],
        } as SvnExternalsResult,
        localPath: '/wc',
      });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: 'floating-external', severity: 'advisory' });
    });

    it('does not flag an external pinned by a peg revision', () => {
      const problems = deriveProblems({
        status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
        externals: {
          externals: [
            { name: 'dep', url: 'https://repo/dep', path: 'vendor/dep', pegRevision: 42 },
          ],
        } as SvnExternalsResult,
        localPath: '/wc',
      });

      expect(problems.find((p) => p.kind === 'floating-external')).toBeUndefined();
    });

    it('does not flag an external pinned by an operative revision', () => {
      const problems = deriveProblems({
        status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
        externals: {
          externals: [{ name: 'dep', url: 'https://repo/dep', path: 'vendor/dep', revision: 7 }],
        } as SvnExternalsResult,
        localPath: '/wc',
      });

      expect(problems.find((p) => p.kind === 'floating-external')).toBeUndefined();
    });
  });

  describe('incoming revisions', () => {
    it('reports an out-of-date advisory and pluralizes the title', () => {
      const problems = deriveProblems({
        status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
        externals: { externals: [] } as SvnExternalsResult,
        localPath: '/wc',
        incomingRevisions: 3,
      });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: 'out-of-date', severity: 'advisory' });
      expect(problems[0].title).toContain('3 revisions behind');
    });

    it('uses the singular form for a single incoming revision', () => {
      const problems = deriveProblems({
        status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
        externals: { externals: [] } as SvnExternalsResult,
        localPath: '/wc',
        incomingRevisions: 1,
      });

      expect(problems[0].title).toContain('1 revision behind');
    });

    it('appends a "+" when the count is capped', () => {
      const problems = deriveProblems({
        status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
        externals: { externals: [] } as SvnExternalsResult,
        localPath: '/wc',
        incomingRevisions: 50,
        incomingCapped: true,
      });

      expect(problems[0].title).toContain('50+');
    });

    it('omits the out-of-date problem when there are zero incoming revisions', () => {
      const problems = deriveProblems({
        status: { path: '/wc', revision: 1, entries: [] } as SvnStatusResult,
        externals: { externals: [] } as SvnExternalsResult,
        localPath: '/wc',
        incomingRevisions: 0,
      });

      expect(problems.find((p) => p.kind === 'out-of-date')).toBeUndefined();
    });
  });

  it('combines multiple independent problems in one pass', () => {
    const problems = deriveProblems({
      status: {
        path: '/wc',
        revision: 1,
        entries: [
          statusEntry({ path: 'a.ts', status: 'C' }),
          statusEntry({ path: 'b.ts', status: '!' }),
        ],
      } as SvnStatusResult,
      externals: {
        externals: [{ name: 'dep', url: 'u', path: 'vendor/dep' }],
      } as SvnExternalsResult,
      localPath: '/wc',
      needsCleanup: true,
      incomingRevisions: 2,
    });

    const kinds = problems.map((p) => p.kind).toSorted();
    expect(kinds).toEqual(
      ['floating-external', 'missing', 'needs-cleanup', 'out-of-date', 'text-conflict'].toSorted()
    );
  });
});
