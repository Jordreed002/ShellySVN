/**
 * String-extraction utility (#134): scans renderer source text for user-facing
 * literals and emits a POT-like JSON document (key candidates + file:line
 * occurrences).
 *
 * PURE by design — it operates on supplied source text only (no fs, no glob),
 * so it is trivially testable and reusable. A future `scripts/` pipeline
 * (Track A) can walk the repo, read files, and feed them to `extractMessages`;
 * see the COORDINATION note at the bottom of this doc and the test fixture in
 * `__tests__/extract.test.ts`.
 *
 * Heuristics (configurable, deterministic, intentionally imperfect):
 * - JSX text nodes: non-empty text containing a letter between `>` and `<`.
 * - String-literal props: `prop="…"` / `prop='…'` for props in `options.props`
 *   (default `title`, `aria-label`, `description`).
 * - Skips: candidates without letters, matching `options.skip` (default: URLs).
 * - Keys: slugified from the text (`"Commit to keep"` → `commit.to.keep`);
 *   collisions between different texts get `-2`, `-3`, … suffixes in first-seen
 *   order; identical texts merge their occurrences.
 *
 * COORDINATION (npm script, Track A owns `scripts/` + `package.json`): once a
 * CLI wrapper exists (read glob → `extractMessages` → write
 * `src/renderer/src/i18n/extracted.json`), please add
 * `"extract:i18n": "bun run scripts/extract-i18n.ts"` to package.json. Nothing
 * in the runtime depends on that script; it is a developer convenience.
 */

/** A source file supplied to the extractor. */
export interface ExtractSource {
  file: string;
  content: string;
}

export interface ExtractOptions {
  /** JSX/string-prop names to treat as user-facing (default: title, aria-label, description). */
  props?: string[];
  /** Candidates matching any of these are skipped (default: http(s) URLs). */
  skip?: RegExp[];
}

export interface ExtractionOccurrence {
  file: string;
  line: number;
}

export interface ExtractedMessage {
  /** Candidate key derived from the text — a human reviews/renames before it lands in a catalog. */
  key: string;
  /** The literal as written, with JSX whitespace runs collapsed. */
  text: string;
  occurrences: ExtractionOccurrence[];
}

/** POT-like, JSON-serializable extraction document (no timestamps: deterministic). */
export interface ExtractionResult {
  version: 1;
  sourceLocale: 'en';
  files: string[];
  messages: ExtractedMessage[];
}

const DEFAULT_PROPS = ['title', 'aria-label', 'description'];
const DEFAULT_SKIP: RegExp[] = [/^https?:\/\//i];

/** JSX text between tags, not spanning tag boundaries or expressions. */
const JSX_TEXT_PATTERN = />\s*([^<>{}]+?)\s*</g;

/** A letter of any script — filters out pure punctuation/number nodes. */
const HAS_LETTER = /\p{L}/u;

/** Collapse whitespace runs (JSX text often wraps across lines). */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Slugify text into a candidate key: non-alphanumerics become dots. */
function keyFor(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/** 1-based line number of `index` within `content`. */
function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract user-facing string candidates from the supplied sources. The result
 * is fully deterministic: sorted files, messages sorted by key, occurrences
 * sorted by file then line.
 */
export function extractMessages(sources: ExtractSource[], options: ExtractOptions = {}): ExtractionResult {
  const props = options.props ?? DEFAULT_PROPS;
  const skip = options.skip ?? DEFAULT_SKIP;

  // text -> occurrences, in first-seen order for stable collision suffixes.
  const byText = new Map<string, ExtractionOccurrence[]>();

  const consider = (rawText: string, file: string, line: number): void => {
    const text = collapseWhitespace(rawText);
    if (!text || !HAS_LETTER.test(text)) return;
    if (skip.some((pattern) => pattern.test(text))) return;
    const occurrences = byText.get(text);
    const occurrence = { file, line };
    if (!occurrences) byText.set(text, [occurrence]);
    else if (!occurrences.some((o) => o.file === file && o.line === line)) occurrences.push(occurrence);
  };

  for (const source of sources.toSorted((a, b) => a.file.localeCompare(b.file))) {
    // JSX text nodes.
    for (const match of source.content.matchAll(JSX_TEXT_PATTERN)) {
      const index = match.index ?? 0;
      consider(match[1], source.file, lineOf(source.content, index + 1));
    }
    // String-literal props, one pattern per configured prop name.
    for (const prop of props) {
      const pattern = new RegExp(`\\b${escapeRegExp(prop)}\\s*=\\s*(["'])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, 'g');
      for (const match of source.content.matchAll(pattern)) {
        const index = match.index ?? 0;
        consider(match[2], source.file, lineOf(source.content, index));
      }
    }
  }

  // Distinct keys: slug first-seen wins; later different texts get -N suffixes.
  const keyOwners = new Map<string, string>();
  const messages: ExtractedMessage[] = [];
  for (const [text, occurrences] of byText) {
    const base = keyFor(text);
    if (!base) continue;
    let key = base;
    let suffix = 2;
    while (keyOwners.has(key) && keyOwners.get(key) !== text) key = `${base}-${suffix++}`;
    keyOwners.set(key, text);
    messages.push({
      key,
      text,
      occurrences: occurrences.toSorted(
        (a, b) => a.file.localeCompare(b.file) || a.line - b.line
      ),
    });
  }

  return {
    version: 1,
    sourceLocale: 'en',
    files: sources.map((s) => s.file).toSorted((a, b) => a.localeCompare(b)),
    messages: messages.toSorted((a, b) => a.key.localeCompare(b.key)),
  };
}
