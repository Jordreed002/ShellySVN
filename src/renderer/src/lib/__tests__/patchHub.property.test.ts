import { describe, expect, it } from 'vitest';

import { forAll, genArray, genBoolean, genInt, genMap, genPick, genRecord, genUnicodeString } from '@test-utils/propertyCheck';

import {
  dryRunHasConflicts,
  isRejectFileName,
  locateHunkInContent,
  parseRejectFile,
  rejectFileTarget,
  summarizeDryRunOutput,
  type RejectHunkLine,
} from '../patchHub';

/*
 * Property tests for the patch-hunk parsing half of lib/patchHub (item #130):
 * generated unified-diff reject files round-trip through parseRejectFile,
 * located hunks report where they matched, and dry-run summaries never
 * under-count conflicts.
 *
 * Domain note: an add-line whose text starts with `++` would serialize to a
 * raw `+++…` line, which the parser (like classic patch) treats as a file
 * header and drops — reported edge case; the generator excludes it.
 */

const genHunkLineText = genMap(genUnicodeString({ minLen: 0, maxLen: 12 }), (raw) =>
  raw.replace(/[\r\n]/g, ' ')
);

const genHunkLine = genRecord({
  kind: genPick(['context', 'remove', 'add'] as const),
  text: genHunkLineText,
});

const genHunk = genRecord({
  oldStart: genInt({ min: 1, max: 500 }),
  oldCount: genInt({ min: 1, max: 9 }),
  newStart: genInt({ min: 1, max: 500 }),
  section: genPick(['', ' some section text'] as const),
  lines: genArray(
    genMap(
      genHunkLine,
      (line): RejectHunkLine =>
        line.kind === 'add' && line.text.startsWith('++')
          ? { kind: 'add', text: `x${line.text}` } // keep out of the `+++` ambiguity
          : line
    ),
    { min: 0, max: 6 }
  ),
});

