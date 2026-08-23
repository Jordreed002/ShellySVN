/**
 * Shared row-model for unified and side-by-side diff rendering (#47).
 *
 * Both the `VirtualizedDiffViewer` and the `EnhancedDiffViewer` need the same
 * thing: turn a hunk's linear list of unified-diff lines into *rows* where a
 * removed line and the added line that replaced it sit opposite each other.
 * Runs of removals and additions are zipped position-by-position; the shorter
 * run leaves an explicit `gap` cell so the other side's lines stay aligned
 * instead of drifting up. Context lines span both sides.
 */

import type { SvnDiffLine } from '@shared/types';

/** One aligned row of a side-by-side rendering. */
export interface SideBySideRow {
  /** Left (old) cell; null = gap-filler so the right line stays aligned. */
  left: SvnDiffLine | null;
  /** Right (new) cell; null = gap-filler. */
  right: SvnDiffLine | null;
  /** Index of `left` in the hunk's line array, -1 when absent. */
  leftIndex: number;
  /** Index of `right` in the hunk's line array, -1 when absent. */
  rightIndex: number;
  /** True when left and right are a changed pair (candidate for word-diff). */
  paired: boolean;
}

/**
 * Build aligned rows for one hunk's lines. Pure; exported for tests and for
 * any other diff surface that wants the same alignment.
 */
export function buildSideBySideRows(lines: readonly SvnDiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.type === 'context') {
      rows.push({
        left: line,
        right: line,
        leftIndex: index,
        rightIndex: index,
        paired: false,
      });
      index++;
      continue;
    }

    if (line.type === 'removed') {
      const removed: Array<{ line: SvnDiffLine; index: number }> = [];
      const added: Array<{ line: SvnDiffLine; index: number }> = [];

      while (index < lines.length && lines[index].type === 'removed') {
        removed.push({ line: lines[index], index });
        index++;
      }
      while (index < lines.length && lines[index].type === 'added') {
        added.push({ line: lines[index], index });
        index++;
      }

      const rowCount = Math.max(removed.length, added.length);
      for (let row = 0; row < rowCount; row++) {
        const old = removed[row] ?? null;
        const neu = added[row] ?? null;
        rows.push({
          left: old?.line ?? null,
          right: neu?.line ?? null,
          leftIndex: old?.index ?? -1,
          rightIndex: neu?.index ?? -1,
          paired: old !== null && neu !== null,
        });
      }
      continue;
    }

    if (line.type === 'added') {
      rows.push({
        left: null,
        right: line,
        leftIndex: -1,
        rightIndex: index,
        paired: false,
      });
      index++;
      continue;
    }

    // Hunk/header markers have no side-by-side meaning; skip them.
    index++;
  }

  return rows;
}

/** Word-diff pairing metadata for one unified line. */
export interface UnifiedWordPair {
  oldText: string;
  newText: string;
  side: 'old' | 'new';
}

export interface UnifiedPairedLine {
  line: SvnDiffLine;
  lineIndex: number;
  /** Set when this changed line has a counterpart in the opposite run. */
  wordPair?: UnifiedWordPair;
}

/**
 * Walk a hunk's unified lines in their original order, attaching to each
 * changed line the content of the line it was paired with (removed[i] ↔
 * added[i] inside the same change block). The unified view keeps its linear
 * layout — a removed run stays a removed run — but gains word-level
 * highlighting; order, content and indices are unchanged.
 */
export function pairUnifiedLines(lines: readonly SvnDiffLine[]): UnifiedPairedLine[] {
  // First pass: pair change blocks positionally into a lookup by line index.
  const pairs = new Map<number, UnifiedWordPair>();
  let index = 0;

  while (index < lines.length) {
    if (lines[index].type !== 'removed') {
      index++;
      continue;
    }

    const removed: number[] = [];
    const added: number[] = [];
    while (index < lines.length && lines[index].type === 'removed') {
      removed.push(index);
      index++;
    }
    while (index < lines.length && lines[index].type === 'added') {
      added.push(index);
      index++;
    }

    const rowCount = Math.max(removed.length, added.length);
    for (let row = 0; row < rowCount; row++) {
      const removedIndex = removed[row];
      const addedIndex = added[row];
      if (removedIndex !== undefined && addedIndex !== undefined) {
        const oldText = lines[removedIndex].content;
        const newText = lines[addedIndex].content;
        pairs.set(removedIndex, { oldText, newText, side: 'old' });
        pairs.set(addedIndex, { oldText, newText, side: 'new' });
      }
    }
  }

  // Second pass: emit the lines exactly as they came in.
  return lines.map((line, lineIndex) => ({
    line,
    lineIndex,
    wordPair: pairs.get(lineIndex),
  }));
}
