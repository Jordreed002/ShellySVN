import { describe, expect, it } from 'vitest';
import { escapeLocalPegTargets, validateSvnTargets, withSvnTargets } from '../svn-targets';

describe('SVN target validation', () => {
  it('rejects empty and control-character targets', () => {
    expect(() => validateSvnTargets([])).toThrow('At least one');
    expect(() => validateSvnTargets(['--force'])).not.toThrow();
    expect(() => validateSvnTargets(['/wc/bad\nname'])).toThrow('control characters');
  });

  it('places targets after an option terminator', () => {
    expect(withSvnTargets(['add', '--parents'], ['--force', 'name@host'])).toEqual([
      'add',
      '--parents',
      '--',
      '--force',
      'name@host@',
    ]);
  });

  it('escapes local peg-revision markers without changing ordinary paths', () => {
    expect(
      escapeLocalPegTargets([
        '/wc/user@host.txt',
        '/wc/plain.txt',
        'svn+ssh://user@example.test/repo/trunk',
        'https://example.test/repo/file@name',
        'https://example.test/repo/trunk@42',
      ])
    ).toEqual([
      '/wc/user@host.txt@',
      '/wc/plain.txt',
      'svn+ssh://user@example.test/repo/trunk',
      'https://example.test/repo/file@name@',
      'https://example.test/repo/trunk@42',
    ]);
  });
});
