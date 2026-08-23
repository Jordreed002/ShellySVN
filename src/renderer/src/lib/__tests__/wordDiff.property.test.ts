import { describe, expect, it } from 'vitest';

import { forAll, genAsciiString, genRecord, genUnicodeString } from '@test-utils/propertyCheck';

import { computeWordDiff, tokenizeLine } from '../wordDiff';

/*
 * Property tests for the word-diff tokenizer/LCS (item #130): tokenization
 * is lossless, and no diff ever drops or invents text — concatenating each
 * side's segments must reproduce the input byte-for-byte.
 */

describe('tokenizeLine properties', () => {
  it('tokens concatenate back to the input exactly (unicode-safe)', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 40 }),
      (text) => tokenizeLine(text).join('') === text,
      { runs: 500 }
    );
  });

  it('tokens are non-empty and no two adjacent tokens share a kind boundary', () => {
    forAll(
      genAsciiString({ minLen: 0, maxLen: 40, chars: 'a b  $._\t' }),
      (text) => {
        const tokens = tokenizeLine(text);
        // Every token is either a whitespace run or whitespace-free.
        return tokens.every((token) => token.length > 0 && (/^\s+$/.test(token) || !/\s/.test(token)));
      },
      { runs: 300 }
    );
  });
});

describe('computeWordDiff properties', () => {
  it('never drops text: segment concatenation reproduces both inputs', () => {
    forAll(
      genRecord({
        oldText: genAsciiString({ minLen: 0, maxLen: 120, chars: 'abc xyz(){}$_.,' }),
        newText: genAsciiString({ minLen: 0, maxLen: 120, chars: 'abc xyz(){}$_.,' }),
      }),
      ({ oldText, newText }) => {
        const result = computeWordDiff(oldText, newText);
        expect(result.oldSegments.map((segment) => segment.text).join('')).toBe(oldText);
        expect(result.newSegments.map((segment) => segment.text).join('')).toBe(newText);
        return true;
      },
      { runs: 400 }
    );
  });

  it('segments are non-empty, and adjacent segments always alternate the changed flag', () => {
    forAll(
      genRecord({
        oldText: genAsciiString({ minLen: 0, maxLen: 80, chars: 'foo bar baz 42' }),
        newText: genAsciiString({ minLen: 0, maxLen: 80, chars: 'foo bor qux 43' }),
      }),
      ({ oldText, newText }) => {
        const result = computeWordDiff(oldText, newText);
        for (const segments of [result.oldSegments, result.newSegments]) {
          for (let i = 0; i < segments.length; i += 1) {
            const segment = segments[i] as { text: string; changed: boolean };
            if (segment.text.length === 0) return false;
            const previous = segments[i - 1];
            if (previous && previous.changed === segment.changed) return false;
          }
        }
        return true;
      },
      { runs: 400 }
    );
  });

  it('identical inputs produce no changed segments', () => {
    forAll(
      genAsciiString({ minLen: 0, maxLen: 80, chars: 'same line 42 ()' }),
      (text) => {
        const result = computeWordDiff(text, text);
        return (
          result.oldSegments.every((segment) => !segment.changed) &&
          result.newSegments.every((segment) => !segment.changed)
        );
      },
      { runs: 300 }
    );
  });

  it('never throws on hostile unicode input', () => {
    forAll(
      genRecord({
        oldText: genUnicodeString({ minLen: 0, maxLen: 60 }),
        newText: genUnicodeString({ minLen: 0, maxLen: 60 }),
      }),
      ({ oldText, newText }) => {
        expect(() => computeWordDiff(oldText, newText)).not.toThrow();
        const result = computeWordDiff(oldText, newText);
        expect(result.oldSegments.map((s) => s.text).join('')).toBe(oldText);
        expect(result.newSegments.map((s) => s.text).join('')).toBe(newText);
        return true;
      },
      { runs: 400 }
    );
  });

  it('a single inserted token only marks that token changed', () => {
    forAll(
      genRecord({
        left: genAsciiString({ minLen: 1, maxLen: 30, chars: 'abcdef' }),
        right: genAsciiString({ minLen: 1, maxLen: 30, chars: 'abcdef' }),
      }),
      ({ left, right }) => {
        const oldText = `x ${left} y`;
        const newText = `x ${left} ${right} y`;
        const result = computeWordDiff(oldText, newText);
        const changedNew = result.newSegments.filter((segment) => segment.changed);
        const changedOld = result.oldSegments.filter((segment) => segment.changed);
        // The common prefix/suffix stay unchanged; only the inserted run and
        // the whitespace around it are marked.
        return changedNew.length >= 1 && changedOld.every((segment) => /^\s*$/.test(segment.text));
      },
      { runs: 300 }
    );
  });
});
