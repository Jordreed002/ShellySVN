/**
 * Word-level ("intra-line") diff for the DiffViewer family (#47).
 *
 * SVN's unified diff says *which lines* changed; for a line that reads
 * `if (count > 3) {` → `if (count > 5) {` it says nothing about *what* inside
 * the line changed. This module answers that: both lines are split into tokens
 * (runs of word characters, runs of whitespace, single punctuation marks) and
 * the longest common subsequence of tokens is kept; every token outside the
 * LCS is "changed".
 *
 * The LCS is a plain O(n·m) dynamic program over the token arrays. That is
 * fine for real code lines and pathological for minified ones, so lines with
 * more than `MAX_TOKENS` tokens skip the LCS and mark the whole line changed
 * — a minified line is one token in spirit anyway.
 */

/** One token run inside a line, marked as changed or common. */
export interface WordDiffSegment {
  text: string;
  changed: boolean;
}

/** Both sides of one compared line-pair. */
export interface WordDiffResult {
  oldSegments: WordDiffSegment[];
  newSegments: WordDiffSegment[];
}

/** Above this token count per side the LCS is skipped (whole line marked). */
export const MAX_TOKENS = 1200;

const TOKEN_PATTERN = /\s+|[\w$]+|[^\s\w$]/g;

/**
 * Split a line into diff-able tokens. Whitespace runs are tokens too, so a
 * re-indentation shows up as a changed whitespace segment rather than
 * disappearing into the neighbours.
 */
export function tokenizeLine(text: string): string[] {
  const tokens: string[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(text);
  while (match !== null) {
    tokens.push(match[0]);
    match = TOKEN_PATTERN.exec(text);
  }
  return tokens;
}

/** Segments for a side whose tokens are all changed (or all common). */
function uniformSegments(tokens: string[], changed: boolean): WordDiffSegment[] {
  if (tokens.length === 0) return [];
  return [{ text: tokens.join(''), changed }];
}

/**
 * Wrap the LCS backtrack in segments: consecutive tokens with the same
 * `changed` flag merge into one segment so React renders runs, not tokens.
 */
function toSegments(tokens: string[], changedFlags: boolean[]): WordDiffSegment[] {
  const segments: WordDiffSegment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.changed === changedFlags[i]) {
      last.text += tokens[i];
    } else {
      segments.push({ text: tokens[i], changed: changedFlags[i] });
    }
  }
  return segments;
}

/**
 * Word-diff two versions of a line. Identical inputs produce no changed
 * segment; inputs that differ only in whitespace still mark the whitespace
 * runs — the caller decides whether whitespace matters (see `lib/diffOptions`).
 */
export function computeWordDiff(oldText: string, newText: string): WordDiffResult {
  if (oldText === newText) {
    return {
      oldSegments: oldText === '' ? [] : [{ text: oldText, changed: false }],
      newSegments: newText === '' ? [] : [{ text: newText, changed: false }],
    };
  }

  const oldTokens = tokenizeLine(oldText);
  const newTokens = tokenizeLine(newText);

  // Pathological lines: whole-line highlight, no LCS.
  if (oldTokens.length > MAX_TOKENS || newTokens.length > MAX_TOKENS) {
    return {
      oldSegments: uniformSegments(oldTokens, true),
      newSegments: uniformSegments(newTokens, true),
    };
  }

  // dp[i][j] = LCS length of oldTokens[i:] and newTokens[j:].
  const oldLen = oldTokens.length;
  const newLen = newTokens.length;
  const dp: number[][] = Array.from({ length: oldLen + 1 }, () =>
    Array.from<number>({ length: newLen + 1 }).fill(0)
  );
  for (let i = oldLen - 1; i >= 0; i--) {
    for (let j = newLen - 1; j >= 0; j--) {
      dp[i][j] =
        oldTokens[i] === newTokens[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const oldChanged: boolean[] = Array.from<boolean>({ length: oldLen }).fill(true);
  const newChanged: boolean[] = Array.from<boolean>({ length: newLen }).fill(true);

  let i = 0;
  let j = 0;
  while (i < oldLen && j < newLen) {
    if (oldTokens[i] === newTokens[j]) {
      oldChanged[i] = false;
      newChanged[j] = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  return {
    oldSegments: toSegments(oldTokens, oldChanged),
    newSegments: toSegments(newTokens, newChanged),
  };
}
