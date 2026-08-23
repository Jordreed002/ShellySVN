import { describe, expect, it } from 'vitest';
import {
  confidenceLabel,
  suggestChangelists,
  type ChangelistSuggestion,
} from '../changelistSuggestions';

function byName(suggestions: ChangelistSuggestion[]): Map<string, ChangelistSuggestion> {
  return new Map(suggestions.map((suggestion) => [suggestion.name, suggestion]));
}

/** All call sites pass the working-copy root so names are root-relative. */
const ROOT = '/wc';

function suggest(paths: string[]): ChangelistSuggestion[] {
  return suggestChangelists(paths, { rootPath: ROOT });
}

describe('suggestChangelists', () => {
  it('returns no suggestions for empty or single-file input', () => {
    expect(suggest([])).toEqual([]);
    expect(suggest(['/wc/only.ts'])).toEqual([]);
  });

  it('deduplicates identical paths before grouping', () => {
    const suggestions = suggest(['/wc/a.ts', '/wc/a.ts', '/wc/b.ts']);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].members).toEqual(['/wc/a.ts', '/wc/b.ts']);
  });

  it('groups files that share a directory as a high-confidence suggestion named after it', () => {
    const suggestions = byName(
      suggest(['/wc/src/core/a.ts', '/wc/src/core/b.ts', '/wc/src/main/c.ts'])
    );
    const core = suggestions.get('src: core');
    expect(core).toBeDefined();
    expect(core?.reason).toBe('same-directory');
    expect(core?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(core?.members).toEqual(['/wc/src/core/a.ts', '/wc/src/core/b.ts']);
    // A lone file in its own directory is not worth a changelist of its own.
    expect(suggestions.has('src: main')).toBe(false);
  });

  it('separates tests, docs and config from source files', () => {
    const suggestions = byName(
      suggest([
        '/wc/src/app.ts',
        '/wc/src/lib.ts',
        '/wc/src/app.test.ts',
        '/wc/README.md',
        '/wc/package.json',
      ])
    );
    expect(suggestions.get('tests')?.members).toEqual(['/wc/src/app.test.ts']);
    expect(suggestions.get('docs')?.members).toEqual(['/wc/README.md']);
    expect(suggestions.get('config')?.members).toEqual(['/wc/package.json']);
    // Remaining source files still cluster by directory.
    expect(suggestions.get('src')?.members).toEqual(['/wc/src/app.ts', '/wc/src/lib.ts']);
  });

  it('recognizes test directories and varied test naming conventions', () => {
    const suggestions = suggest([
      '/wc/tests/helper.ts',
      '/wc/__tests__/unit.pony', // not a test basename, but inside __tests__
      '/wc/payment_test.go',
      '/wc/src/thing.ts',
    ]);
    const tests = suggestions.find((suggestion) => suggestion.name === 'tests');
    expect(tests?.members).toEqual([
      '/wc/__tests__/unit.pony',
      '/wc/payment_test.go',
      '/wc/tests/helper.ts',
    ]);
  });

  it('falls back to a common-prefix cluster when files sit in sibling directories', () => {
    const suggestions = suggest([
      '/wc/src/alpha/a.ts',
      '/wc/src/beta/b.ts',
      '/wc/docs/guide.md',
    ]);
    const prefix = suggestions.find((suggestion) => suggestion.name === 'src');
    expect(prefix?.reason).toBe('common-prefix');
    expect(prefix?.confidence).toBeLessThan(0.9);
    expect(prefix?.members).toEqual(['/wc/src/alpha/a.ts', '/wc/src/beta/b.ts']);
  });

  it('clusters deeply nested siblings with lower confidence than exact directories', () => {
    const exact = suggest(['/wc/src/a.ts', '/wc/src/b.ts'])[0];
    const nested = suggest([
      '/wc/src/one/deep/a.ts',
      '/wc/src/two/deep/b.ts',
    ])[0];
    expect(exact.reason).toBe('same-directory');
    expect(nested.reason).toBe('common-prefix');
    expect(nested.confidence).toBeLessThan(exact.confidence);
  });

  it('treats Windows separators like POSIX ones', () => {
    const suggestions = byName(
      suggest(['C:\\repo\\src\\core\\a.ts', 'C:/repo/src/core/b.ts'])
    );
    expect(suggestions.get('src: core')?.members).toEqual([
      'C:/repo/src/core/a.ts',
      'C:/repo/src/core/b.ts',
    ]);
  });

  it('buckets root-level files without a directory sensibly', () => {
    const suggestions = byName(suggest(['/wc/a.ts', '/wc/b.ts']));
    expect(suggestions.get('root')?.members).toEqual(['/wc/a.ts', '/wc/b.ts']);
  });

  it('merges stragglers by common prefix and leaves lone strays unsuggested', () => {
    const suggestions = byName(
      suggest([
        '/wc/src/core/a.ts',
        '/wc/src/core/b.ts',
        '/wc/loose/x.ts',
        '/wc/other/y.ts',
        '/wc/src/lonely/deep/z.ts',
      ])
    );
    // The two siblings merge on their shared parent directory…
    const root = suggestions.get('root');
    expect(root?.members).toEqual(['/wc/loose/x.ts', '/wc/other/y.ts']);
    expect(root?.reason).toBe('common-prefix');
    expect(root?.confidence).toBeLessThan(0.9);
    // …while a file whose nearest shared ancestor would be the working-copy
    // root itself produces no suggestion (merging is capped at grandparent).
    const allMembers = new Set(
      Array.from(suggestions.values()).flatMap((suggestion) => suggestion.members)
    );
    expect(allMembers.has('/wc/src/lonely/deep/z.ts')).toBe(false);
  });

  it('sorts suggestions by confidence then member count', () => {
    const suggestions = suggest([
      '/wc/src/core/a.ts',
      '/wc/src/core/b.ts',
      '/wc/src/core/c.ts',
      '/wc/notes/x.md',
      '/wc/notes/y.md',
      '/wc/z.md',
    ]);
    const first = suggestions[0];
    expect(first.name).toBe('src: core');
    for (const suggestion of suggestions.slice(1)) {
      const lowerRank =
        suggestion.confidence < first.confidence ||
        (suggestion.confidence === first.confidence &&
          suggestion.members.length < first.members.length);
      expect(lowerRank).toBe(true);
    }
  });

  it('never invents members outside the input set', () => {
    const input = ['/wc/src/a.ts', '/wc/src/b.ts', '/wc/src/tests/a.test.ts'];
    const suggestions = suggest(input);
    const suggested = new Set(suggestions.flatMap((suggestion) => suggestion.members));
    expect(suggested.size).toBe(input.length);
    for (const path of input) expect(suggested.has(path)).toBe(true);
  });
});

describe('confidenceLabel', () => {
  it('maps confidence ranges to labels', () => {
    expect(confidenceLabel(0.9)).toBe('high');
    expect(confidenceLabel(0.75)).toBe('medium');
    expect(confidenceLabel(0.5)).toBe('low');
    expect(confidenceLabel(0.3)).toBe('weak');
  });
});
