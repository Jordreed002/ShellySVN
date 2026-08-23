import { describe, expect, it } from 'vitest';
import {
  formatExternalDefinition,
  formatSvnExternals,
  isValidExternalRevision,
  isValidExternalUrl,
  parseSvnExternals,
  validateExternalFields,
  type SvnExternalLine,
} from '../svnExternals';

function definitionsOf(value: string) {
  return parseSvnExternals(value).definitions.map((entry) => entry.definition);
}

function stripLayoutFlag(definitions: Array<{ legacy?: boolean }>) {
  return definitions.map(({ legacy: _legacy, ...rest }) => rest);
}

describe('parseSvnExternals — modern and legacy layouts', () => {
  it('parses the modern URL-first form with peg and operative revisions', () => {
    const [def] = definitionsOf('http://svn.example.com/repos/vendor@1335 -r 1335 vendor');
    expect(def).toEqual({
      localPath: 'vendor',
      url: 'http://svn.example.com/repos/vendor',
      pegRevision: '1335',
      operativeRevision: '1335',
    });
  });

  it('parses the legacy local-path-first form and flags it', () => {
    const result = parseSvnExternals('vendor -r1335 http://svn.example.com/repos/vendor');
    const entry = result.definitions[0];
    expect(entry.definition).toEqual({
      localPath: 'vendor',
      url: 'http://svn.example.com/repos/vendor',
      operativeRevision: '1335',
      legacy: true,
    });
    expect(entry.warnings).toContainEqual(expect.objectContaining({ code: 'legacy-form' }));
  });

  it('accepts the split -r form and -r HEAD', () => {
    const [a] = definitionsOf('deps -r HEAD https://svn.example.com/deps');
    expect(a).toEqual({
      localPath: 'deps',
      url: 'https://svn.example.com/deps',
      operativeRevision: 'HEAD',
      legacy: true,
    });
    const [b] = definitionsOf('^/trunk/deps -r 42 deps');
    expect(b).toEqual({
      localPath: 'deps',
      url: '^/trunk/deps',
      operativeRevision: '42',
    });
  });

  it('supports repository- and parent-relative URL forms', () => {
    expect(definitionsOf('^/deps/lib lib')[0].url).toBe('^/deps/lib');
    expect(definitionsOf('//svn.example.com/repos/lib lib')[0].url).toBe(
      '//svn.example.com/repos/lib'
    );
    expect(definitionsOf('/repos/trunk/lib lib')[0].url).toBe('/repos/trunk/lib');
    expect(definitionsOf('../shared shared')[0]).toEqual(
      expect.objectContaining({ url: '../shared', localPath: 'shared' })
    );
    expect(parseSvnExternals('../shared shared').definitions[0].warnings).toContainEqual(
      expect.objectContaining({ code: 'relative-url' })
    );
  });

  it('treats ../ relative first tokens as URLs (modern form)', () => {
    // First token looks like a URL reference -> modern layout.
    expect(definitionsOf('../shared shared-src')[0]).toEqual(
      expect.objectContaining({ url: '../shared', localPath: 'shared-src' })
    );
  });

  it('parses nested local paths', () => {
    expect(definitionsOf('^/vendor/zlib vendor/zlib')[0].localPath).toBe('vendor/zlib');
  });

  it('keeps comments and blank lines as their own kinds', () => {
    const { lines } = parseSvnExternals(
      '# top comment\n\n^/a a\n   # indented comment\n\n^/b b'
    );
    expect(lines.map((line) => line.kind)).toEqual([
      'comment',
      'blank',
      'definition',
      'comment',
      'blank',
      'definition',
    ]);
    const comment = lines[0] as Extract<SvnExternalLine, { kind: 'comment' }>;
    expect(comment.comment).toBe('top comment');
  });
});

