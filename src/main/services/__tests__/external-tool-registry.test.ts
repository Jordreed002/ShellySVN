import { describe, expect, it } from 'vitest';

import { validateExternalToolTemplate } from '../external-tool-template';

/**
 * External tool argument templates are substituted with file paths and then
 * passed to a spawned process, so they are a shell-injection surface.
 * `validateExternalToolTemplate` is the guard: it must reject shell metacharacters, env-var
 * assignment syntax, argument-file (@) syntax, unknown placeholders, and
 * degenerate sizes — while still permitting the legitimate flags real diff/
 * merge/editors need.
 */
describe('validateExternalToolTemplate', () => {
  it('accepts the canonical placeholder templates for each role', () => {
    expect(validateExternalToolTemplate(['editor'], ['{path}'])).toEqual(['{path}']);
    expect(validateExternalToolTemplate(['diff'], ['{left}', '{right}'])).toEqual([
      '{left}',
      '{right}',
    ]);
    expect(
      validateExternalToolTemplate(['merge'], ['{base}', '{mine}', '{theirs}', '{merged}'])
    ).toEqual(['{base}', '{mine}', '{theirs}', '{merged}']);
  });

  it('accepts literal flags alongside placeholders', () => {
    expect(validateExternalToolTemplate(['editor'], ['--wait', '--new-window', '{path}'])).toEqual([
      '--wait',
      '--new-window',
      '{path}',
    ]);
  });

  it('allows placeholders from any of the declared roles in a multi-role tool', () => {
    expect(validateExternalToolTemplate(['diff', 'merge'], ['{left}', '{theirs}'])).toEqual([
      '{left}',
      '{theirs}',
    ]);
  });

  it('rejects placeholders that belong to a different role', () => {
    expect(() => validateExternalToolTemplate(['editor'], ['{left}'])).toThrow(
      'Unsupported placeholder {left}'
    );
    expect(() => validateExternalToolTemplate(['diff'], ['{path}'])).toThrow(
      'Unsupported placeholder {path}'
    );
  });

  it('rejects shell metacharacters in any token', () => {
    for (const evil of ['a;b', 'a`b', 'a$b', 'a&b', 'a|b', 'a<b', 'a>b', 'a\nb', 'a\rb']) {
      expect(() => validateExternalToolTemplate(['editor'], [evil])).toThrow(
        'Shell syntax is not allowed in external tool arguments'
      );
    }
  });

  it('rejects environment-variable assignment syntax', () => {
    expect(() => validateExternalToolTemplate(['editor'], ['FOO=bar', '{path}'])).toThrow(
      'Shell syntax is not allowed in external tool arguments'
    );
    expect(() => validateExternalToolTemplate(['editor'], ['_VAR=1', '{path}'])).toThrow(
      'Shell syntax is not allowed in external tool arguments'
    );
  });

  it('rejects argument-file (@) prefix syntax', () => {
    expect(() => validateExternalToolTemplate(['editor'], ['@response-file', '{path}'])).toThrow(
      'Shell syntax is not allowed in external tool arguments'
    );
  });

  it('rejects empty or oversized token arrays', () => {
    expect(() => validateExternalToolTemplate(['editor'], [])).toThrow(
      'Invalid external tool argument template'
    );
    expect(() => validateExternalToolTemplate(['editor'], 'nope')).toThrow(
      'Invalid external tool argument template'
    );
    expect(() => validateExternalToolTemplate(['editor'], Array(65).fill('{path}'))).toThrow(
      'Invalid external tool argument template'
    );
  });

  it('rejects empty or oversized individual tokens', () => {
    expect(() => validateExternalToolTemplate(['editor'], [''])).toThrow(
      'Invalid external tool argument'
    );
    expect(() => validateExternalToolTemplate(['editor'], ['{path}', 'X'.repeat(1025)])).toThrow(
      'Invalid external tool argument'
    );
  });
});
