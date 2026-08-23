import { describe, expect, it } from 'vitest';
import {
  isValidSvnRevision,
  normalizeSvnChangeItem,
  normalizeSvnChangeList,
  normalizeSvnRevision,
  normalizeSvnRevisionNumber,
  SvnRevisionError,
} from '../svn-revision';

describe('isValidSvnRevision', () => {
  it('accepts numbers, keywords and date specs', () => {
    for (const value of ['0', '42', '007', 'HEAD', 'head', 'BASE', 'COMMITTED', 'PREV',
      '{2020-01-01}', '{2026-08-23T10:00:00.000Z}']) {
      expect(isValidSvnRevision(value)).toBe(true);
    }
  });

  it('rejects everything a Number() coercion would silently accept', () => {
    for (const value of ['１２３', '١٢٣', '1.5', '1e3', '0x10', '+5', '-1', ' 42', '4 2',
      '4\n2', '', 'HEAD2', '{}', '{a{b}', '{' + 'x'.repeat(65) + '}', '1'.repeat(16)]) {
      expect(isValidSvnRevision(value)).toBe(false);
    }
  });
});

describe('normalizeSvnRevision', () => {
  it('returns undefined for absent revisions', () => {
    expect(normalizeSvnRevision(undefined)).toBeUndefined();
    expect(normalizeSvnRevision(null)).toBeUndefined();
    expect(normalizeSvnRevision('')).toBeUndefined();
    expect(normalizeSvnRevision('   ')).toBeUndefined();
  });

  it('canonicalizes numbers, keywords and dates', () => {
    expect(normalizeSvnRevision(0)).toBe('0');
    expect(normalizeSvnRevision(123456789012345)).toBe('123456789012345');
    expect(normalizeSvnRevision('42')).toBe('42');
    expect(normalizeSvnRevision(' head ')).toBe('HEAD');
    expect(normalizeSvnRevision('{2020-01-01}')).toBe('{2020-01-01}');
  });

  it('rejects unsafe or negative numbers and non-numeric strings', () => {
    for (const value of [-1, 1.5, NaN, Infinity, true, {}, '１２３', '1e3', '-1', '4 2', '12.5']) {
      expect(() => normalizeSvnRevision(value, 'switch revision')).toThrow(SvnRevisionError);
    }
    expect(() => normalizeSvnRevision('12.5', 'switch revision')).toThrow(
      /switch revision .* is not a valid SVN revision/
    );
  });
});

describe('normalizeSvnRevisionNumber', () => {
  it('passes through safe non-negative integers and vetted numeric strings', () => {
    expect(normalizeSvnRevisionNumber(7)).toBe(7);
    expect(normalizeSvnRevisionNumber(undefined)).toBeUndefined();
    expect(normalizeSvnRevisionNumber(' 42 ')).toBe(42);
    expect(normalizeSvnRevisionNumber('0')).toBe(0);
  });

  it('refuses coercible-but-invalid and non-numeric input', () => {
    for (const value of ['１２３', '1e3', '0x10', '-3', '4.5', 'HEAD', true, '', '  ']) {
      expect(() => normalizeSvnRevisionNumber(value, 'startRevision')).toThrow(
        SvnRevisionError
      );
    }
  });
});

describe('normalizeSvnChangeItem', () => {
  it('accepts single revisions, reversed revisions and ranges', () => {
    expect(normalizeSvnChangeItem(5)).toBe('5');
    expect(normalizeSvnChangeItem('-123')).toBe('-123');
    expect(normalizeSvnChangeItem(-7)).toBe('-7');
    expect(normalizeSvnChangeItem('42:95')).toBe('42:95');
    expect(normalizeSvnChangeItem('HEAD:42')).toBe('HEAD:42');
    expect(normalizeSvnChangeItem('head')).toBe('HEAD');
    expect(normalizeSvnChangeItem('{2020-01-01T10:00:00}')).toBe('{2020-01-01T10:00:00}');
  });

  it('rejects malformed change expressions', () => {
    for (const value of ['-HEAD', '-{2020-01-01}', '1:', ':2', '1:2:3', 'a:b', '1..2', '', '-']) {
      expect(() => normalizeSvnChangeItem(value, 'merge change')).toThrow(SvnRevisionError);
    }
  });
});

describe('normalizeSvnChangeList', () => {
  it('validates every element and keeps absence as undefined', () => {
    expect(normalizeSvnChangeList(undefined)).toBeUndefined();
    expect(normalizeSvnChangeList(null)).toBeUndefined();
    expect(normalizeSvnChangeList([5, '-9', '40:44'])).toEqual(['5', '-9', '40:44']);
  });

  it('reports the offending index for invalid elements', () => {
    expect(() => normalizeSvnChangeList([5, 'oops'], 'revisions')).toThrow(/revisions\[1\]/);
    expect(() => normalizeSvnChangeList('42', 'revisions')).toThrow(/must be an array/);
  });
});
