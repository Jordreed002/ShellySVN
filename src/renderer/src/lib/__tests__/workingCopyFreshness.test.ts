import { describe, expect, it } from 'vitest';
import type { SvnStatusResult } from '@shared/types';
import {
  buildMixedRevisionItems,
  deriveMixedRevisions,
  describeMixedRevisions,
  normalizeComparablePath,
  resolveIncomingChanges,
} from '../workingCopyFreshness';

describe('normalizeComparablePath', () => {
  it('collapses separators and trailing slashes', () => {
    expect(normalizeComparablePath('C:\\repo\\src\\')).toBe('C:/repo/src');
    expect(normalizeComparablePath('/repo/src/')).toBe('/repo/src');
    expect(normalizeComparablePath('/')).toBe('/');
  });
});

describe('buildMixedRevisionItems', () => {
  it('merges deep status entries and child commits, deep status winning duplicates', () => {
    const items = buildMixedRevisionItems({
      directoryPath: '/wc',
      deepStatusData: {
        directStatus: {},
        allEntries: [
          { status: 'M', fullPath: '/wc/src/a.ts', revision: 9 },
          { status: ' ', fullPath: '/wc/b.txt', revision: 4 },
        ],
      },
      childCommits: {
        'b.txt': { revision: 4, author: 'jordan', date: '' },
        cdir: { revision: 12, author: 'jordan', date: '' },
      },
    });

    const byPath = new Map(items.map((item) => [item.path, item.revision]));
    expect(byPath.get('/wc/src/a.ts')).toBe(9);
    expect(byPath.get('/wc/b.txt')).toBe(4);
    expect(byPath.get('/wc/cdir')).toBe(12);
    // Child commits are joined onto the directory, not left as bare names.
    expect(items.some((item) => item.path === 'cdir')).toBe(false);
  });

  it('survives missing sources', () => {
    expect(buildMixedRevisionItems({})).toEqual([]);
    expect(
      buildMixedRevisionItems({ deepStatusData: null, childCommits: null, directoryPath: null })
    ).toEqual([]);
  });
});

describe('deriveMixedRevisions', () => {
  const items = [
    { path: '/wc/a.txt', revision: 22 },
    { path: '/wc/src/lib.ts', revision: 18 },
    { path: '/wc/old.txt', revision: 3 },
  ];

  it('detects items strictly newer than the folder base revision', () => {
    const summary = deriveMixedRevisions({ baseRevision: 18, items });
    expect(summary).not.toBeNull();
    expect(summary?.baseRevision).toBe(18);
    expect(summary?.maxRevision).toBe(22);
    expect(summary?.itemCount).toBe(1);
    expect(summary?.items).toEqual(['/wc/a.txt']);
  });

  it('reports every item above the anchor, sorted, with a stable signature', () => {
    const summary = deriveMixedRevisions({ baseRevision: 2, items });
    expect(summary?.itemCount).toBe(3);
    expect(summary?.items).toEqual(['/wc/a.txt', '/wc/old.txt', '/wc/src/lib.ts']);
    expect(summary?.signature).toBe('2:22:3');
  });

  it('returns null when there is no anchor to compare against', () => {
    expect(deriveMixedRevisions({ items })).toBeNull();
    expect(deriveMixedRevisions({ baseRevision: 0, items })).toBeNull();
  });

  it('returns null when nothing is provably newer', () => {
    expect(deriveMixedRevisions({ baseRevision: 22, items })).toBeNull();
    expect(deriveMixedRevisions({ baseRevision: 22, items: [] })).toBeNull();
  });

  it('ignores items with no usable revision rather than reading them as revision zero', () => {
    expect(
      deriveMixedRevisions({
        baseRevision: 5,
        items: [
          { path: '/wc/added.txt' },
          { path: '/wc/excluded', revision: 0 },
          { path: '', revision: 40 },
        ],
      })
    ).toBeNull();
  });

  it('collapses duplicate paths reported by two sources', () => {
    const summary = deriveMixedRevisions({
      baseRevision: 5,
      items: [
        { path: '/wc\\a.txt', revision: 8 },
        { path: '/wc/a.txt', revision: 8 },
      ],
    });
    expect(summary?.itemCount).toBe(1);
  });
});

