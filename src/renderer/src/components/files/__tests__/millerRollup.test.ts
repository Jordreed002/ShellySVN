/**
 * A clean folder holding changed files is the thing you most need a column to
 * tell you — it is how you find your own edits without opening every directory.
 * The Miller columns showed nothing there while the tree and the repository
 * browser both showed a count, so the same working copy read differently
 * depending on which view you happened to be in.
 */

import { describe, it, expect } from 'vitest';
import type { FileInfo } from '@shared/types';

import { toRollup } from '../MillerColumns';

const entry = (over: Partial<FileInfo> = {}): FileInfo =>
  ({
    name: 'src',
    path: '/wc/acme-website/src',
    isDirectory: true,
    size: 0,
    modifiedTime: '2026-07-26T14:00:00Z',
    ...over,
  }) as FileInfo;

describe('toRollup', () => {
  it('counts the changed descendants of a directory', () => {
    const rollup = toRollup(
      entry({ svnStatus: { path: '/wc/acme-website/src', status: ' ', isDirectory: true, childChangeCount: 6 } })
    );

    expect(rollup).toEqual({ modified: 6, added: 0, deleted: 0, conflicted: 0 });
  });

  it('stays silent for a directory with nothing changed below it', () => {
    // Mark the exception, not the rule.
    expect(
      toRollup(
        entry({ svnStatus: { path: '/wc/acme-website/docs', status: ' ', isDirectory: true, childChangeCount: 0 } })
      )
    ).toBeNull();
    expect(toRollup(entry())).toBeNull();
  });

  it('never rolls up a file — its own status is the better answer', () => {
    expect(
      toRollup(
        entry({
          name: 'package.json',
          isDirectory: false,
          svnStatus: { path: '/wc/acme-website/package.json', status: 'M', isDirectory: false, childChangeCount: 3 },
        })
      )
    ).toBeNull();
  });
});