describe('parseSvnExternals — hostile input', () => {
  it('handles empty, whitespace-only and comment-only values', () => {
    expect(parseSvnExternals('').lines).toEqual([{ kind: 'blank', raw: '' }]);
    expect(parseSvnExternals(undefined).lines).toEqual([{ kind: 'blank', raw: '' }]);
    expect(parseSvnExternals('   \n\t\n').lines.every((line) => line.kind === 'blank')).toBe(true);
    expect(parseSvnExternals('# nothing\n# here').definitions).toEqual([]);
  });

  it('survives CRLF and tabs between tokens', () => {
    const [def] = definitionsOf('deps\t-r\t21\thttps://svn.example.com/deps\r\n');
    expect(def).toEqual({
      localPath: 'deps',
      url: 'https://svn.example.com/deps',
      operativeRevision: '21',
      legacy: true,
    });
  });

  it('marks single-token and over-long lines invalid with reasons', () => {
    const { lines } = parseSvnExternals('just-one-token');
    expect(lines[0]).toMatchObject({ kind: 'invalid', error: expect.stringContaining('two tokens') });
    const tooMany = parseSvnExternals('^/a a extra').lines[0];
    expect(tooMany).toMatchObject({ kind: 'invalid', error: expect.stringContaining('Too many tokens') });
  });

  it('rejects lines where both tokens look like URLs (ambiguous)', () => {
    const line = parseSvnExternals('https://a https://b').lines[0];
    expect(line).toMatchObject({ kind: 'invalid', error: expect.stringContaining('URLs') });
  });

  it('rejects lines where neither token looks like a URL', () => {
    const line = parseSvnExternals('foo bar').lines[0];
    expect(line).toMatchObject({
      kind: 'invalid',
      error: expect.stringContaining('Neither token looks like a URL'),
    });
  });

  it('rejects absolute and ..-escaping local paths', () => {
    const absolute = parseSvnExternals('C:\\temp\\evil https://x').lines[0];
    expect(absolute).toMatchObject({
      kind: 'invalid',
      error: expect.stringContaining('relative'),
    });
    const escaping = parseSvnExternals('a/../evil https://x').lines[0];
    expect(escaping).toMatchObject({ kind: 'invalid', error: expect.stringContaining('..') });
  });

  it('flags duplicate local paths across lines', () => {
    const result = parseSvnExternals('^/a dep\n^/b dep');
    expect(result.definitions[1].warnings).toContainEqual(
      expect.objectContaining({ code: 'duplicate-local-path' })
    );
  });

  it('flags -r with a missing revision', () => {
    const line = parseSvnExternals('^/a a -r').lines[0];
    expect(line).toMatchObject({ kind: 'invalid', error: expect.stringContaining('-r') });
  });

  it('keeps a literal @ inside a URL and warns about a trailing empty peg', () => {
    const [def] = definitionsOf('svn+ssh://user@host/repo/trunk dep');
    expect(def?.url).toBe('svn+ssh://user@host/repo/trunk');
    expect(def?.pegRevision).toBeUndefined();
    const result = parseSvnExternals('https://host/repo@ dep');
    expect(result.definitions[0].warnings).toContainEqual(
      expect.objectContaining({ code: 'peg-empty' })
    );
  });

  it('warns on quoted tokens (svn:externals has no quoting)', () => {
    const result = parseSvnExternals('^/a "mydep"');
    expect(result.lines[0]).toMatchObject({ kind: 'definition' });
    expect(
      result.lines[0].kind === 'definition' ? result.lines[0].warnings : []
    ).toContainEqual(expect.objectContaining({ code: 'quoted-token' }));
  });
});

describe('format round-trips', () => {
  const values = [
    'http://svn.example.com/vendor@1335 -r 1335 vendor',
    'vendor -r 1335 http://svn.example.com/vendor',
    '^/trunk/deps -r 42 deps',
    '../shared shared',
    '# comment\n\n^/a a\n^/b@HEAD -r HEAD b/nested',
    'deps\t-r\t21\thttps://svn.example.com/deps',
  ];

  it.each(values)('re-parses formatted output to the same definition: %s', (value) => {
    const first = parseSvnExternals(value);
    const formatted = formatSvnExternals(first.lines);
    const second = parseSvnExternals(formatted);
    expect(stripLayoutFlag(second.definitions.map((entry) => entry.definition))).toEqual(
      stripLayoutFlag(first.definitions.map((entry) => entry.definition))
    );
    // Canonical output is stable.
    expect(formatSvnExternals(second.lines)).toBe(formatted);
  });

  it('rewrites legacy lines in canonical modern form', () => {
    expect(formatExternalDefinition({ localPath: 'vendor', url: 'https://x/v', operativeRevision: '5', legacy: true })).toBe(
      'https://x/v -r 5 vendor'
    );
    expect(
      formatSvnExternals([{ kind: 'definition', raw: 'v https://x', definition: { localPath: 'v', url: 'https://x' }, warnings: [] }])
    ).toBe('https://x v');
  });

  it('preserves invalid lines verbatim so nothing is silently dropped', () => {
    const lines = parseSvnExternals('garbage line here\n^/ok ok').lines;
    expect(formatSvnExternals(lines)).toBe('garbage line here\n^/ok ok');
  });
});

describe('validation helpers', () => {
  it('validates revision and URL shapes', () => {
    expect(isValidExternalRevision('1234')).toBe(true);
    expect(isValidExternalRevision('HEAD')).toBe(true);
    expect(isValidExternalRevision('{2020-01-01}')).toBe(true);
    expect(isValidExternalRevision('abc')).toBe(false);
    expect(isValidExternalRevision('')).toBe(false);
    expect(isValidExternalUrl('https://x/y')).toBe(true);
    expect(isValidExternalUrl('svn+ssh://x/y')).toBe(true);
    expect(isValidExternalUrl('^/y')).toBe(true);
    expect(isValidExternalUrl('../y')).toBe(true);
    expect(isValidExternalUrl('//host/y')).toBe(true);
    expect(isValidExternalUrl('not a url')).toBe(false);
    expect(isValidExternalUrl('http://x /y')).toBe(false);
  });

  it('reports per-field issues for the table editor', () => {
    const issues = validateExternalFields({
      localPath: '../evil',
      url: 'nope',
      operativeRevision: 'soon',
      pegRevision: 'x',
    });
    expect(issues.localPath).toHaveLength(1);
    expect(issues.url).toHaveLength(1);
    expect(issues.operativeRevision).toHaveLength(1);
    expect(issues.pegRevision).toHaveLength(1);
    expect(validateExternalFields({ localPath: 'dep', url: '^/dep' })).toEqual({
      localPath: [],
      url: [],
      operativeRevision: [],
      pegRevision: [],
    });
  });
});
