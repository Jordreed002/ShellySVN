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

describe('SVN peg escaping — option-like and multi-target gaps', () => {
  it('leaves targets without "@" and explicit empty pegs untouched', () => {
    expect(escapeLocalPegTargets(['-file', '--force', 'plain-name', 'already@'])).toEqual([
      '-file',
      '--force',
      'plain-name',
      'already@',
    ]);
  });

  it('appends the empty peg to option-like filenames containing "@"', () => {
    expect(escapeLocalPegTargets(['-file@2x', '--force@1', 'pic@2.png'])).toEqual([
      '-file@2x@',
      '--force@1@',
      'pic@2.png@',
    ]);
    // Together with the option terminator both hazards are neutralized.
    expect(withSvnTargets(['add'], ['-file@2x'])).toEqual(['add', '--', '-file@2x@']);
  });

  it('keeps an intended explicit peg tail on URL targets', () => {
    expect(escapeLocalPegTargets(['https://example.test/trunk@42'])).toEqual([
      'https://example.test/trunk@42',
    ]);
    expect(escapeLocalPegTargets(['https://example.test/trunk@{2020-01-01}'])).toEqual([
      'https://example.test/trunk@{2020-01-01}',
    ]);
    // Local targets never carry an intended peg in this app (operative
    // revisions travel via -r), so keyword-looking suffixes are escaped.
    expect(escapeLocalPegTargets(['/wc/file@HEAD'])).toEqual(['/wc/file@HEAD@']);
  });

  it('escapes a numeric-looking filename that is not a valid peg tail', () => {
    expect(escapeLocalPegTargets(['rev@1.5.txt'])).toEqual(['rev@1.5.txt@']);
  });

  it('never throws on malformed URL-shaped targets', () => {
    // `new URL` rejects both; escaping must degrade to appending the empty peg.
    expect(escapeLocalPegTargets(['https://exa mple.test/a@b'])).toEqual([
      'https://exa mple.test/a@b@',
    ]);
    expect(escapeLocalPegTargets(['http://[::1/x@y'])).toEqual(['http://[::1/x@y@']);
  });

  it('escapes "@" inside URL query and fragment components', () => {
    expect(escapeLocalPegTargets(['https://example.test/repo?p=a@b'])).toEqual([
      'https://example.test/repo?p=a@b@',
    ]);
    expect(escapeLocalPegTargets(['https://example.test/repo#note@x'])).toEqual([
      'https://example.test/repo#note@x@',
    ]);
  });

  it('keeps URL targets whose "@" is confined to the authority component', () => {
    expect(
      escapeLocalPegTargets([
        'svn+ssh://user@example.test/repo/trunk',
        'https://user:secret@example.test/repo/trunk',
        'https://user@example.test',
        'file:///wc/plain.txt',
      ])
    ).toEqual([
      'svn+ssh://user@example.test/repo/trunk',
      'https://user:secret@example.test/repo/trunk',
      'https://user@example.test',
      'file:///wc/plain.txt',
    ]);
  });

  it('escapes URL targets mixing authority "@" with a later "@" in the path', () => {
    expect(escapeLocalPegTargets(['svn+ssh://user@example.test/repo/pic@2.png'])).toEqual([
      'svn+ssh://user@example.test/repo/pic@2.png@',
    ]);
  });

  it('keeps a lone "@" target as-is', () => {
    expect(escapeLocalPegTargets(['@'])).toEqual(['@']);
  });

  it('applies to every multi-target op shape via withSvnTargets', () => {
    // copy / move / delete / rename / add / changelist / patch all funnel
    // their positional targets through withSvnTargets.
    expect(withSvnTargets(['move'], ['/wc/-report@old.txt', '/wc/report@new.txt'])).toEqual([
      'move',
      '--',
      '/wc/-report@old.txt@',
      '/wc/report@new.txt@',
    ]);
    expect(withSvnTargets(['changelist', 'reviewed'], ['--force', 'a@1.txt', 'b.txt'])).toEqual([
      'changelist',
      'reviewed',
      '--',
      '--force',
      'a@1.txt@',
      'b.txt',
    ]);
    expect(withSvnTargets(['patch', '--dry-run'], ['/tmp/fix@1.patch', '/wc'])).toEqual([
      'patch',
      '--dry-run',
      '--',
      '/tmp/fix@1.patch@',
      '/wc',
    ]);
  });
});
