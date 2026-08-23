import { describe, expect, it } from 'vitest';

import {
  describePropertyResolution,
  findConflictedPropertyNames,
  parsePrejPropertyNames,
  planPropertyApply,
  resolvePropertySides,
  suggestMergedValue,
  valueForChoice,
} from '../propertyConflictModel';

describe('parsePrejPropertyNames', () => {
  it('extracts quoted svn: property names from reject files', () => {
    const content = [
      "Conflict for property 'svn:eol-style' detected.",
      "Conflict for property 'svn:mergeinfo' detected.",
    ].join('\n');
    expect([...parsePrejPropertyNames(content)].toSorted()).toEqual(['svn:eol-style', 'svn:mergeinfo']);
  });

  it('picks up bare colon headers too', () => {
    expect(parsePrejPropertyNames('svn:ignore\n')).toEqual(['svn:ignore']);
  });

  it('ignores quoted text that is not a property name', () => {
    expect(parsePrejPropertyNames("some 'free text' here")).toEqual([]);
  });
});

describe('findConflictedPropertyNames', () => {
  it('flags differing and one-sided properties', () => {
    const working = { 'svn:eol-style': 'native', 'svn:ignore': 'build', 'svn:mime-type': 'text/plain' };
    const base = { 'svn:eol-style': 'LF', 'svn:keywords': 'Id', 'svn:mime-type': 'text/plain' };
    expect(findConflictedPropertyNames(working, base)).toEqual([
      'svn:eol-style',
      'svn:ignore',
      'svn:keywords',
    ]);
  });

  it('returns nothing when both sides agree', () => {
    expect(findConflictedPropertyNames({ a: '1' }, { a: '1' })).toEqual([]);
  });
});

describe('resolvePropertySides / valueForChoice', () => {
  const sides = resolvePropertySides('svn:eol-style', {
    base: 'LF',
    mine: 'native',
    theirs: 'CRLF',
    theirsSource: 'artifact',
  });

  it('keeps all three values and the source label', () => {
    expect(sides).toMatchObject({
      name: 'svn:eol-style',
      base: 'LF',
      mine: 'native',
      theirs: 'CRLF',
      theirsSource: 'artifact',
    });
  });

  it('defaults to unavailable when theirs is unknown', () => {
    expect(resolvePropertySides('p', { base: '', mine: 'x' }).theirsSource).toBe('unavailable');
  });

  it('maps choices onto values with empty-string fallbacks', () => {
    expect(valueForChoice(sides, 'mine')).toBe('native');
    expect(valueForChoice(sides, 'theirs')).toBe('CRLF');
    expect(valueForChoice(sides, 'base')).toBe('LF');
    expect(valueForChoice(sides, 'custom')).toBe('');
  });
});

describe('planPropertyApply', () => {
  it('sets non-empty values and deletes empty ones', () => {
    expect(planPropertyApply({ name: 'svn:ignore', choice: 'custom', value: 'dist' })).toEqual({
      action: 'set',
      value: 'dist',
    });
    expect(planPropertyApply({ name: 'svn:ignore', choice: 'mine', value: '' })).toEqual({
      action: 'del',
      value: '',
    });
  });
});

describe('describePropertyResolution', () => {
  it('states each choice in plain language', () => {
    expect(describePropertyResolution({ name: 'svn:eol-style', choice: 'mine', value: 'native' })).toBe(
      'svn:eol-style: keep your value'
    );
    expect(describePropertyResolution({ name: 'svn:eol-style', choice: 'theirs', value: 'CRLF' })).toBe(
      'svn:eol-style: take the incoming value'
    );
    expect(describePropertyResolution({ name: 'p', choice: 'base', value: 'LF' })).toBe('p: restore the BASE value');
    expect(describePropertyResolution({ name: 'p', choice: 'custom', value: 'merged' })).toBe(
      'p: apply the merged value'
    );
    expect(describePropertyResolution({ name: 'p', choice: 'custom', value: '' })).toBe(
      'p: remove the property'
    );
  });
});

describe('suggestMergedValue', () => {
  it('starts from your value when you changed it', () => {
    expect(
      suggestMergedValue(resolvePropertySides('p', { base: 'b', mine: 'mine', theirs: 'theirs' }))
    ).toBe('mine');
  });

  it('starts from theirs when only the incoming side changed', () => {
    expect(suggestMergedValue(resolvePropertySides('p', { base: 'b', mine: undefined, theirs: 't' }))).toBe('t');
  });

  it('falls back to base when nothing else exists', () => {
    expect(suggestMergedValue(resolvePropertySides('p', { base: 'b' }))).toBe('b');
  });
});