function serializeHunk(hunk: Hunk): string {
  const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart} @@${hunk.section}`;
  const body = hunk.lines
    .map((line) =>
      line.kind === 'add' ? `+${line.text}` : line.kind === 'remove' ? `-${line.text}` : ` ${line.text}`
    )
    .join('\n');
  return body.length > 0 ? `${header}\n${body}` : header;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  section: string;
  lines: RejectHunkLine[];
}

const genTargetPath = genMap(genUnicodeString({ minLen: 1, maxLen: 12 }), (raw) =>
  `t-${raw.replace(/[\r\n\s]/g, '') || 'x'}`
);

describe('parseRejectFile properties', () => {
  it('round-trips generated unified-diff reject files', () => {
    forAll(
      genRecord({ target: genTargetPath, hunks: genArray(genHunk, { min: 0, max: 4 }) }),
      ({ target, hunks }) => {
        const content = [
          `--- ${target}`,
          `+++ ${target}`,
          ...hunks.map(serializeHunk),
        ].join('\n');
        const parsed = parseRejectFile(content);
        expect(parsed.targetPath).toBe(target);
        expect(parsed.hunks).toHaveLength(hunks.length);
        hunks.forEach((hunk, index) => {
          const parsedHunk = parsed.hunks[index];
          expect(parsedHunk?.oldStart).toBe(hunk.oldStart);
          expect(parsedHunk?.lines).toEqual(hunk.lines);
          expect(parsedHunk?.header).toBe(
            `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart} @@${hunk.section}`.trim()
          );
        });
        return true;
      },
      { runs: 250 }
    );
  });

  it('never throws on hostile content and reports null/empty hunks conservatively', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 80 }),
      (content) => {
        expect(() => parseRejectFile(content)).not.toThrow();
        const parsed = parseRejectFile(content);
        expect(Array.isArray(parsed.hunks)).toBe(true);
        // Every parsed hunk was introduced by a real @@ header.
        return parsed.hunks.every((hunk) => hunk.oldStart >= 0);
      },
      { runs: 300 }
    );
  });
});

describe('locateHunkInContent properties', () => {
  it('finds hunk context verbatim and keeps row numbering monotone', () => {
    forAll(
      genRecord({
        before: genArray(genHunkLineText, { min: 0, max: 5 }),
        hunk: genHunk,
        after: genArray(genHunkLineText, { min: 0, max: 5 }),
      }),
      ({ before, hunk, after }) => {
        // Build a file whose middle IS the hunk's context/remove lines.
        const contextTexts = hunk.lines
          .filter((line) => line.kind !== 'add')
          .map((line) => line.text);
        const fileLines = [...before, ...contextTexts, ...after];
        const fileContent = fileLines.join('\n');
        // The lib splits content with String#split, so an empty file is one
        // empty line — mirror that convention for the row-text comparisons.
        const splitFileLines = fileContent.split(/\r?\n/);
        const located = locateHunkInContent(fileContent, {
          header: '@@ -1 +1 @@',
          oldStart: before.length + 1,
          lines: hunk.lines,
        });
        if (contextTexts.length > 0) {
          expect(located.matched).toBe(true);
          // The lib scans from the top, so when earlier lines happen to
          // duplicate the context it reports the FIRST occurrence — always
          // at or before the placement, and always a real context window.
          const zeroBased = located.matchedAt - 1;
          expect(zeroBased).toBeGreaterThanOrEqual(0);
          expect(zeroBased).toBeLessThanOrEqual(before.length);
          expect(splitFileLines.slice(zeroBased, zeroBased + contextTexts.length)).toEqual(
            contextTexts
          );
        }
        // Positive line numbers strictly increase; context rows show the
        // target file's actual lines (out-of-range rows fall back to '').
        let lastPositive = 0;
        for (const row of located.rows) {
          if (row.lineNumber > 0) {
            expect(row.lineNumber).toBeGreaterThan(lastPositive);
            lastPositive = row.lineNumber;
            if (row.kind === 'context') {
              expect(row.text).toBe(splitFileLines[row.lineNumber - 1] ?? '');
            }
          } else {
            expect(row.kind).toBe('rejected-add');
          }
        }
        return true;
      },
      { runs: 250 }
    );
  });
});

describe('dry-run summary properties', () => {
  const ACTIONS = ['A', 'D', 'U', 'G', 'C'] as const;
  const genActionLine = genRecord({
    action: genPick(ACTIONS),
    path: genTargetPath,
  });
  const genNoise = genMap(genUnicodeString({ minLen: 0, maxLen: 20 }), (raw) =>
    raw.replace(/[\r\n]/g, '')
  );

  it('parses exactly the well-formed action lines and never under-reports conflicts', () => {
    forAll(
      genRecord({
        actions: genArray(genActionLine, { min: 0, max: 8 }),
        noise: genArray(genNoise, { min: 0, max: 8 }),
      }),
      ({ actions, noise }) => {
        const lines = [
          ...actions.map(({ action, path }) => `${action} ${path}`),
          ...noise.filter((line) => !/^[ADUGC]\s+\S/.test(line)),
        ];
        const output = lines.join('\n');
        const summary = summarizeDryRunOutput(output);
        expect(summary.actions).toHaveLength(actions.length);
        actions.forEach(({ action, path }, index) => {
          expect(summary.actions[index]).toEqual({ action, path });
        });
        const conflicts = actions.filter((line) => line.action === 'C');
        expect(summary.conflicts).toHaveLength(conflicts.length);
        expect(summary.rejects).toBeGreaterThanOrEqual(conflicts.length);
        expect(dryRunHasConflicts(summary)).toBe(
          conflicts.length > 0 || summary.rejects > 0
        );
        return true;
      },
      { runs: 250 }
    );
  });
});

describe('reject filename helpers properties', () => {
  it('strips either reject suffix (case-insensitively) back to the target path', () => {
    forAll(
      genRecord({
        target: genMap(genTargetPath, (raw) => raw.replace(/\.(rej|svnpatch\.rej)$/i, '')),
        suffix: genPick(['.rej', '.svnpatch.rej', '.REJ', '.SvnPatch.Rej'] as const),
        unrelated: genBoolean(),
      }),
      ({ target, suffix, unrelated }) => {
        const name = unrelated ? `x-${target}` : `${target}${suffix}`;
        expect(isRejectFileName(name)).toBe(!unrelated);
        if (!unrelated) {
          expect(rejectFileTarget(name)).toBe(target);
        }
        return true;
      },
      { runs: 300 }
    );
  });
});
