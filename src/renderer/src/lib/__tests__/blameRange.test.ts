import { describe, expect, it } from 'vitest';
import {
  blameAgeScale,
  BLAME_AGE_BUCKETS,
  compareBlameRanges,
  type BlameAnnotation,
} from '../blameRange';

function annotation(overrides: Partial<BlameAnnotation>): BlameAnnotation {
  return {
    revision: 42,
    author: 'jordan',
    date: '2026-08-01T00:00:00.000Z',
    lineNumber: 1,
    content: 'line',
    ...overrides,
  };
}

describe('blameAgeScale', () => {
  it('buckets the newest lines hottest and the oldest coldest', () => {
    const now = Date.parse('2026-08-23T00:00:00.000Z');
    const lines = [
      annotation({ date: '2026-08-22T00:00:00.000Z', lineNumber: 1 }), // 1 day old
      annotation({ date: '2026-07-01T00:00:00.000Z', lineNumber: 2 }), // ~53 days
      annotation({ date: '2024-01-01T00:00:00.000Z', lineNumber: 3 }), // years
    ];
    const scale = blameAgeScale(lines, now);
    expect(scale.bucketOf(lines[0])).toBe(4); // ≤ 7 days
    expect(scale.bucketOf(lines[1])).toBeGreaterThanOrEqual(1);
    expect(scale.bucketOf(lines[1])).toBeLessThan(4);
    expect(scale.bucketOf(lines[2])).toBe(0);
    expect(scale.styleOf(lines[0])).not.toBe(scale.styleOf(lines[2]));
  });

  it('treats uncommitted lines (no date) as the newest bucket', () => {
    const lines = [annotation({ date: '', revision: null, lineNumber: 1 })];
    const scale = blameAgeScale(lines);
    expect(scale.bucketOf(lines[0])).toBe(BLAME_AGE_BUCKETS - 1);
  });

  it('dates everything against the newest annotation, not the clock', () => {
    // A five-year-old file: the newest line in it is still "recent" relative
    // to the file itself, so nothing lands in the coldest bucket.
    const lines = [
      annotation({ date: '2021-01-01T00:00:00.000Z', lineNumber: 1 }),
      annotation({ date: '2021-03-15T00:00:00.000Z', lineNumber: 2 }),
    ];
    const scale = blameAgeScale(lines, Date.parse('2026-08-23T00:00:00.000Z'));
    expect(scale.bucketOf(lines[1])).toBe(BLAME_AGE_BUCKETS - 1);
    expect(scale.bucketOf(lines[0])).toBe(2); // ~73 days older than the newest
  });
});

describe('compareBlameRanges', () => {
  it('classifies unchanged, changed, added and removed lines', () => {
    const atOld = [
      annotation({ revision: 10, lineNumber: 1, content: 'same' }),
      annotation({ revision: 10, lineNumber: 2, content: 'rewritten' }),
      annotation({ revision: 10, lineNumber: 3, content: 'deleted' }),
    ];
    const atNew = [
      annotation({ revision: 10, lineNumber: 1, content: 'same' }),
      annotation({ revision: 20, author: 'sam', lineNumber: 2, content: 'rewritten!' }),
      annotation({ revision: 20, lineNumber: 4, content: 'inserted' }),
    ];

    const { rows, counts } = compareBlameRanges(atOld, atNew);

    expect(counts).toEqual({ unchanged: 1, changed: 1, added: 1, removed: 1 });
    expect(rows.map((row) => [row.lineNumber, row.kind])).toEqual([
      [1, 'unchanged'],
      [2, 'changed'],
      [3, 'removed'],
      [4, 'added'],
    ]);
    expect(rows[1].old?.revision).toBe(10);
    expect(rows[1].new?.revision).toBe(20);
  });

  it('marks a content rewrite as changed even when the revision did not move', () => {
    // Defensive: content is part of the equality so nothing silently reads as
    // unchanged when the same revision number touches different text.
    const atOld = [annotation({ revision: 7, lineNumber: 1, content: 'a' })];
    const atNew = [annotation({ revision: 7, lineNumber: 1, content: 'b' })];
    expect(compareBlameRanges(atOld, atNew).counts.changed).toBe(1);
  });

  it('returns rows sorted by line number across both annotations', () => {
    const atOld = [annotation({ revision: 1, lineNumber: 9 })];
    const atNew = [annotation({ revision: 2, lineNumber: 2 }), annotation({ revision: 2, lineNumber: 9 })];
    const { rows } = compareBlameRanges(atOld, atNew);
    expect(rows.map((row) => row.lineNumber)).toEqual([2, 9]);
  });

  it('handles empty inputs', () => {
    expect(compareBlameRanges([], []).counts).toEqual({
      unchanged: 0,
      changed: 0,
      added: 0,
      removed: 0,
    });
  });
});
