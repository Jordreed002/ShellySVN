import { describe, expect, it } from 'vitest';

import { collapseNestedFiles } from '../svn-portable-shelves';

/**
 * J4 / J14 — Portable shelves.
 *
 * When a shelf captures a directory, every file nested under it is redundant —
 * restoring the directory already restores its contents. `collapseNestedFiles`
 * drops those nested entries so a shelf stores the minimal set. A regression
 * here either bloats shelves with redundant entries or, worse, drops a file by
 * misclassifying a sibling as nested.
 */
const SEP = '/';

function file(relativePath: string) {
  return { relativePath, status: 'M', kind: 'file' as const };
}
function dir(relativePath: string) {
  return { relativePath, status: 'M', kind: 'directory' as const };
}
function paths(entries: ReturnType<typeof file>[]) {
  return entries.map((e) => e.relativePath);
}

describe('collapseNestedFiles', () => {
  it('returns an empty list unchanged', () => {
    expect(collapseNestedFiles([])).toEqual([]);
  });

  it('keeps every entry when nothing is nested under a listed directory', () => {
    const entries = [file(`src${SEP}a.ts`), file(`src${SEP}b.ts`), file(`readme.md`)];
    expect(paths(collapseNestedFiles(entries))).toEqual([
      `src${SEP}a.ts`,
      `src${SEP}b.ts`,
      'readme.md',
    ]);
  });

  it('drops files that live under a listed directory', () => {
    const entries = [dir('src'), file(`src${SEP}a.ts`), file(`src${SEP}nested${SEP}b.ts`), file('readme.md')];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src', 'readme.md']);
  });

  it('collapses directories nested under other listed directories', () => {
    const entries = [dir('src'), dir(`src${SEP}nested`), file(`src${SEP}nested${SEP}deep.ts`)];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src']);
  });

  it('does not collapse siblings that merely share a name prefix', () => {
    // 'src' is not a listed directory here, so src-foo must survive even though
    // its path starts with "src".
    const entries = [file('src-foo.ts'), file(`src${SEP}bar.ts`)];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src-foo.ts', `src${SEP}bar.ts`]);
  });

  it('is order-independent', () => {
    const a = [dir('src'), file(`src${SEP}a.ts`)];
    const b = [file(`src${SEP}a.ts`), dir('src')];
    expect(paths(collapseNestedFiles(a))).toEqual(['src']);
    expect(paths(collapseNestedFiles(b))).toEqual(['src']);
  });

  /*
   * Portable shelves are cross-platform artifacts: one created on macOS (/)
   * may be inspected or restored on Windows (\). Containment must therefore be
   * decided on a canonical separator, not the host's path.sep — otherwise the
   * nested files survive on the "wrong" platform and shelves store redundancy.
   */
  it('collapses across mismatched separators (portable shelf made on another OS)', () => {
    // Directory recorded with the host separator, nested file with the other.
    const backslashDir = [dir('src'), file('src\\nested\\a.ts')];
    const forwardSlashDir = [dir('src'), file('src/nested/a.ts')];

    expect(paths(collapseNestedFiles(backslashDir))).toEqual(['src']);
    expect(paths(collapseNestedFiles(forwardSlashDir))).toEqual(['src']);
  });

  it('does not collapse a sibling whose name merely prefixes the directory', () => {
    // 'src' the directory must not swallow 'src-other/a.ts'.
    const entries = [dir('src'), file('src-other/a.ts')];
    expect(paths(collapseNestedFiles(entries))).toEqual(['src', 'src-other/a.ts']);
  });
});
