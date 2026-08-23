import { describe, expect, it } from 'vitest';

import { forAll, genArray, genConstant, genMap, genOneOf, genPick, genRecord, genUnicodeString } from '@test-utils/propertyCheck';

import { isSafeAiUrl, renderAiMarkdown, sanitizeAiHtml } from '../sanitizeAiMarkdown';

/*
 * Property tests for the AI markdown/HTML sanitizer (item #130): hostile
 * markup never survives — no script/style frames, no event-handler
 * attributes, no dangerous URL schemes in href — and the allowlist walk is
 * idempotent.
 */

const HOSTILE_PAYLOADS = [
  '<script>alert(1)</script>',
  '<iframe src="https://evil.example"></iframe>',
  '<svg onload="alert(1)"><circle r="1"/></svg>',
  '<img src=x onerror="alert(1)">',
  '<a href="javascript:alert(1)">click</a>',
  '<a href="JaVaScRiPt:alert(1)">click</a>',
  '<a href=" javascript:alert(1)">click</a>',
  '<a href="java\tscript:alert(1)">click</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD4=">click</a>',
  '<a href="vbscript:msgbox(1)">click</a>',
  '<a href="//evil.example/x">click</a>',
  '<p onclick="alert(1)">text</p>',
  '<div onmouseover="alert(1)">hover</div>',
  '<style>@import url(evil)</style>',
  '<form action="https://evil.example"><input type="text"></form>',
  '<object data="https://evil.example"></object>',
  '<math><mtext></mtext></math>',
  '<template><script>alert(1)</script></template>',
] as const;

const HOSTILE_MARKDOWN_PAYLOADS = [
  '[click](javascript:alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD4=)',
  '[click](JavaScript:alert(1))',
  '[click]( javascript:alert(1))',
  '[click](java\tscript:alert(1))',
  '[x](https://ok.example/page) and <script>alert(1)</script>',
  '```\n</code></pre><script>alert(1)</script>\n```',
  '# Heading <img src=x onerror=alert(1)>',
  '> quote with <iframe src=//evil></iframe>',
  '- item <style>@import url(evil)</style>',
] as const;

const SAFE_TEXT = genMap(genUnicodeString({ minLen: 0, maxLen: 20 }), (raw) =>
  raw.replace(/[<>&`[\]]/g, ' ')
);

const genHostileHtml = genMap(
  genRecord({
    prefix: SAFE_TEXT,
    payloads: genArray(genPick(HOSTILE_PAYLOADS), { min: 1, max: 4 }),
    suffix: SAFE_TEXT,
  }),
  ({ prefix, payloads, suffix }) => `${prefix}${payloads.join('')}${suffix}`
);

const genHostileMarkdown = genMap(
  genRecord({
    prefix: SAFE_TEXT,
    payloads: genArray(genPick(HOSTILE_MARKDOWN_PAYLOADS), { min: 1, max: 3 }),
    suffix: SAFE_TEXT,
  }),
  ({ prefix, payloads, suffix }) => `${prefix}\n${payloads.join('\n')}\n${suffix}`
);

const DANGEROUS_TAGS = /<(script|iframe|style|svg|object|embed|form|input|math|template|link|meta|base)\b/i;
// An on* attribute inside a real opening tag (escaped text like
// "&lt;img onerror=…" is inert and must NOT trip this check).
const EVENT_HANDLER_ATTR = /<[a-zA-Z][^>]*\son[a-z]+\s*=/i;
const HREF_ATTRIBUTES = /<a\s[^>]*href="([^"]*)"/gi;

describe('sanitizeAiHtml properties', () => {
  it('removes dangerous elements, event handlers and unsafe hrefs from hostile HTML', () => {
    forAll(
      genHostileHtml,
      (html) => {
        const sanitized = sanitizeAiHtml(html);
        expect(sanitized).not.toMatch(DANGEROUS_TAGS);
        expect(sanitized).not.toMatch(EVENT_HANDLER_ATTR);
        const hrefs = [...sanitized.matchAll(HREF_ATTRIBUTES)].map((match) => match[1] ?? '');
        for (const href of hrefs) {
          // Whatever href survives must be judged safe by the URL gate.
          expect(isSafeAiUrl(href)).toBe(true);
        }
        return true;
      },
      { runs: 300 }
    );
  });

  it('is idempotent: sanitizing twice equals sanitizing once', () => {
    forAll(
      genHostileHtml,
      (html) => sanitizeAiHtml(sanitizeAiHtml(html)) === sanitizeAiHtml(html),
      { runs: 300 }
    );
  });
});

describe('renderAiMarkdown properties', () => {
  it('never throws and never emits live script/handler/scheme attacks', () => {
    forAll(
      genHostileMarkdown,
      (markdown) => {
        let html = '';
        expect(() => {
          html = renderAiMarkdown(markdown);
        }).not.toThrow();
        expect(typeof html).toBe('string');
        expect(html).not.toMatch(DANGEROUS_TAGS);
        expect(html).not.toMatch(EVENT_HANDLER_ATTR);
        // Every href attribute in the rendered output must be scheme-safe.
        HREF_ATTRIBUTES.lastIndex = 0;
        const hrefs = [...html.matchAll(HREF_ATTRIBUTES)].map((match) => match[1] ?? '');
        for (const href of hrefs) {
          expect(isSafeAiUrl(href)).toBe(true);
          expect(href.toLowerCase()).not.toContain('javascript:');
          expect(href.toLowerCase().startsWith('data:')).toBe(false);
        }
        // Raw HTML in markdown is escaped, never live.
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<iframe');
        return true;
      },
      { runs: 300 }
    );
  });
});

describe('isSafeAiUrl properties', () => {
  const genSafeUrl = genOneOf(
    genConstant('https://example.com/page'),
    genConstant('http://example.com'),
    genConstant('mailto:user@example.com'),
    genConstant('/relative/path'),
    genConstant('docs/guide.md'),
    genConstant('#anchor'),
    genConstant('?query=1'),
    genMap(genUnicodeString({ minLen: 1, maxLen: 10 }), (raw) => `https://example.com/${encodeURIComponent(raw)}`)
  );

  const genUnsafeUrl = genOneOf(
    genConstant('javascript:alert(1)'),
    genConstant('JAVASCRIPT:alert(1)'),
    genConstant(' data:text/html,x'),
    genConstant('vbscript:msgbox(1)'),
    genConstant('java\nscript:alert(1)'),
    genConstant('java\tscript:alert(1)'),
    genConstant('javascript%3Aalert(1)'),
    genConstant('//evil.example/x'),
    genConstant('mailto:user@example.com%0d%0aBcc:evil@example.com'),
    genConstant('')
  );

  it('accepts http(s)/mailto/relative URLs (with unicode paths)', () => {
    forAll(genSafeUrl, (url) => isSafeAiUrl(url) === true, { runs: 300 });
  });

  it('rejects dangerous schemes, protocol-relative and CRLF-smuggling URLs', () => {
    forAll(genUnsafeUrl, (url) => isSafeAiUrl(url) === false, { runs: 300 });
  });
});
