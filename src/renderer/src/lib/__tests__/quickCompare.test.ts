import { describe, expect, it } from 'vitest';

import { buildQuickCompareDiff, summarizeQuickCompare } from '../quickCompare';

describe('buildQuickCompareDiff', () => {
  it('reports no changes for identical texts', () => {
    const diff = buildQuickCompareDiff({
      oldLabel: 'Mine',
      newLabel: 'Theirs',
      oldText: 'a\nb\nc',
      newText: 'a\nb\nc',
    });
    expect(diff.hasChanges).toBe(false);
    expect(diff.files).toEqual([]);
  });

  it('emits added and removed lines with line numbers', () => {
    const diff = buildQuickCompareDiff({
      oldLabel: 'Mine',
      newLabel: 'Theirs',
      oldText: ['shared', 'mine-only', 'tail'].join('\n'),
      newText: ['shared', 'theirs-only', 'extra', 'tail'].join('\n'),
    });
    expect(diff.hasChanges).toBe(true);
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0];
    expect(file.oldPath).toBe('Mine');
    expect(file.newPath).toBe('Theirs');

    const lines = file.hunks.flatMap((hunk) => hunk.lines);
    expect(lines.filter((line) => line.type === 'removed')).toEqual([
      { type: 'removed', content: 'mine-only', oldLineNumber: 2 },
    ]);
    expect(
      lines.filter((line) => line.type === 'added').map((line) => line.content)
    ).toEqual(['theirs-only', 'extra']);
    const context = lines.filter((line) => line.type === 'context');
    expect(context.map((line) => line.content)).toEqual(['shared', 'tail']);
  });

  it('trims common prefixes and suffixes into context', () => {
    const oldText = ['p1', 'p2', 'p3', 'mine', 's1', 's2', 's3'].join('\n');
    const newText = ['p1', 'p2', 'p3', 'theirs', 's1', 's2', 's3'].join('\n');
    const diff = buildQuickCompareDiff({
      oldLabel: 'Mine',
      newLabel: 'Theirs',
      oldText,
      newText,
      contextLines: 1,
    });
    const lines = diff.files[0].hunks.flatMap((hunk) => hunk.lines);
    expect(lines.map((line) => `${line.type}:${line.content}`)).toEqual([
      'context:p3',
      'removed:mine',
      'added:theirs',
      'context:s1',
    ]);
  });

  it('handles one side empty and both sides empty', () => {
    const added = buildQuickCompareDiff({
      oldLabel: 'Mine',
      newLabel: 'Theirs',
      oldText: '',
      newText: 'x\ny',
    });
    expect(added.files[0].hunks[0].lines.every((line) => line.type === 'added')).toBe(true);

    const empty = buildQuickCompareDiff({ oldLabel: 'a', newLabel: 'b', oldText: '', newText: '' });
    expect(empty.hasChanges).toBe(false);
    expect(empty.files).toEqual([]);
  });

  it('keeps hunk counters consistent with the emitted lines', () => {
    const diff = buildQuickCompareDiff({
      oldLabel: 'Mine',
      newLabel: 'Theirs',
      oldText: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n'),
      newText: ['1', '2', '3', '4', 'five', '6', '7', '8', '9'].join('\n'),
    });
    for (const hunk of diff.files[0].hunks) {
      const removed = hunk.lines.filter((line) => line.type === 'removed').length;
      const added = hunk.lines.filter((line) => line.type === 'added').length;
      const context = hunk.lines.filter((line) => line.type === 'context').length;
      expect(hunk.oldLines).toBe(removed + context);
      expect(hunk.newLines).toBe(added + context);
    }
  });

  it('splits distant changes into separate hunks', () => {
    const diff = buildQuickCompareDiff({
      oldLabel: 'Mine',
      newLabel: 'Theirs',
      oldText: ['a', '1', '2', '3', '4', '5', '6', '7', '8', 'z'].join('\n'),
      newText: ['A', '1', '2', '3', '4', '5', '6', '7', '8', 'Z'].join('\n'),
      contextLines: 2,
    });
    expect(diff.files[0].hunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('summarizeQuickCompare', () => {
  it('counts added and removed lines', () => {
    expect(
      summarizeQuickCompare(['one', 'two'].join('\n'), ['one', 'two', 'three'].join('\n'))
    ).toBe('1 line added');
    expect(
      summarizeQuickCompare(['one', 'two', 'three'].join('\n'), ['one'].join('\n'))
    ).toBe('2 lines removed');
    expect(summarizeQuickCompare('same\nlines', 'same\nlines')).toBe('No differences');
  });
});
