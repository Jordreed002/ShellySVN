/**
 * Shared blame utilities (#46 blame gutter, #71 range comparison).
 *
 * Two independent computations live here because both are pure functions of
 * `svn blame` output and both are unit-tested without a component:
 *
 * - `blameAgeBuckets` / `blameAgeStyle`: for the blame gutter, mapping each
 *   line's age to a colour intensity so "hot" (recently touched) lines stand
 *   out at a glance — the same idea GitHub's blame heatmap uses.
 * - `compareBlameRanges`: line-level delta between the same file annotated at
 *   two revisions (rX vs rY), so BlameView can show which lines *between two
 *   revisions* were added, removed, or re-attributed.
 */

/**
 * Minimal annotation shape both blame consumers already produce: the
 * repo-browser's `BlameLine` and a mapped `SvnBlameResult` line are
 * structurally this, so both can be passed in without a conversion layer.
 */
export interface BlameAnnotation {
  /** null = uncommitted local edit; `svn blame` has no revision for it. */
  revision: number | null;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

// ============================================
// Age intensity (blame gutter)
// ============================================

/** Number of intensity buckets; 0 = oldest, BUCKETS-1 = newest. */
export const BLAME_AGE_BUCKETS = 5;

/**
 * Bucket thresholds in days, oldest first: older than 365 days → bucket 0,
 * older than 90 → 1, older than 30 → 2, older than 7 → 3, else 4 (newest).
 */
const AGE_DAY_THRESHOLDS = [365, 90, 30, 7];

export interface BlameAgeScale {
  /** Per-line bucket, oldest (0) to newest (BUCKETS-1). Uncommitted lines are newest. */
  bucketOf: (line: BlameAnnotation) => number;
  /** Tailwind classes tinting a gutter cell by bucket. */
  styleOf: (line: BlameAnnotation) => string;
}

const BUCKET_BG = [
  'bg-accent/5',
  'bg-accent/10',
  'bg-accent/20',
  'bg-accent/30',
  'bg-accent/45',
] as const;

function daysBetween(a: number, b: number): number {
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

/**
 * Build the age scale for one blame result. The reference point is the newest
 * date present (not "now": on an old checkout, dating everything against
 * today would paint the whole file cold and hide the recent work inside it).
 * Uncommitted lines (no date) always count as the newest bucket.
 */
export function blameAgeScale(lines: readonly BlameAnnotation[], now = Date.now()): BlameAgeScale {
  let newest = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    const time = Date.parse(line.date);
    if (Number.isFinite(time) && time > newest) newest = time;
  }
  const reference = Number.isFinite(newest) ? newest : now;

  const bucketOf = (line: BlameAnnotation): number => {
    if (!line.date) return BLAME_AGE_BUCKETS - 1;
    const time = Date.parse(line.date);
    if (!Number.isFinite(time)) return 0;
    const age = daysBetween(reference, time);
    for (let bucket = 0; bucket < AGE_DAY_THRESHOLDS.length; bucket++) {
      if (age > AGE_DAY_THRESHOLDS[bucket]) return bucket;
    }
    return BLAME_AGE_BUCKETS - 1;
  };

  return {
    bucketOf,
    styleOf: (line: BlameAnnotation): string => BUCKET_BG[bucketOf(line)],
  };
}

// ============================================
// Range comparison (rX vs rY)
// ============================================

/** What happened to one line number between the two annotations. */
export type BlameRangeRowKind = 'unchanged' | 'changed' | 'added' | 'removed';

export interface BlameRangeRow {
  /** Line number in the newer annotation (`rY`); the removed-only rows carry the old file's number. */
  lineNumber: number;
  kind: BlameRangeRowKind;
  /** Annotation at rX, when the line existed there. */
  old: BlameAnnotation | null;
  /** Annotation at rY, when the line still exists there. */
  new: BlameAnnotation | null;
}

export interface BlameRangeDelta {
  rows: BlameRangeRow[];
  counts: Record<BlameRangeRowKind, number>;
}

/**
 * Compare the same file's blame at two revisions. Both inputs are full
 * annotations (blame up to rX and up to rY); the lines are aligned by line
 * number, so a block inserted in the middle of the file shifts everything
 * under it — that shift reads as changed/added/removed rows, which is exactly
 * what "what did rX..rY do to this file" should surface.
 *
 * A row is `changed` when its attribution moved (different revision or
 * author) — the content at that line was rewritten inside the range.
 */
export function compareBlameRanges(
  oldLines: readonly BlameAnnotation[],
  newLines: readonly BlameAnnotation[]
): BlameRangeDelta {
  const oldByNumber = new Map<number, BlameAnnotation>();
  for (const line of oldLines) oldByNumber.set(line.lineNumber, line);
  const newByNumber = new Map<number, BlameAnnotation>();
  for (const line of newLines) newByNumber.set(line.lineNumber, line);

  const numbers = new Set<number>([...oldByNumber.keys(), ...newByNumber.keys()]);
  const ordered = [...numbers].toSorted((a, b) => a - b);

  const rows: BlameRangeRow[] = [];
  const counts: Record<BlameRangeRowKind, number> = {
    unchanged: 0,
    changed: 0,
    added: 0,
    removed: 0,
  };

  for (const lineNumber of ordered) {
    const oldLine = oldByNumber.get(lineNumber) ?? null;
    const newLine = newByNumber.get(lineNumber) ?? null;

    let kind: BlameRangeRowKind;
    if (oldLine && newLine) {
      const sameRevision =
        oldLine.revision === null && newLine.revision === null
          ? true
          : oldLine.revision === newLine.revision;
      kind =
        sameRevision && oldLine.author === newLine.author && oldLine.content === newLine.content
          ? 'unchanged'
          : 'changed';
    } else if (newLine) {
      kind = 'added';
    } else {
      kind = 'removed';
    }

    counts[kind]++;
    rows.push({ lineNumber, kind, old: oldLine, new: newLine });
  }

  return { rows, counts };
}
