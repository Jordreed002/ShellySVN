import { describe, expect, it } from 'vitest';
import { isSafeAiUrl, renderAiMarkdown, sanitizeAiHtml } from '../sanitizeAiMarkdown';

/** Tags that must never survive as elements in sanitized output. */
const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'video',
]);

describe('isSafeAiUrl', () => {
  it('allows http, https, mailto, and relative URLs', () => {
    expect(isSafeAiUrl('https://example.com/x?y=1')).toBe(true);
    expect(isSafeAiUrl('http://example.com')).toBe(true);
    expect(isSafeAiUrl('mailto:support@example.com')).toBe(true);
    expect(isSafeAiUrl('docs/guide.md')).toBe(true);
    expect(isSafeAiUrl('/absolute/path')).toBe(true);
    expect(isSafeAiUrl('../relative')).toBe(true);
    expect(isSafeAiUrl('#anchor')).toBe(true);
  });

  it('rejects dangerous and protocol-relative schemes', () => {
    expect(isSafeAiUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeAiUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeAiUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeAiUrl('java\tscript:alert(1)'.replaceAll('\\t', '\t'))).toBe(false);
    expect(isSafeAiUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeAiUrl('vbscript:msgbox')).toBe(false);
    expect(isSafeAiUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeAiUrl('//evil.example.com/x')).toBe(false);
    // Percent-decoding must not smuggle a scheme into a "relative" URL.
    expect(isSafeAiUrl('java%73cript:alert(1)')).toBe(false);
    expect(isSafeAiUrl('%6Aavascript:alert(1)')).toBe(false);
    expect(isSafeAiUrl('mailto:a@b.com%0d%0aBcc:c@d.com')).toBe(false);
  });
});

describe('sanitizeAiHtml', () => {
  it('strips script, style, iframe, object, and embed with their content', () => {
    const hostile =
      '<p>ok</p><script>alert(1)</script><style>body{}</style>' +
      '<iframe src="https://evil.example"></iframe>' +
      '<object data="https://evil.example/o"></object>' +
      '<embed src="https://evil.example/e">';
    const output = sanitizeAiHtml(hostile);
    expect(output).toContain('ok');
    expect(output).not.toContain('script');
    expect(output).not.toContain('alert(1)');
    expect(output).not.toContain('style');
    expect(output).not.toContain('iframe');
    expect(output).not.toContain('object');
    expect(output).not.toContain('embed');
    expect(output).not.toContain('evil.example');
  });

  it('removes every on* attribute regardless of casing', () => {
    const output = sanitizeAiHtml(
      '<p onclick="alert(1)" ONMOUSEOVER="steal()" onLoad="x()">text</p>'
    );
    expect(output).toBe('<p>text</p>');
  });

  it('keeps safe links and strips javascript:/data: URLs', () => {
    const output = sanitizeAiHtml(
      '<a href="javascript:alert(1)">bad</a>' +
        '<a href="https://example.com">good</a>' +
        '<a href="data:text/html,<script>">data</a>' +
        '<a href="docs/readme.md">relative</a>' +
        '<a href="mailto:team@example.com">mail</a>'
    );
    expect(output).not.toContain('javascript:');
    expect(output).not.toContain('data:text/html');
    expect(output).toContain('href="https://example.com"');
    expect(output).toContain('href="docs/readme.md"');
    expect(output).toContain('href="mailto:team@example.com"');
    expect(output).toContain('>bad</a>');
    expect(output).toContain('>data</a>');
  });

  it('unwraps unknown tags but keeps their text and sanitizes nested tricks', () => {
    const output = sanitizeAiHtml(
      '<section><div>kept</div><video src="x" onerror="y">fallback</video></section>'
    );
    expect(output).toContain('kept');
    expect(output).not.toContain('section');
    expect(output).not.toContain('video');
    expect(output).not.toContain('onerror');
  });

  it('neutralizes nested markup smuggled inside allowed tags', () => {
    const output = sanitizeAiHtml(
      '<p><a href="https://ok.example"><script>alert(1)</script>label</a></p>'
    );
    expect(output).toContain('href="https://ok.example"');
    expect(output).not.toContain('script');
    expect(output).toContain('label');
  });

  it('drops form and input plumbing entirely', () => {
    const output = sanitizeAiHtml(
      '<form action="https://evil.example"><input value="pw"><button>go</button></form>'
    );
    expect(output).toBe('');
  });
});

