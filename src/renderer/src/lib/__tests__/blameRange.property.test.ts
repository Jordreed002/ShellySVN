import { describe, expect, it } from 'vitest';

import { forAll, genArray, genInt, genMap, genPick, genRecord } from '@test-utils/propertyCheck';

import {
  blameAgeScale,
  BLAME_AGE_BUCKETS,
  compareBlameRanges,
  type BlameAnnotation,
  type BlameRangeRowKind,
} from '../blameRange';

/*
 * Property tests for blame utilities (item #130): range comparison classifies
 * every line exactly once with reference semantics, and the age scale is
 * monotone in time and bounded.
 */

const BASE_TIME = Date.UTC(2026, 0, 1);
/** Day offsets chosen around every bucket threshold (365/90/30/7). */
const DAY_OFFSETS = [0, 1, 5, 8, 20, 31, 60, 95, 200, 366, 800] as const;
const BUCKET_BG = ['bg-accent/5', 'bg-accent/10', 'bg-accent/20', 'bg-accent/30', 'bg-accent/45'];

function annotationFrom(lineNumber: number, salt: number, undated: boolean): BlameAnnotation {
  const revision = [null, 1, 7, 42][salt % 4];
  const author = salt % 2 === 0 ? 'alice' : 'bob';
  const content = ['const x = 1;', 'return null;', '// comment'][salt % 3] as string;
  const dayOffset = DAY_OFFSETS[salt % DAY_OFFSETS.length] as number;
  return {
    revision,
    author,
    date: undated ? '' : new Date(BASE_TIME - dayOffset * 86_400_000).toISOString(),
    lineNumber,
    content,
  };
}

const genBlameLines = genArray(
  genMap(
    genRecord({
      lineNumber: genInt({ min: 1, max: 50 }),
      salt: genInt({ min: 0, max: 11 }),
      undated: genPick([false, true]),
    }),
    ({ lineNumber, salt, undated }) => annotationFrom(lineNumber, salt, undated)
  ),
  { min: 0, max: 10 }
);

const hasUniqueLineNumbers = (lines: BlameAnnotation[]): boolean =>
  new Set(lines.map((line) => line.lineNumber)).size === lines.length;

describe('compareBlameRanges properties', () => {
  it('classifies every line exactly once, with the documented kind semantics', () => {
    forAll(
      genRecord({ oldLines: genBlameLines, newLines: genBlameLines }),
      ({ oldLines, newLines }) => {
        // Line numbers are the join key; duplicates would be last-wins maps.
        if (!hasUniqueLineNumbers(oldLines) || !hasUniqueLineNumbers(newLines)) return true;
        const { rows, counts } = compareBlameRanges(oldLines, newLines);
        const numbers = new Set([...oldLines, ...newLines].map((line) => line.lineNumber));
        expect(rows).toHaveLength(numbers.size);
        const tally: Record<BlameRangeRowKind, number> = {
          unchanged: 0,
          changed: 0,
          added: 0,
          removed: 0,
        };

        const oldByNumber = new Map(oldLines.map((line) => [line.lineNumber, line]));
        const newByNumber = new Map(newLines.map((line) => [line.lineNumber, line]));
        for (const row of rows) {
          const oldLine = oldByNumber.get(row.lineNumber) ?? null;
          const newLine = newByNumber.get(row.lineNumber) ?? null;
          expect(row.old).toEqual(oldLine);
          expect(row.new).toEqual(newLine);
          const expectedKind: BlameRangeRowKind =
            oldLine && newLine
              ? oldLine.revision === newLine.revision &&
                  oldLine.author === newLine.author &&
                  oldLine.content === newLine.content
                ? 'unchanged'
                : 'changed'
              : newLine
                ? 'added'
                : 'removed';
          expect(row.kind).toBe(expectedKind);
          tally[row.kind] += 1;
        }
        expect(tally).toEqual(counts);
        return true;
      },
      { runs: 200 }
    );
  });

  it('identical annotations are entirely unchanged', () => {
    forAll(
      genBlameLines,
      (lines) => {
        if (!hasUniqueLineNumbers(lines)) return true;
        const { rows, counts } = compareBlameRanges(lines, lines);
        expect(counts.added).toBe(0);
        expect(counts.removed).toBe(0);
        expect(counts.changed).toBe(0);
        expect(counts.unchanged).toBe(rows.length);
        return true;
      },
      { runs: 150 }
    );
  });
});

describe('blameAgeScale properties', () => {
  it('buckets are bounded, styleOf tracks the bucket, and age is monotone', () => {
    forAll(
      genBlameLines,
      (lines) => {
        const scale = blameAgeScale(lines);
        for (const line of lines) {
          const bucket = scale.bucketOf(line);
          expect(bucket).toBeGreaterThanOrEqual(0);
          expect(bucket).toBeLessThan(BLAME_AGE_BUCKETS);
          expect(scale.styleOf(line)).toBe(BUCKET_BG[bucket]);
          // A line with no date always counts as newest.
          if (line.date === '') {
            expect(bucket).toBe(BLAME_AGE_BUCKETS - 1);
          }
        }
        // Monotone: an older line never lands in a newer bucket than a newer line.
        const dated = lines.filter((line) => line.date !== '');
        for (let i = 0; i < dated.length; i += 1) {
          for (let j = 0; j < dated.length; j += 1) {
            const a = dated[i] as BlameAnnotation;
            const b = dated[j] as BlameAnnotation;
            // Buckets: 0 = oldest … 4 = newest, so an older-or-equal line
            // lands in a lower-or-equal bucket.
            if (Date.parse(a.date) <= Date.parse(b.date)) {
              expect(scale.bucketOf(a)).toBeLessThanOrEqual(scale.bucketOf(b));
            }
          }
        }
        return true;
      },
      { runs: 120 }
    );
  });
});
