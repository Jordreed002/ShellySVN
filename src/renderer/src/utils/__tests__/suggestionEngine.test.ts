import { describe, expect, it } from 'vitest';

import type { SvnStatusChar } from '@shared/types';

import {
  analyzeFile,
  analyzeFiles,
  getAutocompleteSuggestions,
  getTemplatesWithRecommendations,
  parseCommitType,
  validateCommitMessage,
} from '../suggestionEngine';

/**
 * J4 — Daily edit & commit loop.
 * The suggestion engine inspects the files in a commit and proposes a
 * conventional-commit type, template, and message description. These tests pin
 * the classification heuristics so a refactor doesn't quietly change which
 * prefix a "docs only" or "test only" change recommends.
 */
describe('suggestionEngine — analyzeFile', () => {
  it('reports the file extension, including compound extensions', () => {
    expect(analyzeFile('a.ts', 'M').extension).toBe('ts');
    expect(analyzeFile('foo.test.js', 'A').extension).toBe('test.js');
    expect(analyzeFile('bar.d.ts', 'M').extension).toBe('d.ts');
    expect(analyzeFile('noext', '?').extension).toBe('');
  });

  it('sets isNew/isDeleted/isModified from the status char', () => {
    expect(analyzeFile('a.ts', 'A')).toMatchObject({ isNew: true, isModified: false });
    expect(analyzeFile('a.ts', '?')).toMatchObject({ isNew: true });
    expect(analyzeFile('a.ts', 'D')).toMatchObject({ isDeleted: true });
    expect(analyzeFile('a.ts', 'M')).toMatchObject({ isModified: true });
    expect(analyzeFile('a.ts', 'R')).toMatchObject({ isModified: true });
  });

  it('infers change type from path patterns over category hints', () => {
    // A file under tests/ is a "test" regardless of language.
    expect(analyzeFile('src/utils/foo.test.ts', 'M').changeType).toBe('test');
    expect(analyzeFile('tests/helper.spec.ts', 'M').changeType).toBe('test');
    expect(analyzeFile('docs/readme.md', 'M').changeType).toBe('docs');
    expect(analyzeFile('src/styles/main.css', 'M').changeType).toBe('style');
    expect(analyzeFile('scripts/build.sh', 'M').changeType).toBe('chore');
  });

  it('falls back to the category hint when no path pattern matches', () => {
    // A plain typescript change with no test/docs/style path → feature.
    expect(analyzeFile('src/app.ts', 'M').changeType).toBe('feature');
    // Markdown not under docs/ still maps to docs.
    expect(analyzeFile('README.md', 'M').changeType).toBe('docs');
    // JSON config → chore.
    expect(analyzeFile('package.json', 'M').changeType).toBe('chore');
  });
});

describe('suggestionEngine — analyzeFiles', () => {
  it('ranks suggestions by confidence (dominant type first)', () => {
    const { suggestions } = analyzeFiles([
      { path: 'src/a.ts', status: 'M' as SvnStatusChar },
      { path: 'src/b.ts', status: 'M' as SvnStatusChar },
      { path: 'README.md', status: 'M' as SvnStatusChar },
    ]);

    expect(suggestions[0].type).toBe('feature');
    expect(suggestions[0].confidence).toBeCloseTo(2 / 3, 5);
    expect(suggestions[1].type).toBe('docs');
  });

  it('recommends the dominant template with a reason', () => {
    const { recommendedTemplate } = analyzeFiles([
      { path: 'src/a.ts', status: 'M' as SvnStatusChar },
      { path: 'src/b.ts', status: 'M' as SvnStatusChar },
    ]);

    expect(recommendedTemplate.id).toBe('feature');
    expect(recommendedTemplate.confidence).toBe(1);
    expect(recommendedTemplate.reason).toContain('2');
  });

  it('handles an empty file list without throwing', () => {
    const { analyses, suggestions, recommendedTemplate } = analyzeFiles([]);
    expect(analyses).toEqual([]);
    expect(suggestions).toEqual([]);
    expect(recommendedTemplate.id).toBe('chore');
    expect(recommendedTemplate.confidence).toBe(0);
  });

  it('describes a single new file as "add <name>"', () => {
    const { suggestions } = analyzeFiles([{ path: 'src/new.ts', status: 'A' as SvnStatusChar }]);
    expect(suggestions[0].description).toBe('add new.ts');
  });

  it('describes multiple changes with add/remove/modify counts', () => {
    const { suggestions } = analyzeFiles([
      { path: 'a.ts', status: 'A' as SvnStatusChar },
      { path: 'b.ts', status: 'D' as SvnStatusChar },
      { path: 'c.ts', status: 'M' as SvnStatusChar },
    ]);
    // Dominant type ties resolve by map insertion order; just assert structure.
    const desc = suggestions[0].description;
    expect(desc).toMatch(/add 1 file/);
    expect(desc).toMatch(/remove 1 file/);
    expect(desc).toMatch(/modify 1 file/);
  });
});

