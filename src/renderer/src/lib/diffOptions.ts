/**
 * Client-side re-computation of parsed diffs with whitespace options (#47).
 *
 * The `svn diff` IPC has no ignore-whitespace flags, so the option is applied
 * here, to the *parsed* diff the renderer already holds: a removed/added pair
 * whose two texts are equal once whitespace (or line endings) is normalised
 * was never a real change — both lines become context, the hunk headers are
 * re-counted, and hunks left with no changes at all disappear. A file whose
 * every hunk disappears had only whitespace churn, and the viewers' "no
 * changes" state then says exactly that.
 *
 * The re-numbering is honest: a merged context line keeps the removed line's
 * old number and the added line's new number, exactly as a context line SVN
 * would have emitted.
 */

import type { SvnDiffFile, SvnDiffHunk, SvnDiffLine, SvnDiffResult } from '@shared/types';

export interface DiffDisplayOptions {
  /** Treat lines that differ only in whitespace as unchanged. */
  ignoreWhitespace: boolean;
  /** Treat lines that differ only in their line ending (`\r\n` vs `\n`) as unchanged. */
  ignoreEol: boolean;
}

export const DEFAULT_DIFF_DISPLAY_OPTIONS: DiffDisplayOptions = {
  ignoreWhitespace: false,
  ignoreEol: false,
};

/** True when neither option is active and the diff can be shown as parsed. */
export function isDefaultDiffOptions(options: DiffDisplayOptions): boolean {
  return !options.ignoreWhitespace && !options.ignoreEol;
}

/** Normalise a line's content for comparison under the given options. */
export function normalizeDiffContent(content: string, options: DiffDisplayOptions): string {
  let normalized = content;
  if (options.ignoreEol) {
    normalized = normalized.replace(/\r+$/, '');
  }
  if (options.ignoreWhitespace) {
    normalized = normalized.replace(/\s+/g, '');
  }
  return normalized;
}

function isChangeLine(line: SvnDiffLine): boolean {
  return line.type === 'added' || line.type === 'removed';
}

/**
 * Rebuild one hunk with the options applied. Returns null when nothing in the
 * hunk changes any more — the hunk itself was pure whitespace churn.
 */
function recomputeHunk(hunk: SvnDiffHunk, options: DiffDisplayOptions): SvnDiffHunk | null {
  const lines = hunk.lines.filter((line) => line.type !== 'hunk' && line.type !== 'header');
  const output: SvnDiffLine[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (!isChangeLine(line)) {
      output.push(line);
      index++;
      continue;
    }

    // Collect the maximal removed-run followed by the maximal added-run —
    // the same shape a unified diff always emits them in.
    const removed: SvnDiffLine[] = [];
    const added: SvnDiffLine[] = [];
    while (index < lines.length && lines[index].type === 'removed') {
      removed.push(lines[index]);
      index++;
    }
    while (index < lines.length && lines[index].type === 'added') {
      added.push(lines[index]);
      index++;
    }

    // Zip the two runs; a pair that normalises equal becomes one context line.
    const rowCount = Math.max(removed.length, added.length);
    for (let row = 0; row < rowCount; row++) {
      const oldLine = removed[row];
      const newLine = added[row];
      if (
        oldLine &&
        newLine &&
        normalizeDiffContent(oldLine.content, options) ===
          normalizeDiffContent(newLine.content, options)
      ) {
        output.push({
          type: 'context',
          content: newLine.content,
          oldLineNumber: oldLine.oldLineNumber,
          newLineNumber: newLine.newLineNumber,
        });
      } else {
        if (oldLine) output.push(oldLine);
        if (newLine) output.push(newLine);
      }
    }
  }

  const stillChanged = output.some(isChangeLine);
  if (!stillChanged) return null;

  // Re-count the header from the surviving lines rather than trusting the old
  // numbers, which described a different set of lines.
  const oldNumbers = output
    .map((line) => line.oldLineNumber)
    .filter((value): value is number => typeof value === 'number');
  const newNumbers = output
    .map((line) => line.newLineNumber)
    .filter((value): value is number => typeof value === 'number');

  const oldStart = oldNumbers.length > 0 ? Math.min(...oldNumbers) : hunk.oldStart;
  const newStart = newNumbers.length > 0 ? Math.min(...newNumbers) : hunk.newStart;

  return {
    ...hunk,
    oldStart,
    oldLines: oldNumbers.length,
    newStart,
    newLines: newNumbers.length,
    lines: output,
  };
}

/**
 * Apply whitespace options to a whole parsed diff. Returns the same object
 * reference when the options are the defaults or the diff has nothing to do.
 */
export function applyDiffOptions(
  diff: SvnDiffResult | null,
  options: DiffDisplayOptions
): SvnDiffResult | null {
  if (!diff) return null;
  if (isDefaultDiffOptions(options)) return diff;
  if (diff.isBinary) return diff;

  const files: SvnDiffFile[] = [];
  for (const file of diff.files) {
    const hunks = file.hunks
      .map((hunk) => recomputeHunk(hunk, options))
      .filter((hunk): hunk is SvnDiffHunk => hunk !== null);
    files.push({ ...file, hunks });
  }

  const hasChanges = files.some((file) => file.hunks.length > 0);
  return {
    ...diff,
    files,
    hasChanges,
    isBinary: hasChanges ? diff.isBinary : false,
  };
}
