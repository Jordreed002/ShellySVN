import { describe, expect, it } from 'vitest';

import type { SvnStatusEntry } from '@shared/types';

import {
  getTextConflictPathsFromStatus,
  getTextConflictPathsFromSvnOutput,
} from '../conflictDetection';

/**
 * J6 — Conflict resolution.
 * These pure helpers turn raw SVN status into the list of paths the conflict
 * resolver needs to act on. They underpin both the File Explorer badges and the
 * resolve dialog, so a regression here silently hides conflicts from the user.
 */
describe('conflictDetection', () => {
  describe('getTextConflictPathsFromStatus', () => {
    it('returns only entries whose status char is "C"', () => {
      const entries: Pick<SvnStatusEntry, 'path' | 'status'>[] = [
        { path: 'src/a.ts', status: 'M' },
        { path: 'src/b.ts', status: 'C' },
        { path: 'src/c.ts', status: 'A' },
        { path: 'src/d.ts', status: 'C' },
      ];

      expect(getTextConflictPathsFromStatus(entries)).toEqual(['src/b.ts', 'src/d.ts']);
    });

    it('returns an empty array when nothing is conflicted', () => {
      const entries: Pick<SvnStatusEntry, 'path' | 'status'>[] = [
        { path: 'src/a.ts', status: 'M' },
        { path: 'src/b.ts', status: ' ' },
      ];

      expect(getTextConflictPathsFromStatus(entries)).toEqual([]);
    });

    it('returns an empty array for an empty list', () => {
      expect(getTextConflictPathsFromStatus([])).toEqual([]);
    });

    it('does not confuse a tree-conflict ("!") or missing item for a text conflict', () => {
      const entries: Pick<SvnStatusEntry, 'path' | 'status'>[] = [
        { path: 'gone.txt', status: '!' },
      ];

      expect(getTextConflictPathsFromStatus(entries)).toEqual([]);
    });
  });

  describe('getTextConflictPathsFromSvnOutput', () => {
    it('extracts paths from lines that begin with a "C" status column', () => {
      const output = [
        'M       src/modified.ts',
        'C       src/conflict.ts',
        'A       src/added.ts',
        'C       src/other-conflict.ts',
      ].join('\n');

      expect(getTextConflictPathsFromSvnOutput(output)).toEqual([
        'src/conflict.ts',
        'src/other-conflict.ts',
      ]);
    });

    it('returns an empty array when no lines are conflicted', () => {
      expect(getTextConflictPathsFromSvnOutput('M       a.ts\nA       b.ts')).toEqual([]);
    });

    it('defaults to an empty string and returns []', () => {
      expect(getTextConflictPathsFromSvnOutput()).toEqual([]);
      expect(getTextConflictPathsFromSvnOutput('')).toEqual([]);
    });

    it('handles CRLF line endings and surrounding whitespace', () => {
      const output = 'C   \t src/spaced.ts\r\nC      src/crlf.ts\r\n';

      expect(getTextConflictPathsFromSvnOutput(output)).toEqual(['src/spaced.ts', 'src/crlf.ts']);
    });

    it('ignores lines where "C" appears later but not in the status column', () => {
      // A status column of "M" with a path containing "C" must not match.
      const output = 'M       src/Cache.ts\nC       src/real-conflict.ts';

      expect(getTextConflictPathsFromSvnOutput(output)).toEqual(['src/real-conflict.ts']);
    });
  });
});