describe('renderAiMarkdown', () => {
  it('escapes raw HTML instead of interpreting it', () => {
    const output = renderAiMarkdown('Use <script>alert(1)</script> carefully');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('renders the supported markdown subset', () => {
    const output = renderAiMarkdown(
      [
        '## Summary',
        '',
        'Changed **retry** handling with `backoff`.',
        '',
        '- first item',
        '- second item',
        '',
        '1. step one',
        '',
        '> quoted line',
        '',
        '[docs](https://example.com)',
      ].join('\n')
    );
    expect(output).toContain('<h4>Summary</h4>');
    expect(output).toContain('<strong>retry</strong>');
    expect(output).toContain('<code>backoff</code>');
    expect(output).toContain('<ul><li>first item</li><li>second item</li></ul>');
    expect(output).toContain('<ol><li>step one</li></ol>');
    expect(output).toContain('<blockquote>');
    expect(output).toContain('<a href="https://example.com">docs</a>');
  });

  it('renders fenced code without interpreting markup inside it', () => {
    const output = renderAiMarkdown('Example:\n```\n<div onclick="x()">hi</div>\n```');
    expect(output).toContain('<pre><code>');
    expect(output).toContain('&lt;div');
    expect(output).not.toContain('<div');
  });

  it('demotes unsafe markdown links to plain text', () => {
    const output = renderAiMarkdown('see [this](javascript:alert) and [that](data:text/html,x)');
    expect(output).not.toContain('javascript:');
    expect(output).not.toContain('data:text/html');
    expect(output).not.toContain('<a ');
    expect(output).toMatch(/see this and that/);
  });

  it('survives a hostile kitchen-sink document', () => {
    const hostile = [
      '# Title <img src=x onerror=alert(1)>',
      '',
      'text with <svg onload=alert(2)> inline',
      '',
      '- [link](jAvascript:alert)',
      '- [good](https://example.com/a?b=1)',
      '',
      '```',
      '<script>alert(4)</script>',
      '```',
      '',
      '<iframe src="https://evil.example"></iframe>',
      '<a href="hTtP://ok.example" onclick="steal()">ok</a>',
    ].join('\n');
    const output = renderAiMarkdown(hostile);
    // Raw HTML is escaped as text — never interpreted as markup.
    expect(output).not.toMatch(/<script|<iframe|<svg|<img/i);
    expect(output).toContain('&lt;iframe');
    expect(output).toContain('&lt;svg');
    // Structural safety, asserted on the parsed DOM rather than strings:
    // no forbidden elements survive as nodes, and no element carries an
    // event handler or an unsafe URL.
    const parsed = new DOMParser().parseFromString(output, 'text/html');
    for (const element of parsed.body.querySelectorAll('*')) {
      expect(DROP_TAGS.has(element.tagName.toLowerCase())).toBe(false);
      for (const attribute of element.attributes) {
        expect(attribute.name.toLowerCase().startsWith('on')).toBe(false);
        if (attribute.name.toLowerCase() === 'href' || attribute.name.toLowerCase() === 'src') {
          expect(isSafeAiUrl(attribute.value)).toBe(true);
        }
      }
    }
    // Markdown-generated safe links survive.
    expect(output).toContain('href="https://example.com/a?b=1"');
  });

  it('returns empty output for empty input', () => {
    expect(renderAiMarkdown('')).toBe('');
    expect(sanitizeAiHtml('')).toBe('');
  });
});
