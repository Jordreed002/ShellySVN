import { describe, expect, it } from 'vitest';

import { forAll, genArray, genInt, genMap, genPick, genRecord } from '@test-utils/propertyCheck';

import { confidenceLabel, suggestChangelists, type ChangelistSuggestion } from '../changelistSuggestions';

/*
 * Property tests for changelist suggestions (item #130): suggestions are
 * pairwise disjoint, every member exists in the (normalized) input, fewer
 * than two paths yields nothing, and the output is stable across input
 * re-orderings — except the `id`, which is derived from the *unsorted*
 * members and therefore order-dependent (reported bug; see comment below).
 */

const DIRS = ['src/core', 'src/ui', 'lib', 'tests/unit', 'docs', '.github', 'config'] as const;
const FILES = ['a.ts', 'b.ts', 'x.test.ts', 'readme.md', 'notes.txt', 'package.json', 'setup.yml'] as const;

const genPath = genMap(
  genRecord({ dir: genPick(DIRS), file: genPick(FILES), backslash: genPick([false, true]) }),
  ({ dir, file, backslash }) => `${dir}/${file}`.replace(/\//g, backslash ? '\\' : '/')
);

const genPaths = genArray(genPath, { min: 0, max: 12 });

/** Everything except the order-dependent id (reported bug). */
function stableView(suggestions: ChangelistSuggestion[]): unknown {
  return suggestions.map((suggestion) => ({
    name: suggestion.name,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    members: suggestion.members,
    description: suggestion.description,
  }));
}

describe('suggestChangelists properties', () => {
  it('suggestions are pairwise disjoint and every member exists in the input', () => {
    forAll(
      genRecord({ paths: genPaths, rootPath: genPick([undefined, '/wc'] as const) }),
      ({ paths, rootPath }) => {
        if (paths.length < 2) return true; // covered by the dedicated test below
        const suggestions = suggestChangelists(paths, rootPath ? { rootPath } : {});
        const normalizedInput = new Set(paths.map((path) => path.trim().replace(/\\/g, '/')));
        const seen = new Set<string>();
        for (const suggestion of suggestions) {
          expect(suggestion.members.length).toBeGreaterThan(0);
          expect(suggestion.confidence).toBeGreaterThan(0);
          expect(suggestion.confidence).toBeLessThanOrEqual(1);
          // Members are sorted and unique.
          expect([...suggestion.members].toSorted((a, b) => a.localeCompare(b))).toEqual(suggestion.members);
          expect(new Set(suggestion.members).size).toBe(suggestion.members.length);
          for (const member of suggestion.members) {
            expect(normalizedInput.has(member)).toBe(true);
            // Disjointness across suggestions.
            expect(seen.has(member)).toBe(false);
            seen.add(member);
          }
          expect(suggestion.name.length).toBeGreaterThan(0);
          expect(suggestion.description.length).toBeGreaterThan(0);
          // id format: name::count::first-member.
          expect(suggestion.id.startsWith(`${suggestion.name}::${suggestion.members.length}::`)).toBe(
            true
          );
        }
        // Deterministic for identical input, and confidence labels partition [0,1].
        expect(stableView(suggestChangelists(paths, rootPath ? { rootPath } : {}))).toEqual(
          stableView(suggestions)
        );
        for (const suggestion of suggestions) {
          expect(['high', 'medium', 'low', 'weak']).toContain(confidenceLabel(suggestion.confidence));
        }
        return true;
      },
      { runs: 200 }
    );
  });

  it('is stable across input re-orderings — except the id (reported order-dependent-id bug)', () => {
    forAll(
      genRecord({ paths: genPaths, shuffleSeed: genInt({ min: 1, max: 9999 }) }),
      ({ paths, shuffleSeed }) => {
        if (paths.length < 2) return true;
        const reference = suggestChangelists(paths);
        // Deterministic Fisher-Yates from the harness Rng (no Math.random).
        const shuffled = shufflePaths(paths, shuffleSeed);
        const reordered = suggestChangelists(shuffled);
        // Name/members/confidence/description/order are re-ordering stable…
        expect(stableView(reordered)).toEqual(stableView(reference));
        // …but the id embeds the pre-sort first member, so shuffling the input
        // can change it. BUG (reported, source not modified): suggestion ids
        // are derived from unsorted members and break the documented
        // "stable across input re-orderings" contract for React keys.
        for (let i = 0; i < reference.length; i += 1) {
          const before = reference[i];
          const after = reordered[i];
          if (before && after) {
            if (before.id !== after.id) {
              expect(after.name).toBe(before.name);
              expect(after.members).toEqual(before.members);
            }
          }
        }
        return true;
      },
      { runs: 150 }
    );
  });

  it('fewer than two distinct paths produce no suggestions', () => {
    forAll(
      genRecord({ paths: genPaths }),
      ({ paths }) => {
        const distinct = new Set(paths.map((path) => path.trim().replace(/\\/g, '/')).filter(Boolean));
        if (distinct.size < 2) {
          expect(suggestChangelists(paths)).toEqual([]);
        }
        return true;
      },
      { runs: 150 }
    );
  });
});

/** Copy-shuffle with a seeded RNG (the lib under test must not see Math.random either). */
function shufflePaths(paths: readonly string[], seed: number): string[] {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const copy = [...paths];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as string, copy[i] as string];
  }
  return copy;
}
