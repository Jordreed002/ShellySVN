import { describe, expect, it } from 'vitest';
import type { SvnDiffLine } from '@shared/types';
import { buildSideBySideRows, pairUnifiedLines } from '../diffRows';

function line(
  type: SvnDiffLine['type'],
  content: string,
  oldLineNumber?: number,
  newLineNumber?: number
): SvnDiffLine {
  return { type, content, oldLineNumber, newLineNumber };
}

describe('buildSideBySideRows', () => {
  it('spans context lines across both sides', () => {
    const rows = buildSideBySideRows([line('context', 'same', 1, 1)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].left?.content).toBe('same');
    expect(rows[0].right?.content).toBe('same');
    expect(rows[0].paired).toBe(false);
  });

  it('zips removed/added runs into aligned pairs', () => {
    const rows = buildSideBySideRows([
      line('removed', 'a', 1),
      line('removed', 'b', 2),
      line('added', 'x', undefined, 1),
      line('added', 'y', undefined, 2),
    ]);
    expect(rows.map((row) => [row.left?.content, row.right?.content])).toEqual([
      ['a', 'x'],
      ['b', 'y'],
    ]);
    expect(rows.every((row) => row.paired)).toBe(true);
  });

  it('gap-fills the shorter side so lines stay aligned', () => {
    const rows = buildSideBySideRows([
      line('removed', 'a', 1),
      line('removed', 'b', 2),
      line('added', 'x', undefined, 1),
    ]);
    expect(rows[1].left?.content).toBe('b');
    expect(rows[1].right).toBeNull();
    expect(rows[1].paired).toBe(false);
  });

  it('carries a lone added run with an empty left cell', () => {
    const rows = buildSideBySideRows([line('added', 'only new', undefined, 5)]);
    expect(rows[0].left).toBeNull();
    expect(rows[0].right?.newLineNumber).toBe(5);
  });

  it('skips hunk and header markers', () => {
    const rows = buildSideBySideRows([
      line('hunk', '@@ -1,2 +1,2 @@'),
      line('context', 'body', 1, 1),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].left?.content).toBe('body');
  });
});

describe('pairUnifiedLines', () => {
  it('keeps the unified order and attaches counterpart text to paired changes', () => {
    const paired = pairUnifiedLines([
      line('context', 'keep', 1, 1),
      line('removed', 'old text', 2),
      line('added', 'new text', undefined, 2),
      line('context', 'tail', 3, 3),
    ]);

    expect(paired.map((entry) => entry.line.type)).toEqual([
      'context',
      'removed',
      'added',
      'context',
    ]);
    expect(paired[1].wordPair).toEqual({
      oldText: 'old text',
      newText: 'new text',
      side: 'old',
    });
    expect(paired[2].wordPair).toEqual({
      oldText: 'old text',
      newText: 'new text',
      side: 'new',
    });
    expect(paired[0].wordPair).toBeUndefined();
  });

  it('keeps the original line order and leaves unmatched tails unpaired', () => {
    const paired = pairUnifiedLines([
      line('removed', 'a', 1),
      line('removed', 'b', 2),
      line('added', 'x', undefined, 1),
    ]);
    // Order is exactly the input order — a removed run stays contiguous.
    expect(paired.map((entry) => entry.line.content)).toEqual(['a', 'b', 'x']);
    // removed[0] ↔ added[0] pair up; removed[1] has no counterpart.
    expect(paired[0].wordPair).toEqual({ oldText: 'a', newText: 'x', side: 'old' });
    expect(paired[2].wordPair).toEqual({ oldText: 'a', newText: 'x', side: 'new' });
    expect(paired[1].wordPair).toBeUndefined();
  });

  it('round-trips every line exactly once', () => {
    const lines = [
      line('context', 'c1', 1, 1),
      line('removed', 'r1', 2),
      line('added', 'a1', undefined, 2),
      line('added', 'a2', undefined, 3),
      line('context', 'c2', 3, 4),
    ];
    const paired = pairUnifiedLines(lines);
    expect(paired.map((entry) => entry.line)).toEqual(lines);
    expect(paired.map((entry) => entry.lineIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});
