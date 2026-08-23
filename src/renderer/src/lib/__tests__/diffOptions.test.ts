import { describe, expect, it } from 'vitest';
import type { SvnDiffResult } from '@shared/types';
import {
  applyDiffOptions,
  DEFAULT_DIFF_DISPLAY_OPTIONS,
  isDefaultDiffOptions,
  normalizeDiffContent,
} from '../diffOptions';

function line(
  type: 'added' | 'removed' | 'context',
  content: string,
  oldLineNumber?: number,
  newLineNumber?: number
) {
  return { type, content, oldLineNumber, newLineNumber };
}

function makeDiff(hunks: SvnDiffResult['files'][number]['hunks']): SvnDiffResult {
  return {
    files: [{ oldPath: 'a.txt', newPath: 'a.txt', hunks }],
    hasChanges: hunks.some((hunk) => hunk.lines.some((l) => l.type === 'added' || l.type === 'removed')),
  };
}

describe('normalizeDiffContent', () => {
  it('is a no-op with default options', () => {
    expect(normalizeDiffContent('  a\r\n', DEFAULT_DIFF_DISPLAY_OPTIONS)).toBe('  a\r\n');
  });

  it('strips a trailing carriage return when EOLs are ignored', () => {
    expect(normalizeDiffContent('a\r', { ignoreWhitespace: false, ignoreEol: true })).toBe('a');
  });

  it('removes all whitespace when whitespace is ignored', () => {
    expect(normalizeDiffContent(' a  b\tc ', { ignoreWhitespace: true, ignoreEol: false })).toBe(
      'abc'
    );
  });
});

describe('isDefaultDiffOptions', () => {
  it('is true only when both options are off', () => {
    expect(isDefaultDiffOptions(DEFAULT_DIFF_DISPLAY_OPTIONS)).toBe(true);
    expect(isDefaultDiffOptions({ ignoreWhitespace: true, ignoreEol: false })).toBe(false);
    expect(isDefaultDiffOptions({ ignoreWhitespace: false, ignoreEol: true })).toBe(false);
  });
});

describe('applyDiffOptions', () => {
  it('returns the same object reference for default options', () => {
    const diff = makeDiff([]);
    expect(applyDiffOptions(diff, DEFAULT_DIFF_DISPLAY_OPTIONS)).toBe(diff);
  });

  it('returns null for null input', () => {
    expect(applyDiffOptions(null, { ignoreWhitespace: true, ignoreEol: false })).toBeNull();
  });

  it('merges a whitespace-only changed pair into one context line', () => {
    const diff = makeDiff([
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          line('context', 'keep', 1, 1),
          line('removed', '  indented', 2),
          line('added', '      indented', undefined, 2),
          line('context', 'tail', 3, 3),
        ],
      },
    ]);

    const result = applyDiffOptions(diff, { ignoreWhitespace: true, ignoreEol: false })!;
    expect(result.files[0].hunks).toHaveLength(0);
    expect(result.hasChanges).toBe(false);
  });

  it('keeps real changes and renumbers the hunk header', () => {
    const diff = makeDiff([
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 3,
        lines: [
          line('removed', '  same', 10),
          line('added', '    same', undefined, 10),
          line('removed', 'old text', 11),
          line('added', 'new text', undefined, 11),
        ],
      },
    ]);

    const result = applyDiffOptions(diff, { ignoreWhitespace: true, ignoreEol: false })!;
    const hunk = result.files[0].hunks[0];
    expect(hunk.lines).toHaveLength(3); // 1 merged context + 1 removed + 1 added
    expect(hunk.lines[0]).toEqual({
      type: 'context',
      content: '    same',
      oldLineNumber: 10,
      newLineNumber: 10,
    });
    expect(hunk.oldLines).toBe(2);
    expect(hunk.newLines).toBe(2);
    expect(result.hasChanges).toBe(true);
  });

  it('treats crlf versus lf as equal when EOLs are ignored', () => {
    const diff = makeDiff([
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [line('removed', 'text\r', 1), line('added', 'text', undefined, 1)],
      },
    ]);

    expect(
      applyDiffOptions(diff, { ignoreWhitespace: false, ignoreEol: true })!.hasChanges
    ).toBe(false);
    // Without the option it stays a change.
    expect(
      applyDiffOptions(diff, { ignoreWhitespace: false, ignoreEol: false })!.hasChanges
    ).toBe(true);
  });

  it('merges the positionally-paired line and keeps the unmatched tail changed', () => {
    const diff = makeDiff([
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          line('removed', 'gone', 1),
          line('removed', '  also gone', 2),
          line('added', '  gone', undefined, 1),
        ],
      },
    ]);

    const result = applyDiffOptions(diff, { ignoreWhitespace: true, ignoreEol: false })!;
    const lines = result.files[0].hunks[0].lines;
    // Row 0 pairs 'gone' with '  gone' — whitespace only, merged to context.
    expect(lines.filter((l) => l.type === 'context')).toEqual([
      { type: 'context', content: '  gone', oldLineNumber: 1, newLineNumber: 1 },
    ]);
    // Row 1 has no added counterpart, so '  also gone' stays a real removal.
    expect(lines.filter((l) => l.type === 'removed')).toEqual([
      { type: 'removed', content: '  also gone', oldLineNumber: 2, newLineNumber: undefined },
    ]);
  });

  it('does not touch binary diffs', () => {
    const diff: SvnDiffResult = { files: [], hasChanges: true, isBinary: true };
    expect(applyDiffOptions(diff, { ignoreWhitespace: true, ignoreEol: true })).toBe(diff);
  });
});
