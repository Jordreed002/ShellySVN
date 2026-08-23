import { describe, expect, it } from 'vitest';

import {
  detectCaseCollisions,
  detectNormalizationMismatch,
  detectUnicodeForm,
  foldPathForCaseComparison,
  isNfcNormalized,
  mayDifferByUnicodeNormalization,
  normalizePathForComparison,
} from '../unicode-paths';

// 'café' — U+00E9 (composed, NFC) vs 'e' + U+0301 (decomposed, NFD).
const CAFE_NFC = 'caf\u00e9';
const CAFE_NFD = 'cafe\u0301';

describe('unicode-paths — normalization helpers', () => {
  it('recognizes NFC strings', () => {
    expect(isNfcNormalized(CAFE_NFC)).toBe(true);
    expect(isNfcNormalized('plain-ascii.txt')).toBe(true);
    expect(isNfcNormalized(CAFE_NFD)).toBe(false);
  });

  it('normalizes paths to NFC for comparison', () => {
    expect(normalizePathForComparison(CAFE_NFD)).toBe(CAFE_NFC);
    expect(normalizePathForComparison(`/repo/${CAFE_NFC}/file.txt`)).toBe(
      `/repo/${CAFE_NFC}/file.txt`
    );
  });

  it('classifies strings as NFC, NFD, or mixed', () => {
    expect(detectUnicodeForm(CAFE_NFC)).toBe('NFC');
    expect(detectUnicodeForm(CAFE_NFD)).toBe('NFD');
    // Composed 'é' followed by a decomposed 'á' — neither pure NFC nor pure NFD.
    expect(detectUnicodeForm(`x-${CAFE_NFC}a\u0301`)).toBe('mixed');
  });

  it('pre-filters ASCII-only strings as unable to differ by normalization', () => {
    expect(mayDifferByUnicodeNormalization('README.md')).toBe(false);
    expect(mayDifferByUnicodeNormalization(CAFE_NFC)).toBe(true);
    expect(mayDifferByUnicodeNormalization(CAFE_NFD)).toBe(true);
  });
});

describe('unicode-paths — detectNormalizationMismatch', () => {
  it('detects an NFC recorded name against an NFD on-disk name', () => {
    expect(detectNormalizationMismatch(`${CAFE_NFC}.txt`, `${CAFE_NFD}.txt`)).toEqual({
      expected: `${CAFE_NFC}.txt`,
      onDisk: `${CAFE_NFD}.txt`,
      expectedForm: 'NFC',
      onDiskForm: 'NFD',
    });
  });

  it('detects the reverse direction (NFD recorded, NFC on disk)', () => {
    const mismatch = detectNormalizationMismatch(`/repo/${CAFE_NFD}`, `/repo/${CAFE_NFC}`);
    expect(mismatch).toMatchObject({ expectedForm: 'NFD', onDiskForm: 'NFC' });
  });

  it('reports mixed forms when names combine composed and decomposed sequences', () => {
    const mixedExpected = `${CAFE_NFC}a\u0301`;
    const mixedOnDisk = `${CAFE_NFD}\u00e1`;
    expect(detectNormalizationMismatch(mixedExpected, mixedOnDisk)).toMatchObject({
      expectedForm: 'mixed',
      onDiskForm: 'mixed',
    });
  });

  it('returns null for identical names', () => {
    expect(detectNormalizationMismatch(`${CAFE_NFC}.txt`, `${CAFE_NFC}.txt`)).toBeNull();
  });

  it('returns null for genuinely different names (no false positives)', () => {
    expect(detectNormalizationMismatch('a.txt', 'b.txt')).toBeNull();
    expect(detectNormalizationMismatch(CAFE_NFC, `${CAFE_NFC}s`)).toBeNull();
    // Canonically different accents are different text, not a normalization variant.
    expect(detectNormalizationMismatch('cafe\u0301', 'cafe\u0340')).toBeNull();
  });
});

