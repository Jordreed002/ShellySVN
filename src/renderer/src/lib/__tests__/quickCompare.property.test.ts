import { describe, expect, it } from 'vitest';

import { forAll, genArray, genConstant, genMap, genOneOf, genPick, genRecord } from '@test-utils/propertyCheck';

import { buildQuickCompareDiff, summarizeQuickCompare } from '../quickCompare';

/*
 * Property tests for the LCS quick-compare (item #130): with a hunk context
 * large enough to cover every line, the diff must reconstruct both inputs
 * exactly (context+removed = old, context+added = new) with correct,
 * contiguous line numbers; with the default context, every emitted line must
 * agree with the source text at its claimed line number.
 */

const genLine = genOneOf(
  genConstant(''),
  genMap(genArray(genPick(['a', 'b', 'c'] as const), { min: 1, max: 4 }), (chars) => `line ${chars.join('')}`)
);

const genTextPair = genRecord({
  oldLines: genArray(genLine, { min: 0, max: 20 }),
  newLines: genArray(genLine, { min: 0, max: 20 }),
});

describe('buildQuickCompareDiff properties', () => {
  it('full context reconstructs both texts exactly (LCS never drops lines)', () => {
    forAll(
      genTextPair,
      ({ oldLines, newLines }) => {
        const oldText = oldLines.join('\n');
        const newText = newLines.join('\n');
        const context = Math.max(oldLines.length, newLines.length) + 2;
        const diff = buildQuickCompareDiff({ oldLabel: 'old', newLabel: 'new', oldText, newText, contextLines: context });
        const lines = diff.files[0]?.hunks.flatMap((hunk) => hunk.lines) ?? [];

        const reconstructedOld: string[] = [];
        const reconstructedNew: string[] = [];
        let nextOld = 1;
        let nextNew = 1;
        for (const line of lines) {
          if (line.type === 'context') {
            if (line.oldLineNumber !== nextOld || line.newLineNumber !== nextNew) return false;
            reconstructedOld.push(line.content);
            reconstructedNew.push(line.content);
            nextOld += 1;
            nextNew += 1;
          } else if (line.type === 'removed') {
            if (line.oldLineNumber !== nextOld) return false;
            reconstructedOld.push(line.content);
            nextOld += 1;
          } else if (line.type === 'added') {
            if (line.newLineNumber !== nextNew) return false;
            reconstructedNew.push(line.content);
            nextNew += 1;
          }
        }
        return reconstructedOld.join('\n') === oldText && reconstructedNew.join('\n') === newText;
      },
      { runs: 300 }
    );
  });

  it('hasChanges is exactly "the line arrays differ"; no changes means no files', () => {
    forAll(
      genTextPair,
      ({ oldLines, newLines }) => {
        const diff = buildQuickCompareDiff({
          oldLabel: 'old',
          newLabel: 'new',
          oldText: oldLines.join('\n'),
          newText: newLines.join('\n'),
        });
        const differ = oldLines.join('\n') !== newLines.join('\n');
        if (differ) {
          expect(diff.hasChanges).toBe(true);
          expect(diff.files).toHaveLength(1);
        } else {
          expect(diff.hasChanges).toBe(false);
          expect(diff.files).toEqual([]);
        }
        return true;
      },
      { runs: 300 }
    );
  });

  it('with default context every emitted line matches the source text at its claimed number', () => {
    forAll(
      genTextPair,
      ({ oldLines, newLines }) => {
        const diff = buildQuickCompareDiff({
          oldLabel: 'old',
          newLabel: 'new',
          oldText: oldLines.join('\n'),
          newText: newLines.join('\n'),
          contextLines: 1,
        });
        let lastOld = 0;
        let lastNew = 0;
        for (const file of diff.files) {
          for (const hunk of file.hunks) {
            // Every hunk carries at least one real change.
            if (!hunk.lines.some((line) => line.type === 'added' || line.type === 'removed')) {
              return false;
            }
            for (const line of hunk.lines) {
              if (line.type === 'context' || line.type === 'removed') {
                const number = line.oldLineNumber;
                if (number === undefined || number <= lastOld) return false;
                if (oldLines[number - 1] !== line.content) return false;
                lastOld = number;
              }
              if (line.type === 'context' || line.type === 'added') {
                const number = line.newLineNumber;
                if (number === undefined || number <= lastNew) return false;
                if (newLines[number - 1] !== line.content) return false;
                lastNew = number;
              }
            }
            // Hunk headers describe exactly the lines they contain.
            const oldSide = hunk.lines.filter((line) => line.type !== 'added');
            const newSide = hunk.lines.filter((line) => line.type !== 'removed');
            if (hunk.oldLines !== oldSide.length || hunk.newLines !== newSide.length) return false;
            if (oldSide.length > 0 && hunk.oldStart !== oldSide[0]?.oldLineNumber) return false;
            if (newSide.length > 0 && hunk.newStart !== newSide[0]?.newLineNumber) return false;
          }
        }
        return true;
      },
      { runs: 300 }
    );
  });

  it('summary counts match the diff contents and "No differences" iff nothing changed', () => {
    forAll(
      genTextPair,
      ({ oldLines, newLines }) => {
        const oldText = oldLines.join('\n');
        const newText = newLines.join('\n');
        const summary = summarizeQuickCompare(oldText, newText);
        const context = Math.max(oldLines.length, newLines.length) + 2;
        const diff = buildQuickCompareDiff({ oldLabel: 'old', newLabel: 'new', oldText, newText, contextLines: context });
        const added = diff.files[0]?.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.type === 'added').length ?? 0;
        const removed = diff.files[0]?.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.type === 'removed').length ?? 0;
        // The summary omits zero counts and reads "No differences" when
        // nothing changed — compare the exact rendering.
        const parts: string[] = [];
        if (added > 0) parts.push(`${added} line${added === 1 ? '' : 's'} added`);
        if (removed > 0) parts.push(`${removed} line${removed === 1 ? '' : 's'} removed`);
        expect(summary).toBe(parts.length === 0 ? 'No differences' : parts.join(', '));
        return true;
      },
      { runs: 250 }
    );
  });
});
