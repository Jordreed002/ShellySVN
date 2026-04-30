import { describe, expect, it } from 'vitest';
import type { SvnLogEntry } from '@shared/types';
import { buildProjectStatistics } from '../projectStatistics';

const entries: SvnLogEntry[] = [
  {
    revision: 3,
    author: 'alice',
    date: '2026-04-30T10:00:00.000Z',
    message: 'merge feature',
    paths: [
      { action: 'M', path: '/trunk/src/app.ts' },
      { action: 'A', path: '/branches/feature', copyFromPath: '/trunk', copyFromRev: 1 },
    ],
  },
  {
    revision: 4,
    author: 'bob',
    date: '2026-04-30T11:00:00.000Z',
    message: 'tag release',
    paths: [{ action: 'A', path: '/tags/v1.0', copyFromPath: '/trunk', copyFromRev: 3 }],
  },
  {
    revision: 5,
    author: 'alice',
    date: '2026-05-01T09:00:00.000Z',
    message: 'delete old file',
    paths: [
      { action: 'M', path: '/trunk/src/app.ts' },
      { action: 'D', path: '/trunk/src/old.ts' },
    ],
  },
];

describe('buildProjectStatistics', () => {
  it('summarizes commits, authors, churn, branches, and tags from log entries', () => {
    const stats = buildProjectStatistics(entries);

    expect(stats.commitsOverTime).toEqual([
      { date: '2026-04-30', commits: 2 },
      { date: '2026-05-01', commits: 1 },
    ]);
    expect(stats.authors).toEqual([
      { author: 'alice', commits: 2 },
      { author: 'bob', commits: 1 },
    ]);
    expect(stats.fileChurn[0]).toEqual({
      path: '/trunk/src/app.ts',
      changes: 2,
      additions: 0,
      deletions: 0,
    });
    expect(stats.fileChurn).toContainEqual({
      path: '/trunk/src/old.ts',
      changes: 1,
      additions: 0,
      deletions: 1,
    });
    expect(stats.branchTagActivity).toEqual([
      { path: '/branches/feature', type: 'branch', revisions: [3] },
      { path: '/tags/v1.0', type: 'tag', revisions: [4] },
    ]);
  });
});
