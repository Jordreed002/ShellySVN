import { describe, expect, it } from 'vitest';

import {
  forAll,
  genArray,
  genConstant,
  genMap,
  genOneOf,
  genOptional,
  genPick,
  genRecord,
  genAsciiString,
  genUnicodeString,
} from '@test-utils/propertyCheck';

import {
  computeEffectiveIgnore,
  formatIgnorePatterns,
  hasGlobMetacharacters,
  hasIgnoreLintErrors,
  lintIgnorePatterns,
  matchesIgnorePattern,
  matchUnversionedEntries,
  parseIgnorePatterns,
} from '../svnIgnorePatterns';

/*
 * Property tests for svn:ignore pattern handling (item #130).
 *
 * The star of the show: `matchesIgnorePattern` is checked against an
 * independent reference matcher that compiles the same APR_FNM_PERIOD
 * semantics down to a JavaScript RegExp — a genuinely different algorithm
 * (NFA in the regex engine vs the hand-rolled backtracker), so blind spots
 * in either implementation show up as mismatches.
 */

/* ─────────────────── reference matcher (regex translation) ─────────────────── */

/** Index of the closing `]` for the class starting at `openIndex`, or -1. */
function findClassEnd(pattern: string, openIndex: number): number {
  for (let i = openIndex + 1; i < pattern.length; i += 1) {
    if (pattern[i] === '\\') {
      i += 1;
      continue;
    }
    if (pattern[i] === ']') return i;
  }
  return -1;
}

const escapeLiteral = (char: string): string => /[.*+?^${}()|[\]\\/]/.test(char) ? `\\${char}` : char;
const escapeInClass = (char: string): string => /[\]\\^-]/.test(char) ? `\\${char}` : char;

/**
 * Translate one `[...]` class body (pattern indexes [start, end)) into a JS
 * character class mirroring matchCharClass: `!`/`^` negation, ranges where a
 * non-']' follows '-', backslash escapes, literal '-' at the edges.
 */
function translateClass(pattern: string, start: number, end: number): string {
  let i = start;
  let negate = false;
  if (i < end && (pattern[i] === '!' || pattern[i] === '^')) {
    negate = true;
    i += 1;
  }
  let body = '';
  while (i < end) {
    let lo = pattern[i] as string;
    if (lo === '\\' && i + 1 < end) {
      i += 1;
      lo = pattern[i] as string;
    }
    if (i + 2 < end && pattern[i + 1] === '-' && pattern[i + 2] !== ']') {
      let hi = pattern[i + 2] as string;
      if (hi === '\\' && i + 3 < end) {
        i += 1;
        hi = pattern[i + 2] as string;
      }
      // The source compares `char >= lo && char <= hi`, so an out-of-order
      // range (lo > hi) matches nothing; JS RegExp would throw on it, so the
      // dead range is skipped instead of emitted.
      if (lo <= hi) {
        body += `${escapeInClass(lo)}-${escapeInClass(hi)}`;
      }
      i += 2;
      continue;
    }
    body += escapeInClass(lo);
    i += 1;
  }
  if (body === '') {
    // `[]` never matches; `[!]`/`[^]` (negated empty) matches everything.
    return negate ? '[\\s\\S]' : '[^\\s\\S]';
  }
  return `[${negate ? '^' : ''}${body}]`;
}

/** Independent fnmatch-with-FNM_PERIOD reference built on RegExp. */
function referenceMatch(name: string, pattern: string): boolean {
  if (pattern.length === 0) return false;
  // APR_FNM_PERIOD: a leading dot in the name needs a literal dot in the pattern.
  if (name.startsWith('.') && pattern[0] !== '.') return false;
  let source = '';
  let pi = 0;
  while (pi < pattern.length) {
    const pc = pattern[pi] as string;
    if (pc === '*') {
      source += '[\\s\\S]*';
      pi += 1;
      continue;
    }
    if (pc === '?') {
      source += '[\\s\\S]';
      pi += 1;
      continue;
    }
    if (pc === '[') {
      const end = findClassEnd(pattern, pi);
      if (end === -1) {
        // Unterminated class: literal '['.
        source += '\\[';
        pi += 1;
        continue;
      }
      source += translateClass(pattern, pi + 1, end);
      pi = end + 1;
      continue;
    }
    if (pc === '\\' && pi + 1 < pattern.length) {
      source += escapeLiteral(pattern[pi + 1] as string);
      pi += 2;
      continue;
    }
    source += escapeLiteral(pc);
    pi += 1;
  }
  return new RegExp(`^(?:${source})$`).test(name);
}

