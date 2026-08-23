import { describe, expect, it } from 'vitest';
import {
  defaultKeywordSample,
  expandKeywordAnchor,
  expandKeywordsInText,
  formatKeywordsValue,
  isKnownKeyword,
  isTextLikeFile,
  lintKeywordTokens,
  parseKeywordsValue,
} from '../svnKeywords';

const sample = defaultKeywordSample();

describe('parseKeywordsValue / formatKeywordsValue', () => {
  it('splits on spaces, tabs, newlines and commas', () => {
    expect(parseKeywordsValue('Rev Date\tAuthor, Id\n HeadURL')).toEqual([
      'Rev',
      'Date',
      'Author',
      'Id',
      'HeadURL',
    ]);
    expect(parseKeywordsValue(null)).toEqual([]);
    expect(formatKeywordsValue(['Rev', 'Date'])).toBe('Rev Date');
  });
});

describe('keyword lookup', () => {
  it('knows the built-ins and their aliases', () => {
    expect(isKnownKeyword('Rev')).toBe(true);
    expect(isKnownKeyword('Revision')).toBe(true);
    expect(isKnownKeyword('LastChangedDate')).toBe(true);
    expect(isKnownKeyword('MadeUp')).toBe(false);
  });
});

describe('lintKeywordTokens', () => {
  it('warns about unknown bare tokens', () => {
    const issues = lintKeywordTokens(['Rev', 'Frobnicate']);
    expect(issues).toEqual([
      expect.objectContaining({ token: 'Frobnicate', severity: 'warning' }),
    ]);
  });

  it('warns about case-variant duplicates', () => {
    const issues = lintKeywordTokens(['Rev', 'rev']);
    expect(issues).toEqual([expect.objectContaining({ token: 'rev', severity: 'warning' })]);
  });

  it('validates custom Name=definition entries', () => {
    expect(lintKeywordTokens(['Build=$Rev$-$Date$'])).toEqual([]);
    expect(lintKeywordTokens(['Broken='])).toEqual([
      expect.objectContaining({ severity: 'error' }),
    ]);
  });
});

describe('expandKeywordAnchor (classic expansion formats)', () => {
  it('expands each built-in keyword with its classic shape', () => {
    expect(expandKeywordAnchor('Rev', sample)).toBe(`$Rev: ${sample.revision} $`);
    expect(expandKeywordAnchor('Revision', sample)).toBe(`$Revision: ${sample.revision} $`);
    expect(expandKeywordAnchor('Date', sample)).toBe(`$Date: ${sample.date} $`);
    expect(expandKeywordAnchor('Author', sample)).toBe(`$Author: ${sample.author} $`);
    expect(expandKeywordAnchor('HeadURL', sample)).toBe(`$HeadURL: ${sample.headURL} $`);
    expect(expandKeywordAnchor('URL', sample)).toBe(`$URL: ${sample.headURL} $`);
  });

  it('expands Id and Header composites', () => {
    expect(expandKeywordAnchor('Id', sample)).toBe(
      `$Id: calc.c ${sample.revision} ${sample.date} ${sample.author} $`
    );
    expect(expandKeywordAnchor('Header', sample)).toBe(
      `$Header: ${sample.headURL} ${sample.revision} ${sample.date} ${sample.author} $`
    );
  });

  it('leaves unknown keywords untouched', () => {
    expect(expandKeywordAnchor('Nope', sample)).toBe('$Nope$');
  });
});

describe('expandKeywordsInText', () => {
  it('expands enabled anchors and refreshes stale values in place', () => {
    const text = [
      '/* $Rev$ */',
      '// $Author: oldguy $',
      '// $Id: calc.c 7 2001-01-01 00:00:00Z sally $',
      '// $MadeUp$',
    ].join('\n');
    const expanded = expandKeywordsInText(text, ['Rev', 'Author', 'Id'], sample);
    expect(expanded).toBe(
      [
        `/* $Rev: ${sample.revision} $ */`,
        `// $Author: ${sample.author} $`,
        `// $Id: calc.c ${sample.revision} ${sample.date} ${sample.author} $`,
        '// $MadeUp$',
      ].join('\n')
    );
  });

  it('ignores anchors for keywords that are not enabled', () => {
    expect(expandKeywordsInText('$Rev$ $Date$', ['Rev'], sample)).toBe(
      `$Rev: ${sample.revision} $ $Date$`
    );
  });
});

describe('isTextLikeFile', () => {
  it('treats missing mime type as text and honors eol-style', () => {
    expect(isTextLikeFile(undefined, undefined)).toBe(true);
    expect(isTextLikeFile('', '')).toBe(true);
    expect(isTextLikeFile(null, 'native')).toBe(true);
  });

  it('classifies common mime types', () => {
    expect(isTextLikeFile('text/plain')).toBe(true);
    expect(isTextLikeFile('application/xml')).toBe(true);
    expect(isTextLikeFile('application/json')).toBe(true);
    expect(isTextLikeFile('application/octet-stream')).toBe(false);
    expect(isTextLikeFile('image/png')).toBe(false);
  });
});