describe('suggestionEngine — getTemplatesWithRecommendations', () => {
  it('lists the recommended template first, then the rest with zero confidence', () => {
    const recs = getTemplatesWithRecommendations([
      { path: 'src/a.ts', status: 'M' as SvnStatusChar },
    ]);

    expect(recs[0].id).toBe('feature');
    expect(recs[0].confidence).toBe(1);
    expect(recs.slice(1).every((r) => r.confidence === 0)).toBe(true);
    // All eight conventional types are represented.
    expect(recs).toHaveLength(8);
  });
});

describe('suggestionEngine — getAutocompleteSuggestions', () => {
  it('suggests the conventional prefixes when the input is empty', () => {
    const out = getAutocompleteSuggestions('', [], []);
    expect(out).toContain('feat: ');
    expect(out).toContain('fix: ');
    expect(out).toHaveLength(8);
  });

  it('completes the description once a prefix is typed', () => {
    const out = getAutocompleteSuggestions(
      'feat: a',
      [{ path: 'src/app.ts', status: 'A' as SvnStatusChar }],
      []
    );
    expect(out).toContain('feat: add app.ts');
  });

  it('matches commit history substrings case-insensitively', () => {
    const out = getAutocompleteSuggestions(
      'checkout',
      [],
      ['fix: checkout flow', 'feat: login', 'docs: checkout guide']
    );
    expect(out).toEqual(expect.arrayContaining(['fix: checkout flow', 'docs: checkout guide']));
  });

  it('limits to ten suggestions', () => {
    const history = Array.from({ length: 20 }, (_, i) => `msg-${i}`);
    const out = getAutocompleteSuggestions('msg', [], history);
    expect(out.length).toBeLessThanOrEqual(10);
  });
});

describe('suggestionEngine — parseCommitType', () => {
  it('parses conventional-commit prefixes case-insensitively from the first line', () => {
    expect(parseCommitType('feat: add login')).toBe('feature');
    expect(parseCommitType('FIX: crash')).toBe('bugfix');
    expect(parseCommitType('feat: title\n\nbody line')).toBe('feature');
  });

  it('returns null for messages without a recognized prefix', () => {
    expect(parseCommitType('just a normal message')).toBeNull();
    expect(parseCommitType('')).toBeNull();
  });
});

describe('suggestionEngine — validateCommitMessage', () => {
  it('rejects an empty message', () => {
    const result = validateCommitMessage('   ');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Commit message cannot be empty');
  });

  it('warns about very short messages', () => {
    const { warnings } = validateCommitMessage('short');
    expect(warnings).toContain('Commit message is very short');
  });

  it('warns when the first line exceeds 72 characters', () => {
    const long = 'feat: ' + 'a'.repeat(80);
    expect(validateCommitMessage(long).warnings).toContain(
      'First line of commit message exceeds 72 characters'
    );
  });

  it('does not treat a long body as an overlong first line', () => {
    const message = `feat: add icons\n\n${'body text '.repeat(20)}`;
    expect(validateCommitMessage(message).warnings).not.toContain(
      'First line of commit message exceeds 72 characters'
    );
  });

  it('warns when the message lacks a conventional prefix', () => {
    const { warnings } = validateCommitMessage('updated the checkout flow with new logic');
    expect(warnings).toContain(
      'Message does not follow conventional commit format (e.g., "feat:", "fix:")'
    );
  });

  it('passes a well-formed conventional message with no warnings', () => {
    const result = validateCommitMessage('feat: add sparse checkout picker');
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
