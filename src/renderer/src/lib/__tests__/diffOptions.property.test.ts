import { describe, expect, it } from 'vitest';

import { forAll, genArray, genConstant, genMap, genOneOf, genPick, genRecord } from '@test-utils/propertyCheck';

import type { SvnDiffResult } from '@shared/types';

import { applyDiffOptions, DEFAULT_DIFF_DISPLAY_OPTIONS, normalizeDiffContent } from '../diffOptions';
import { buildQuickCompareDiff } from '../quickCompare';

/*
 * Property tests for the whitespace/EOL display options (item #130):
 * normalization is idempotent, applying options is stable (a second
 * application changes nothing), and pure-whitespace churn collapses to
 * "no changes".
 */

const genLine = genOneOf(
  genConstant(''),
  genMap(genArray(genPick(['a', 'b', '.'] as const), { min: 1, max: 6 }), (chars) =>
    chars.join('').replace(/(.)/g, (char, index) => (index % 3 === 2 ? `${char} ` : char))
  )
);

/** Whitespace-only mutation: collapse/expand space runs without touching text. */
function mutateWhitespace(line: string, mode: 'collapse' | 'expand' | 'trim'): string {
  switch (mode) {
    case 'collapse':
      return line.replace(/ +/g, ' ');
    case 'expand':
      return line.replace(/ /g, '   ');
    default:
      return line.replace(/\s+$|^\s+/g, '');
  }
}

const ALL_OPTIONS = [
  { ignoreWhitespace: true, ignoreEol: false },
  { ignoreWhitespace: false, ignoreEol: true },
  { ignoreWhitespace: true, ignoreEol: true },
] as const;

describe('normalizeDiffContent properties', () => {
  it('is idempotent for every option combination', () => {
    forAll(
      genRecord({
        content: genMap(genArray(genPick(['a', ' ', '.'] as const), { min: 0, max: 20 }), (chars) =>
          chars.join('')
        ),
        options: genPick(ALL_OPTIONS),
      }),
      ({ content, options }) => {
        const once = normalizeDiffContent(content, options);
        return normalizeDiffContent(once, options) === once;
      },
      { runs: 400 }
    );
  });

  it('whitespace-only variants of a line normalize to the same value under ignoreWhitespace', () => {
    forAll(
      genRecord({
        line: genLine,
        mode: genPick(['collapse', 'expand', 'trim'] as const),
      }),
      ({ line, mode }) => {
        const options = { ignoreWhitespace: true, ignoreEol: false };
        return (
          normalizeDiffContent(line, options) ===
          normalizeDiffContent(mutateWhitespace(line, mode), options)
        );
      },
      { runs: 300 }
    );
  });
});

describe('applyDiffOptions properties', () => {
  it('default options return the same object reference', () => {
    forAll(
      genRecord({
        oldText: genMap(genArray(genLine, { min: 0, max: 8 }), (lines) => lines.join('\n')),
        newText: genMap(genArray(genLine, { min: 0, max: 8 }), (lines) => lines.join('\n')),
      }),
      ({ oldText, newText }) => {
        const diff = buildQuickCompareDiff({ oldLabel: 'old', newLabel: 'new', oldText, newText });
        return applyDiffOptions(diff, DEFAULT_DIFF_DISPLAY_OPTIONS) === diff;
      },
      { runs: 200 }
    );
  });

  it('is stable: applying options twice is byte-identical to applying once', () => {
    forAll(
      genRecord({
        oldText: genMap(genArray(genLine, { min: 0, max: 10 }), (lines) => lines.join('\n')),
        newText: genMap(genArray(genLine, { min: 0, max: 10 }), (lines) => lines.join('\n')),
        options: genPick(ALL_OPTIONS),
      }),
      ({ oldText, newText, options }) => {
        const diff = buildQuickCompareDiff({ oldLabel: 'old', newLabel: 'new', oldText, newText });
        const once = applyDiffOptions(diff, options);
        const twice = applyDiffOptions(once, options);
        expect(twice).toEqual(once);
        // Every surviving hunk still contains a real change.
        for (const file of once?.files ?? []) {
          for (const hunk of file.hunks) {
            expect(hunk.lines.some((line) => line.type === 'added' || line.type === 'removed')).toBe(
              true
            );
          }
        }
        return true;
      },
      { runs: 300 }
    );
  });

  it('whitespace-only churn collapses to no changes under ignoreWhitespace', () => {
    const genLineMode = genRecord({
      line: genLine,
      mode: genPick(['collapse', 'expand', 'trim'] as const),
    });
    forAll(
      genArray(genLineMode, { min: 0, max: 8 }),
      (pairs) => {
        const oldText = pairs.map((pair) => pair.line).join('\n');
        const newText = pairs.map((pair) => mutateWhitespace(pair.line, pair.mode)).join('\n');
        const diff = buildQuickCompareDiff({ oldLabel: 'old', newLabel: 'new', oldText, newText });
        const result = applyDiffOptions(diff, { ignoreWhitespace: true, ignoreEol: true }) as SvnDiffResult;
        expect(result.hasChanges).toBe(false);
        for (const file of result.files) {
          expect(file.hunks).toEqual([]);
        }
        return true;
      },
      { runs: 250 }
    );
  });
});
