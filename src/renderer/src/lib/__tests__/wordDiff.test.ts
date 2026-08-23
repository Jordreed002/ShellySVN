import { describe, expect, it } from 'vitest';
import { computeWordDiff, tokenizeLine, MAX_TOKENS } from '../wordDiff';

describe('tokenizeLine', () => {
  it('splits words, whitespace runs and punctuation into tokens', () => {
    expect(tokenizeLine('if (count > 3) {')).toEqual([
      'if',
      ' ',
      '(',
      'count',
      ' ',
      '>',
      ' ',
      '3',
      ')',
      ' ',
      '{',
    ]);
  });

  it('keeps re-indentation visible as whitespace tokens', () => {
    expect(tokenizeLine('    return x;')).toEqual(['    ', 'return', ' ', 'x', ';']);
  });

  it('returns an empty list for an empty line', () => {
    expect(tokenizeLine('')).toEqual([]);
  });
});

describe('computeWordDiff', () => {
  it('marks only the changed token pair, not the whole line', () => {
    const { oldSegments, newSegments } = computeWordDiff('if (count > 3) {', 'if (count > 5) {');

    expect(oldSegments.filter((s) => s.changed).map((s) => s.text)).toEqual(['3']);
    expect(newSegments.filter((s) => s.changed).map((s) => s.text)).toEqual(['5']);
  });

  it('produces no changed segments for identical input', () => {
    const { oldSegments, newSegments } = computeWordDiff('same line', 'same line');
    expect(oldSegments.every((s) => !s.changed)).toBe(true);
    expect(newSegments.every((s) => !s.changed)).toBe(true);
  });

  it('marks whitespace-only differences as changed whitespace segments', () => {
    const { oldSegments, newSegments } = computeWordDiff('a  b', 'a b');
    expect(oldSegments.some((s) => s.changed && /^\s+$/.test(s.text))).toBe(true);
    expect(newSegments.some((s) => s.changed && /^\s+$/.test(s.text))).toBe(true);
  });

  it('marks everything changed when one side is empty', () => {
    const { oldSegments, newSegments } = computeWordDiff('', 'new line');
    expect(oldSegments).toEqual([]);
    expect(newSegments.length).toBeGreaterThan(0);
    expect(newSegments.every((s) => s.changed)).toBe(true);
  });

  it('merges consecutive same-flag tokens into single segments', () => {
    const { newSegments } = computeWordDiff('abc', 'xabcy');
    // 'abc' is common, 'x'/'y' are changed — at most 3 segments either way.
    expect(newSegments.length).toBeLessThanOrEqual(3);
    expect(newSegments.map((s) => s.text).join('')).toBe('xabcy');
  });

  it('falls back to whole-line highlight for pathological token counts', () => {
    const huge = 'a '.repeat(MAX_TOKENS + 10).trim();
    const other = 'b '.repeat(MAX_TOKENS + 10).trim();
    const { oldSegments } = computeWordDiff(huge, other);
    expect(oldSegments.length).toBe(1);
    expect(oldSegments[0].changed).toBe(true);
  });

  it('recognises a token moved to the other side of the line as changed runs', () => {
    const { oldSegments, newSegments } = computeWordDiff('const a = b;', 'const b = a;');
    expect(oldSegments.some((s) => s.changed)).toBe(true);
    expect(newSegments.some((s) => s.changed)).toBe(true);
  });
});
