import { describe, expect, it } from 'vitest';
import {
  computeEffectiveIgnore,
  formatIgnorePatterns,
  lintIgnorePatterns,
  matchesIgnorePattern,
  matchUnversionedEntries,
  parseIgnorePatterns,
  parentDirectoryOf,
} from '../svnIgnorePatterns';

describe('parseIgnorePatterns / formatIgnorePatterns', () => {
  it('splits on every line-ending flavor and drops blanks', () => {
    expect(parseIgnorePatterns('*.log\r\n\r\nnode_modules\n\t \tdist\r')).toEqual([
      '*.log',
      'node_modules',
      'dist',
    ]);
    expect(parseIgnorePatterns(undefined)).toEqual([]);
    expect(parseIgnorePatterns('')).toEqual([]);
  });

  it('round-trips through format', () => {
    expect(formatIgnorePatterns(parseIgnorePatterns('a\nb\n\n c '))).toBe('a\nb\nc');
  });
});

describe('matchesIgnorePattern (APR fnmatch + FNM_PERIOD semantics)', () => {
  it('matches literal names case-sensitively', () => {
    expect(matchesIgnorePattern('build', 'build')).toBe(true);
    expect(matchesIgnorePattern('Build', 'build')).toBe(false);
    expect(matchesIgnorePattern('BUILD', 'build')).toBe(false);
  });

  it('supports * and ? globs', () => {
    expect(matchesIgnorePattern('debug.log', '*.log')).toBe(true);
    expect(matchesIgnorePattern('debug.logs', '*.log')).toBe(false);
    expect(matchesIgnorePattern('a.ts', '?.ts')).toBe(true);
    expect(matchesIgnorePattern('ab.ts', '?.ts')).toBe(false);
  });

  it('does not let globs swallow a leading period (FNM_PERIOD)', () => {
    expect(matchesIgnorePattern('.DS_Store', '*')).toBe(false);
    expect(matchesIgnorePattern('.DS_Store', '*.DS_Store')).toBe(false);
    expect(matchesIgnorePattern('.DS_Store', '.DS*')).toBe(true);
    expect(matchesIgnorePattern('.env', '.env')).toBe(true);
    // A literal dot in the pattern still matches, and * after it works.
    expect(matchesIgnorePattern('.env.local', '.env*')).toBe(true);
    expect(matchesIgnorePattern('plain', '*')).toBe(true);
  });

  it('supports character classes, negation and ranges', () => {
    expect(matchesIgnorePattern('temp', '[Tt]emp')).toBe(true);
    expect(matchesIgnorePattern('Temp', '[Tt]emp')).toBe(true);
    expect(matchesIgnorePattern('a.log', '[a-c].log')).toBe(true);
    expect(matchesIgnorePattern('z.log', '[a-c].log')).toBe(false);
    expect(matchesIgnorePattern('a', '[!a]')).toBe(false);
    expect(matchesIgnorePattern('b', '[!a]')).toBe(true);
  });

  it('supports backslash escapes', () => {
    expect(matchesIgnorePattern('a*b', 'a\\*b')).toBe(true);
    expect(matchesIgnorePattern('axb', 'a\\*b')).toBe(false);
  });

  it('never matches a name through a separator', () => {
    // svn:ignore matches names; a nested path never reaches the matcher,
    // but a pattern with a separator must not match a name either.
    expect(matchesIgnorePattern('build', 'build/')).toBe(false);
    expect(matchesIgnorePattern('build', 'target/dist')).toBe(false);
  });
});

