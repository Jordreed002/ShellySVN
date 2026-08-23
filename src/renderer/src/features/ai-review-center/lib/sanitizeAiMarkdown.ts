/**
 * Allowlist sanitizer for AI-produced rich text (#19, UI half).
 *
 * AI providers return markdown-flavored (sometimes HTML-flavored) strings that
 * must never reach the DOM unfiltered. This module renders a deliberately
 * small markdown subset into HTML *we* generate, then re-sanitizes that HTML
 * through an allowlist walk as defense in depth. No third-party dependency:
 * the walk runs on DOMParser output, so the same code path executes in the
 * renderer and in jsdom tests.
 *
 * Guarantees:
 *  - `script`, `style`, `iframe`, `object`, `embed` (and a few friends) are
 *    removed together with their content, never merely unwrapped.
 *  - Every `on*` attribute is dropped, on any element.
 *  - `href`/`src` only survive with http(s), mailto, or relative URLs —
 *    `javascript:` and `data:` schemes (including whitespace/case tricks)
 *    are stripped.
 */

/** Tags whose entire subtree is removed. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'applet',
  'frame',
  'frameset',
  'math',
  'svg',
  'video',
  'audio',
  'source',
  'track',
]);

/**
 * Tags allowed through. Everything else is unwrapped (children kept, tag
 * removed). Text content is always preserved unless the parent is dropped.
 */
const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'dl',
  'dt',
  'em',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

/** Attribute allowlist, per tag (`*` applies to every allowed tag). */
const ALLOWED_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  '*': new Set(['title']),
  a: new Set(['href']),
  abbr: new Set(['title']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

/** URL schemes permitted in href/src: http(s), mailto, and relative URLs. */
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** True when a URL is safe to keep: http(s), mailto, or scheme-relative. */
export function isSafeAiUrl(rawUrl: string): boolean {
  const url = rawUrl.trim().replaceAll('\t', '').replaceAll('\n', '').replaceAll('\r', '');
  if (!url) return false;
  // Protocol-relative URLs are not in the allowed set: reject them.
  if (url.startsWith('//')) return false;
  // Percent-decoding must not smuggle in a scheme the raw URL hides.
  const decoded = safeDecode(url);
  const decodedMatch = SCHEME_PATTERN.exec(decoded);
  const schemeMatch = SCHEME_PATTERN.exec(url);
  if (!schemeMatch) {
    // Relative URL (path, #anchor, ?query) — unless decoding reveals a scheme.
    return !decodedMatch;
  }
  const scheme = schemeMatch[0].toLowerCase();
  if (scheme === 'mailto:') return !/%0d|%0a/i.test(url);
  if (!ALLOWED_URL_SCHEMES.has(scheme)) return false;
  if (decodedMatch && decodedMatch[0].toLowerCase() !== scheme) return false;
  return true;
}

function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function isEventHandlerAttribute(name: string): boolean {
  return /^on/i.test(name.trim());
}

function sanitizeElement(element: Element): void {
  // Snapshot before mutating: removal/unwrapping mutates the live collection.
  for (const child of Array.from(element.children)) sanitizeElement(child);
  const tag = element.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) {
    element.remove();
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }
  // Snapshot before mutating: attribute removal mutates the live collection.
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const allowed = ALLOWED_ATTRIBUTES[tag]?.has(name) ?? false;
    const globallyAllowed = ALLOWED_ATTRIBUTES['*']?.has(name) ?? false;
    if (isEventHandlerAttribute(name) || (!allowed && !globallyAllowed)) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if ((name === 'href' || name === 'src') && !isSafeAiUrl(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
  }
}

/** Sanitize an HTML string through the allowlist walk. Raw HTML in AI output dies here. */
export function sanitizeAiHtml(html: string): string {
  if (!html) return '';
  const document_ = new DOMParser().parseFromString(html, 'text/html');
  // The body itself is structural — only its children are walked.
  for (const child of Array.from(document_.body.children)) sanitizeElement(child);
  return document_.body.innerHTML;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replaceAll('`', '&#96;');
}

interface InlineRenderState {
  text: string;
}

/** `code` spans — extracted first so no other rule touches their content. */
function renderInlineCode(text: string): string {
  return text.replace(/`([^`\n]+)`/g, (_match, code: string) => `<code>${code}</code>`);
}

function renderBold(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

function renderItalic(text: string): string {
  return text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
}

function renderLinks(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    if (!isSafeAiUrl(url)) return label;
    return `<a href="${escapeAttribute(url)}">${label}</a>`;
  });
}

function renderInline(text: string): string {
  const state: InlineRenderState = { text: escapeHtml(text) };
  state.text = renderInlineCode(state.text);
  state.text = renderBold(state.text);
  state.text = renderItalic(state.text);
  state.text = renderLinks(state.text);
  return state.text;
}

function renderCodeFence(lines: string[], index: number): { html: string; next: number } {
  const body: string[] = [];
  let cursor = index + 1;
  while (cursor < lines.length && !lines[cursor]!.startsWith('```')) {
    body.push(escapeHtml(lines[cursor]!));
    cursor += 1;
  }
  // Consume the closing fence when present.
  if (cursor < lines.length) cursor += 1;
  return { html: `<pre><code>${body.join('\n')}</code></pre>`, next: cursor };
}

function renderListBlock(lines: string[], index: number, ordered: boolean): { html: string; next: number } {
  const items: string[] = [];
  const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    const match = pattern.exec(line);
    if (!match) break;
    items.push(`<li>${renderInline(match[1]!)}</li>`);
    cursor += 1;
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: cursor };
}

/**
 * Render a markdown subset (headings, lists, fenced code, blockquotes,
 * bold/italic/code, links) to sanitized HTML. All raw HTML in the input is
 * escaped — only markup generated here survives, and even that is re-run
 * through `sanitizeAiHtml`.
 */
export function renderAiMarkdown(markdown: string): string {
  if (!markdown) return '';
  const normalized = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const blocks: string[] = [];
  const lines = normalized.split('\n');
  const paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map(renderInline).join('<br />')}</p>`);
    paragraph.length = 0;
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.startsWith('```')) {
      flushParagraph();
      const fence = renderCodeFence(lines, index);
      blocks.push(fence.html);
      index = fence.next;
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(6, Math.max(3, heading[1]!.length + 2));
      blocks.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push('<hr />');
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      const list = renderListBlock(lines, index, false);
      blocks.push(list.html);
      index = list.next;
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const list = renderListBlock(lines, index, true);
      blocks.push(list.html);
      index = list.next;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push(`<blockquote><p>${renderInline(quote[1]!)}</p></blockquote>`);
      index += 1;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();
  return sanitizeAiHtml(blocks.join('\n'));
}