describe('unicode-paths — case folding and collisions', () => {
  it('folds case and separators without applying NFC', () => {
    expect(foldPathForCaseComparison('/Repo/Readme.MD')).toBe('/repo/readme.md');
    expect(foldPathForCaseComparison('C:\\Repo\\File.TXT')).toBe('c:/repo/file.txt');
    expect(foldPathForCaseComparison('/repo/src/')).toBe('/repo/src');
    // Normalization variants must NOT fold together — that is the mismatch
    // detector's job, not a case collision.
    expect(foldPathForCaseComparison(`/repo/${CAFE_NFC}`)).not.toBe(
      foldPathForCaseComparison(`/repo/${CAFE_NFD}`)
    );
  });

  it('detects paths that differ only by case', () => {
    expect(detectCaseCollisions(['/repo/Readme.md', '/repo/README.md'])).toEqual([
      { pathA: '/repo/Readme.md', pathB: '/repo/README.md' },
    ]);
  });

  it('unifies Windows separator and drive-letter spellings', () => {
    expect(detectCaseCollisions(['C:\\Repo\\File.TXT', 'c:/repo/file.txt'])).toEqual([
      { pathA: 'C:\\Repo\\File.TXT', pathB: 'c:/repo/file.txt' },
    ]);
  });

  it('does not pair identical names', () => {
    expect(detectCaseCollisions(['/repo/a.md', '/repo/a.md', '/repo/a.md'])).toEqual([]);
  });

  it('does not pair names in different directories or non-colliding names', () => {
    expect(detectCaseCollisions(['/repo-a/notes.txt', '/repo-b/Notes.txt'])).toEqual([]);
    expect(detectCaseCollisions(['/repo/Readme.md', '/repo/license.txt'])).toEqual([]);
  });

  it('does not treat normalization-only differences as case collisions', () => {
    expect(detectCaseCollisions([`/repo/${CAFE_NFC}.txt`, `/repo/${CAFE_NFD}.txt`])).toEqual([]);
  });

  it('reports every pair among three or more colliding spellings', () => {
    expect(detectCaseCollisions(['/r/a.md', '/r/A.md', '/r/a.MD'])).toEqual([
      { pathA: '/r/a.md', pathB: '/r/A.md' },
      { pathA: '/r/a.md', pathB: '/r/a.MD' },
      { pathA: '/r/A.md', pathB: '/r/a.MD' },
    ]);
  });

  it('ignores empty paths', () => {
    expect(detectCaseCollisions(['', '/repo/Readme.md'])).toEqual([]);
  });

  it('caps the number of emitted pairs for pathological inputs', () => {
    // 502 distinct case spellings of one name → 125 751 possible pairs, capped.
    const variants = Array.from({ length: 502 }, (_, i) =>
      `/repo/${i
        .toString(2)
        .padStart(10, '0')
        .split('')
        .map((bit) => (bit === '1' ? 'A' : 'a'))
        .join('')}.md`
    );

    expect(variants.length).toBe(502);
    expect(detectCaseCollisions(variants)).toHaveLength(500);
  });
});

describe('unicode-paths — performance smoke (10k entries)', () => {
  it('runs collision detection over 10k synthetic entries in under 500ms', () => {
    const paths: string[] = [];
    for (let i = 0; i < 9998; i += 1) paths.push(`/repo/src/module-${i}/file.ts`);
    paths.push('/repo/Readme.md', '/repo/README.md');

    const startedAt = Date.now();
    const pairs = detectCaseCollisions(paths);
    const elapsedMs = Date.now() - startedAt;

    expect(pairs).toEqual([{ pathA: '/repo/Readme.md', pathB: '/repo/README.md' }]);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('pre-filters 10k ASCII names without normalization work in under 500ms', () => {
    const names = Array.from({ length: 10000 }, (_, i) => `/repo/src/file-${i}.txt`);

    const startedAt = Date.now();
    const plausible = names.some(mayDifferByUnicodeNormalization);
    const elapsedMs = Date.now() - startedAt;

    expect(plausible).toBe(false);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('compares 10k name pairs in under 500ms when a mismatch is plausible', () => {
    const expected = Array.from({ length: 10000 }, (_, i) => `/repo/${CAFE_NFC}-${i}.txt`);
    const onDisk = Array.from({ length: 10000 }, (_, i) => `/repo/${CAFE_NFD}-${i}.txt`);

    const startedAt = Date.now();
    let mismatches = 0;
    for (let i = 0; i < expected.length; i += 1) {
      if (detectNormalizationMismatch(expected[i], onDisk[i])) mismatches += 1;
    }
    const elapsedMs = Date.now() - startedAt;

    expect(mismatches).toBe(10000);
    expect(elapsedMs).toBeLessThan(500);
  });
});