describe('lintIgnorePatterns', () => {
  const codes = (patterns: string[]) =>
    lintIgnorePatterns(patterns).map((issue) => `${issue.code}:${issue.line}`);

  it('flags exact duplicates as errors with the earlier line', () => {
    const issues = lintIgnorePatterns(['*.log', 'dist', '*.log']);
    const duplicate = issues.find((issue) => issue.code === 'duplicate');
    expect(duplicate).toMatchObject({ severity: 'error', line: 3, pattern: '*.log' });
    expect(duplicate?.message).toContain('line 1');
  });

  it('notes case variants because matching is case-sensitive everywhere', () => {
    const issues = lintIgnorePatterns(['build', 'Build']);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'case-variant', severity: 'info', line: 2 })
    );
    expect(issues.find((issue) => issue.code === 'case-variant')?.message).toMatch(
      /case-sensitive/i
    );
  });

  it('errors on path separators and suggests the bare name fix', () => {
    const issues = lintIgnorePatterns(['target/dist']);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'path-separator', severity: 'error', fix: 'dist' })
    );
  });

  it('warns on git-style trailing slashes and negation', () => {
    expect(lintIgnorePatterns(['build/'])).toContainEqual(
      expect.objectContaining({ code: 'trailing-slash', severity: 'warning', fix: 'build' })
    );
    expect(lintIgnorePatterns(['!keep'])).toContainEqual(
      expect.objectContaining({ code: 'negation', severity: 'warning' })
    );
  });

  it('warns on globstar and fixes it to a single star', () => {
    expect(lintIgnorePatterns(['**/cache'])).toContainEqual(
      expect.objectContaining({ code: 'globstar', severity: 'warning' })
    );
    expect(lintIgnorePatterns(['logs/**'])).toContainEqual(
      expect.objectContaining({ code: 'globstar', fix: 'logs/*' })
    );
  });

  it('flags redundant literal patterns already covered by an earlier glob', () => {
    const issues = lintIgnorePatterns(['*.log', 'debug.log']);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'redundant', severity: 'warning', line: 2 })
    );
  });

  it('flags unterminated character classes and lone backslashes', () => {
    expect(lintIgnorePatterns(['[ab'])).toContainEqual(
      expect.objectContaining({ code: 'unterminated-class', severity: 'error' })
    );
    expect(lintIgnorePatterns(['a\\'])).toContainEqual(
      expect.objectContaining({ code: 'bad-escape', severity: 'warning' })
    );
  });

  it('keeps a clean list clean', () => {
    expect(lintIgnorePatterns(['*.log', '.DS_Store', 'node_modules', '[Bb]uild'])).toEqual([]);
  });

  it('lints line numbers correctly after whitespace variants', () => {
    expect(codes([' ok ', '', 'ok2'])).toEqual([]);
  });
});

describe('matchUnversionedEntries (live-preview model)', () => {
  const candidates = [
    { name: 'debug.log', isDirectory: false },
    { name: 'node_modules', isDirectory: true },
    { name: 'notes.txt', isDirectory: false },
    { name: '.DS_Store', isDirectory: false },
  ];

  it('splits candidates into matched (with pattern) and unmatched', () => {
    const { matched, unmatched } = matchUnversionedEntries(
      ['*.log', 'node_modules'],
      candidates
    );
    expect(matched).toEqual([
      { name: 'debug.log', isDirectory: false, matchedBy: '*.log' },
      { name: 'node_modules', isDirectory: true, matchedBy: 'node_modules' },
    ]);
    expect(unmatched).toEqual([
      { name: 'notes.txt', isDirectory: false },
      { name: '.DS_Store', isDirectory: false },
    ]);
  });
});

describe('computeEffectiveIgnore', () => {
  it('unions explicit svn:ignore with the nearest svn:global-ignores', () => {
    const result = computeEffectiveIgnore({
      explicitIgnore: '*.log',
      inheritedGlobalIgnores: 'node_modules\n.DS_Store',
      inheritedGlobalFrom: '/repo/trunk',
    });
    expect(result.effective).toEqual(['*.log', 'node_modules', '.DS_Store']);
    expect(result.effectiveGlobal).toEqual({
      patterns: ['node_modules', '.DS_Store'],
      source: 'inherited',
      from: '/repo/trunk',
    });
  });

  it('an explicit svn:global-ignores replaces the inherited value (no merging)', () => {
    const result = computeEffectiveIgnore({
      explicitGlobalIgnores: 'dist',
      inheritedGlobalIgnores: 'node_modules',
    });
    expect(result.effectiveGlobal).toEqual({ patterns: ['dist'], source: 'explicit' });
    expect(result.effective).toEqual(['dist']);
  });

  it('inherited svn:ignore contributes nothing — only global-ignores propagates', () => {
    const result = computeEffectiveIgnore({ explicitIgnore: 'a', inheritedGlobalIgnores: null });
    expect(result.effective).toEqual(['a']);
    expect(result.effectiveGlobal.source).toBe('none');
  });
});

describe('parentDirectoryOf', () => {
  it('handles posix, windows and root cases', () => {
    expect(parentDirectoryOf('/repo/trunk/file.txt')).toBe('/repo/trunk');
    expect(parentDirectoryOf('C:\\repo\\file.txt')).toBe('C:\\repo');
    expect(parentDirectoryOf('/file.txt')).toBe('/');
    expect(parentDirectoryOf('file.txt')).toBe('.');
    expect(parentDirectoryOf('/repo/dir/')).toBe('/repo');
  });
});