/* ───────────────────────────── generators ───────────────────────────── */

/** Alphabet that exercises every metacharacter and the FNM_PERIOD dot. */
const GLOB_ALPHABET = 'ab.*?[]!^-\\x/';

const genGlobString = (minLen: number, maxLen: number) =>
  genAsciiString({ minLen, maxLen, chars: GLOB_ALPHABET });

const genNamePatternPair = genRecord({
  // Half the names lead with a dot to exercise FNM_PERIOD.
  name: genOneOf(
    genGlobString(0, 10),
    genMap(genGlobString(0, 9), (body) => `.${body}`)
  ),
  pattern: genGlobString(0, 10),
});

/** Pattern list lines: trimmed, non-empty, no separators-only weirdness. */
const genPatternList = genArray(
  genMap(genAsciiString({ minLen: 1, maxLen: 8, chars: 'ab.*?[]!^-\\/' }), (raw) => raw.trim() || 'a'),
  { min: 0, max: 8 }
);

/* ──────────────────────────── properties ──────────────────────────── */

describe('matchesIgnorePattern properties', () => {
  it('agrees with an independent RegExp-based reference matcher', () => {
    forAll(
      genNamePatternPair,
      ({ name, pattern }) =>
        matchesIgnorePattern(name, pattern) === referenceMatch(name, pattern),
      { runs: 1500 }
    );
  });

  it('FNM_PERIOD: a leading dot is never matched unless the pattern starts with a literal dot', () => {
    forAll(
      genRecord({
        body: genGlobString(0, 8),
        pattern: genMap(genGlobString(1, 8), (raw) =>
          raw[0] === '.' ? `x${raw}` : raw
        ),
      }),
      ({ body, pattern }) => {
        if (pattern[0] === '.') return true; // out of the property's domain
        return matchesIgnorePattern(`.${body}`, pattern) === false;
      },
      { runs: 500 }
    );
  });

  it('literal patterns (no metacharacters) match exactly the equal name', () => {
    forAll(
      genRecord({
        left: genAsciiString({ minLen: 0, maxLen: 8, chars: 'abc.' }),
        right: genAsciiString({ minLen: 0, maxLen: 8, chars: 'abc.' }),
      }),
      ({ left, right }) => {
        expect(hasGlobMetacharacters(left)).toBe(false);
        const expected = left === right && left.length > 0;
        return matchesIgnorePattern(right, left) === expected;
      },
      { runs: 500 }
    );
  });

  it('empty pattern never matches anything', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 10 }),
      (name) => matchesIgnorePattern(name, '') === false,
      { runs: 200 }
    );
  });
});

describe('parseIgnorePatterns / formatIgnorePatterns properties', () => {
  it('round-trips pattern lists that contain no surrounding whitespace', () => {
    forAll(
      genPatternList,
      (patterns) => {
        // Domain guard for shrink candidates: no blanks, no CR/LF, trimmed.
        if (patterns.some((pattern) => pattern === '' || pattern !== pattern.trim() || /[\r\n]/.test(pattern))) {
          return true;
        }
        expect(parseIgnorePatterns(formatIgnorePatterns(patterns))).toEqual(patterns);
        return true;
      },
      { runs: 300 }
    );
  });

  it('parse never yields empty or untrimmed patterns, whatever the input', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 60 }),
      (value) => {
        const patterns = parseIgnorePatterns(value);
        return patterns.every((pattern) => pattern.length > 0 && pattern === pattern.trim());
      },
      { runs: 400 }
    );
  });
});

/** Multiset key for a candidate: separator + name. */
function keyOf(candidate: { name: string; isDirectory: boolean }): string {
  return `${candidate.isDirectory ? 'd' : 'f'}:${candidate.name}`;
}

