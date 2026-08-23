/**
 * Quick side-by-side compare for conflict previews (#55).
 *
 * The wizard wants a mine-vs-theirs (or base-vs-side) comparison without
 * asking SVN for anything — both texts are already on disk as conflict
 * artifacts. This module turns two plain strings into the same
 * `SvnDiffResult` shape `VirtualizedDiffViewer` consumes (read-only reuse of
 * the real diff surface), using a small LCS line diff. Pure and unit-tested;
 * no IPC, no DOM.
 */

import type { SvnDiffFile, SvnDiffHunk, SvnDiffLine, SvnDiffResult } from '@shared/types';

/** Above this product of line counts the LCS matrix is skipped for speed. */
const LCS_CELL_BUDGET = 4_000_000;

export interface QuickCompareOptions {
  /** Label/path shown on the removed side (e.g. "Mine (your changes)"). */
  oldLabel: string;
  /** Label/path shown on the added side (e.g. "Theirs (incoming r14)"). */
  newLabel: string;
  oldText: string;
  newText: string;
  /** Context lines around each hunk. Default 3, matching `svn diff`. */
  contextLines?: number;
}

type DiffOp = { type: 'context' | 'removed' | 'added'; text: string };

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

/**
 * Trim the common prefix/suffix so the LCS matrix only covers the changed
 * middle. Returns the ops for the middle plus the trimmed lengths.
 */
function diffMiddle(oldLines: readonly string[], newLines: readonly string[]): {
  ops: DiffOp[];
  prefix: number;
  suffix: number;
} {
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start += 1;
  }
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (
    endOld > start &&
    endNew > start &&
    oldLines[endOld - 1] === newLines[endNew - 1]
  ) {
    endOld -= 1;
    endNew -= 1;
  }

  const middleOld = oldLines.slice(start, endOld);
  const middleNew = newLines.slice(start, endNew);
  const ops = lcsDiff(middleOld, middleNew);
  return { ops, prefix: start, suffix: oldLines.length - endOld };
}

/** LCS line diff; falls back to a whole-block replace when the matrix is too big. */
function lcsDiff(oldLines: readonly string[], newLines: readonly string[]): DiffOp[] {
  if (oldLines.length === 0 && newLines.length === 0) return [];
  if (oldLines.length * newLines.length > LCS_CELL_BUDGET) {
    return [
      ...oldLines.map((text) => ({ type: 'removed' as const, text })),
      ...newLines.map((text) => ({ type: 'added' as const, text })),
    ];
  }

  // lengths[i][j] = LCS length of oldLines[i..] and newLines[j..]
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const lengths: number[][] = Array.from({ length: oldCount + 1 }, () =>
    Array.from<number>({ length: newCount + 1 }).fill(0)
  );
  for (let i = oldCount - 1; i >= 0; i -= 1) {
    for (let j = newCount - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        oldLines[i] === newLines[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < oldCount && j < newCount) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'context', text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      ops.push({ type: 'removed', text: oldLines[i] });
      i += 1;
    } else {
      ops.push({ type: 'added', text: newLines[j] });
      j += 1;
    }
  }
  while (i < oldCount) {
    ops.push({ type: 'removed', text: oldLines[i] });
    i += 1;
  }
  while (j < newCount) {
    ops.push({ type: 'added', text: newLines[j] });
    j += 1;
  }
  return ops;
}

function groupHunks(ops: readonly DiffOp[], contextLines: number): SvnDiffHunk[] {
  // A change block plus its surrounding context. Blocks closer than
  // 2*contextLines merge into one hunk, like unified diff.
  const changedIndexes: number[] = [];
  ops.forEach((op, index) => {
    if (op.type !== 'context') changedIndexes.push(index);
  });
  if (changedIndexes.length === 0) return [];

  const hunks: SvnDiffHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let cursorOp = 0;
  let block = 0;

  const advance = (until: number) => {
    while (cursorOp < until) {
      const op = ops[cursorOp];
      if (op.type === 'context') {
        oldLine += 1;
        newLine += 1;
      } else if (op.type === 'removed') {
        oldLine += 1;
      } else {
        newLine += 1;
      }
      cursorOp += 1;
    }
  };

  while (block < changedIndexes.length) {
    const blockStart = changedIndexes[block];
    let blockEnd = blockStart;
    let next = block + 1;
    while (
      next < changedIndexes.length &&
      changedIndexes[next] - blockEnd <= contextLines * 2 + 1
    ) {
      blockEnd = changedIndexes[next];
      next += 1;
    }

    const from = Math.max(0, blockStart - contextLines);
    const to = Math.min(ops.length, blockEnd + contextLines + 1);
    advance(from);

    const oldStart = oldLine;
    const newStart = newLine;
    const lines: SvnDiffLine[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (let index = from; index < to; index += 1) {
      const op = ops[index];
      if (op.type === 'context') {
        lines.push({
          type: 'context',
          content: op.text,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        });
        oldLine += 1;
        newLine += 1;
        oldCount += 1;
        newCount += 1;
      } else if (op.type === 'removed') {
        lines.push({ type: 'removed', content: op.text, oldLineNumber: oldLine });
        oldLine += 1;
        oldCount += 1;
      } else {
        lines.push({ type: 'added', content: op.text, newLineNumber: newLine });
        newLine += 1;
        newCount += 1;
      }
    }
    cursorOp = to;

    hunks.push({ oldStart, oldLines: oldCount, newStart, newLines: newCount, lines });
    block = next;
  }

  return hunks;
}

/** Build an `SvnDiffResult` comparing two plain texts, ready for the diff viewer. */
export function buildQuickCompareDiff(options: QuickCompareOptions): SvnDiffResult {
  const contextLines = Math.max(0, options.contextLines ?? 3);
  const oldLines = splitLines(options.oldText);
  const newLines = splitLines(options.newText);

  const { ops, prefix, suffix } = diffMiddle(oldLines, newLines);
  const contextPrefix = oldLines.slice(0, prefix);
  const contextSuffix = oldLines.slice(oldLines.length - suffix);

  const allOps: DiffOp[] = [
    ...contextPrefix.map((text) => ({ type: 'context' as const, text })),
    ...ops,
    ...contextSuffix.map((text) => ({ type: 'context' as const, text })),
  ];

  const hunks = groupHunks(allOps, contextLines);
  const hasChanges = ops.some((op) => op.type !== 'context');

  const file: SvnDiffFile = {
    oldPath: options.oldLabel,
    newPath: options.newLabel,
    hunks,
  };

  return {
    files: hasChanges || hunks.length > 0 ? [file] : [],
    hasChanges,
  };
}

/** Short "3 added, 1 removed" style summary for a quick-compare header. */
export function summarizeQuickCompare(oldText: string, newText: string): string {
  const { ops } = diffMiddle(splitLines(oldText), splitLines(newText));
  const added = ops.filter((op) => op.type === 'added').length;
  const removed = ops.filter((op) => op.type === 'removed').length;
  if (added === 0 && removed === 0) return 'No differences';
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} line${added === 1 ? '' : 's'} added`);
  if (removed > 0) parts.push(`${removed} line${removed === 1 ? '' : 's'} removed`);
  return parts.join(', ');
}