describe('describeMixedRevisions', () => {
  it('formats the range with a count that agrees in number', () => {
    expect(
      describeMixedRevisions({
        baseRevision: 18,
        maxRevision: 22,
        itemCount: 1,
        items: ['/wc/a.txt'],
        signature: '18:22:1',
      })
    ).toBe('r18…r22 · 1 item');
    expect(
      describeMixedRevisions({
        baseRevision: 3,
        maxRevision: 7,
        itemCount: 4,
        items: [],
        signature: '3:7:4',
      })
    ).toBe('r3…r7 · 4 items');
  });
});

describe('resolveIncomingChanges', () => {
  const workingCopyPath = '/wc';

  function makeStatus(entries: Partial<SvnStatusResult['entries'][number]>[]) {
    return {
      path: workingCopyPath,
      revision: 0,
      remoteChecked: true,
      entries: entries.map((entry) => ({
        path: '',
        status: 'M' as const,
        isDirectory: false,
        ...entry,
      })),
    } satisfies SvnStatusResult;
  }

  it('keeps out-of-date entries that cover a selected path', () => {
    const status = makeStatus([
      { path: 'src/a.ts', revision: 5, remoteStatus: 'M', remoteRevision: 9 },
    ]);
    const incoming = resolveIncomingChanges(status, {
      workingCopyPath,
      selectedPaths: ['/wc/src/a.ts'],
    });
    expect(incoming).toEqual([{ path: 'src/a.ts', baseRevision: 5, headRevision: 9 }]);
  });

  it('keeps an out-of-date ancestor directory of a selected file', () => {
    const status = makeStatus([{ path: 'src', revision: 5, remoteStatus: 'M', remoteRevision: 9 }]);
    expect(
      resolveIncomingChanges(status, { workingCopyPath, selectedPaths: ['/wc/src/a.ts'] })
    ).toHaveLength(1);
  });

  it('keeps an out-of-date child of a selected directory', () => {
    const status = makeStatus([{ path: 'src/a.ts', remoteStatus: ' ', remoteRevision: 9 }]);
    expect(
      resolveIncomingChanges(status, { workingCopyPath, selectedPaths: ['/wc/src'] })
    ).toHaveLength(1);
  });

  it('drops incoming changes for unrelated paths', () => {
    const status = makeStatus([
      { path: 'docs/readme.md', remoteStatus: 'M', remoteRevision: 9 },
    ]);
    expect(
      resolveIncomingChanges(status, { workingCopyPath, selectedPaths: ['/wc/src/a.ts'] })
    ).toEqual([]);
  });

  it('drops locally-modified entries that are not out of date', () => {
    const status = makeStatus([{ path: 'src/a.ts', revision: 5, remoteStatus: undefined }]);
    expect(
      resolveIncomingChanges(status, { workingCopyPath, selectedPaths: ['/wc/src/a.ts'] })
    ).toEqual([]);
  });

  it('accepts already-absolute entry paths and relativizes them for display', () => {
    const status = makeStatus([
      { path: '/wc/src/a.ts', revision: 5, remotePropsStatus: 'M', remoteRevision: 9 },
    ]);
    const incoming = resolveIncomingChanges(status, {
      workingCopyPath,
      selectedPaths: ['/wc/src/a.ts'],
    });
    expect(incoming).toEqual([{ path: 'src/a.ts', baseRevision: 5, headRevision: 9 }]);
  });

  it('sorts the list by path', () => {
    const status = makeStatus([
      { path: 'z.txt', remoteStatus: 'M' },
      { path: 'a.txt', remoteStatus: 'M' },
    ]);
    const incoming = resolveIncomingChanges(status, {
      workingCopyPath,
      selectedPaths: ['/wc'],
    });
    expect(incoming.map((change) => change.path)).toEqual(['a.txt', 'z.txt']);
  });

  it('treats the "." target entry as the working copy itself, affecting any commit', () => {
    const status = makeStatus([{ path: '.', revision: 5, remoteStatus: 'M', remoteRevision: 9 }]);
    const incoming = resolveIncomingChanges(status, {
      workingCopyPath,
      selectedPaths: ['/wc/src/deep/file.ts'],
    });
    expect(incoming).toEqual([{ path: '.', baseRevision: 5, headRevision: 9 }]);
  });
});