describe('matchUnversionedEntries properties', () => {
  it('partitions candidates: every candidate matched exactly once, by an applicable pattern', () => {
    forAll(
      genRecord({
        patterns: genPatternList,
        candidates: genArray(
          genRecord({
            name: genAsciiString({ minLen: 1, maxLen: 8, chars: 'ab.*?[]!^-' }),
            isDirectory: genPick([false, true]),
          }),
          { min: 0, max: 10 }
        ),
      }),
      ({ patterns, candidates }) => {
        const { matched, unmatched } = matchUnversionedEntries(patterns, candidates);
        // Exactly-once partition, as a multiset over (isDirectory, name).
        const counts = new Map<string, number>();
        for (const candidate of candidates) {
          counts.set(keyOf(candidate), (counts.get(keyOf(candidate)) ?? 0) + 1);
        }
        for (const candidate of [...matched, ...unmatched]) {
          const key = keyOf(candidate);
          const remaining = counts.get(key);
          if (!remaining) return false;
          counts.set(key, remaining - 1);
        }
        if ([...counts.values()].some((remaining) => remaining !== 0)) return false;
        // Every matched candidate really matches the pattern reported.
        return matched.every(
          (candidate) =>
            patterns.includes(candidate.matchedBy) &&
            matchesIgnorePattern(candidate.name, candidate.matchedBy)
        );
      },
      { runs: 300 }
    );
  });
});

describe('lintIgnorePatterns properties', () => {
  it('issues reference real lines, duplicates are errors, and error presence matches the helper', () => {
    forAll(
      genPatternList,
      (patterns) => {
        const issues = lintIgnorePatterns(patterns);
        // Deterministic.
        expect(lintIgnorePatterns(patterns)).toEqual(issues);
        for (const issue of issues) {
          expect(issue.line).toBeGreaterThanOrEqual(1);
          expect(issue.line).toBeLessThanOrEqual(patterns.length);
          expect(patterns[issue.line - 1]).toBe(issue.pattern);
        }
        // Exact duplicates must be flagged as errors on the second occurrence.
        const firstSeen = new Map<string, number>();
        patterns.forEach((pattern, index) => {
          const first = firstSeen.get(pattern);
          if (first === undefined) {
            firstSeen.set(pattern, index + 1);
            return;
          }
          const duplicateIssue = issues.find(
            (issue) => issue.line === index + 1 && issue.code === 'duplicate'
          );
          expect(duplicateIssue?.severity).toBe('error');
        });
        // hasIgnoreLintErrors is exactly "some error-severity issue exists".
        expect(hasIgnoreLintErrors(issues)).toBe(issues.some((issue) => issue.severity === 'error'));
        return true;
      },
      { runs: 300 }
    );
  });

  it('path separators in patterns (not trailing) are always flagged as errors', () => {
    forAll(
      genAsciiString({ minLen: 1, maxLen: 8, chars: 'ab/\\' }),
      (raw) => {
        // Keep separators but make sure the pattern does not end with '/'
        // (that would be the trailing-slash warning instead).
        const pattern = raw.endsWith('/') ? `${raw}x` : raw;
        if (!/[\\/]/.test(pattern)) return true; // out of domain
        const issues = lintIgnorePatterns([pattern]);
        return issues.some((issue) => issue.code === 'path-separator' && issue.severity === 'error');
      },
      { runs: 400 }
    );
  });
});

describe('computeEffectiveIgnore properties', () => {
  const genValue = genOneOf(
    genConstant(''),
    genConstant('   '),
    genMap(genPatternList, (patterns) => (patterns.length === 0 ? 'a' : patterns.join('\n')))
  );

  it('effective set = own ignore + nearest global-ignores (explicit beats inherited)', () => {
    forAll(
      genRecord({
        explicitIgnore: genValue,
        explicitGlobalIgnores: genOptional(genValue, 0.2),
        inheritedGlobalIgnores: genOptional(genValue, 0.2),
      }),
      ({ explicitIgnore, explicitGlobalIgnores, inheritedGlobalIgnores }) => {
        const result = computeEffectiveIgnore({
          explicitIgnore,
          explicitGlobalIgnores,
          inheritedGlobalIgnores,
        });
        const explicitActive =
          explicitGlobalIgnores !== undefined && explicitGlobalIgnores.trim() !== '';
        const inheritedActive =
          !explicitActive &&
          inheritedGlobalIgnores !== undefined &&
          inheritedGlobalIgnores.trim() !== '';
        const expectedGlobal = explicitActive
          ? parseIgnorePatterns(explicitGlobalIgnores as string)
          : inheritedActive
            ? parseIgnorePatterns(inheritedGlobalIgnores as string)
            : [];
        expect(result.effectiveGlobal.patterns).toEqual(expectedGlobal);
        expect(result.effectiveGlobal.source).toBe(
          explicitActive ? 'explicit' : inheritedActive ? 'inherited' : 'none'
        );
        expect(result.effective).toEqual([
          ...parseIgnorePatterns(explicitIgnore),
          ...expectedGlobal,
        ]);
        return true;
      },
      { runs: 300 }
    );
  });
});
