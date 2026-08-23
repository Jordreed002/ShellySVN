/**
 * svn:keywords parsing, formatting and client-side *preview* expansion.
 *
 * Keyword substitution itself happens inside Subversion — on commit, checkout
 *, update, export or any other "touch" of a text file. Everything here is a
 * pure renderer-side approximation used for live previews and validation;
 * it never writes expanded values.
 *
 * Built-in keywords (svnbook "Keyword Substitution") and the classic
 * (non-localized) expansion formats:
 *
 *   $Rev$       ->  $Rev: 144 $
 *   $Date$      ->  $Date: 2002-07-28 21:30:43Z $
 *   $Author$    ->  $Author: sally $
 *   $HeadURL$   ->  $HeadURL: http://svn.example.com/repos/calc/calc.c $
 *   $URL$       ->  $URL: http://svn.example.com/repos/calc/calc.c $
 *   $Id$        ->  $Id: calc.c 148 2002-07-28 21:30:43Z sally $
 *   $Header$    ->  $Header: http://svn.example.com/repos/calc/calc.c 148 2002-07-28 21:30:43Z sally $
 */

export interface KeywordDescriptor {
  /** Canonical keyword name as it should be stored in svn:keywords. */
  name: string;
  /** Accepted alternative spellings (aliases expand with the alias kept). */
  aliases: string[];
  description: string;
}

export const SVN_KEYWORDS: readonly KeywordDescriptor[] = [
  {
    name: 'Rev',
    aliases: ['Revision'],
    description: 'Revision of the last commit ($Rev: 1234 $)',
  },
  {
    name: 'Date',
    aliases: [],
    description: 'Date of the last commit, GMT ($Date: 2026-08-23 09:15:42Z $)',
  },
  {
    name: 'Author',
    aliases: [],
    description: 'Author of the last commit ($Author: jordan $)',
  },
  {
    name: 'HeadURL',
    aliases: [],
    description: 'Full repository URL of the head version',
  },
  {
    name: 'Id',
    aliases: [],
    description: 'Compressed file, revision, date and author ($Id$)',
  },
  {
    name: 'URL',
    aliases: [],
    description: 'Short alias of HeadURL (kept as written when expanded)',
  },
  {
    name: 'Header',
    aliases: [],
    description: 'Like Id, but with the full URL ($Header$)',
  },
  { name: 'LastChangedRevision', aliases: [], description: 'Legacy alias of Rev' },
  { name: 'LastChangedDate', aliases: [], description: 'Legacy alias of Date' },
  { name: 'LastChangedBy', aliases: [], description: 'Legacy alias of Author' },
] as const;

const KEYWORD_LOOKUP = new Map<string, KeywordDescriptor>();
for (const descriptor of SVN_KEYWORDS) {
  KEYWORD_LOOKUP.set(descriptor.name.toLowerCase(), descriptor);
  for (const alias of descriptor.aliases) {
    KEYWORD_LOOKUP.set(alias.toLowerCase(), descriptor);
  }
}

/** Resolve a keyword token (canonical name or alias) to its descriptor. */
export function lookupKeyword(token: string): KeywordDescriptor | undefined {
  return KEYWORD_LOOKUP.get(token.toLowerCase());
}

export function isKnownKeyword(token: string): boolean {
  return KEYWORD_LOOKUP.has(token.toLowerCase());
}

/** Parse an svn:keywords value: whitespace- and/or comma-separated tokens. */
export function parseKeywordsValue(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/** Serialize tokens back to the canonical single-space-separated value. */
export function formatKeywordsValue(tokens: string[]): string {
  return tokens.join(' ');
}

export interface KeywordLintIssue {
  token: string;
  severity: 'error' | 'warning';
  message: string;
}

/** Validate individual tokens (duplicates, unknown bare keywords). */
export function lintKeywordTokens(tokens: string[]): KeywordLintIssue[] {
  const issues: KeywordLintIssue[] = [];
  const seen = new Map<string, string>(); // lowercase -> first token as written
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const first = seen.get(lower);
    if (first !== undefined) {
      issues.push({
        token,
        severity: 'warning',
        message: `Duplicate of "${first}" — keyword matching is case-sensitive, so both spellings would expand.`,
      });
      continue;
    }
    seen.set(lower, token);

    if (token.includes('=')) {
      const [name, definition] = token.split('=', 2);
      if (!name || !definition) {
        issues.push({
          token,
          severity: 'error',
          message: 'Custom keyword definitions must look like Name=$Rev$-$Date$.',
        });
      }
      continue;
    }
    if (!isKnownKeyword(token)) {
      issues.push({
        token,
        severity: 'warning',
        message:
          'Not a built-in Subversion keyword. Anchors like $Name$ only expand for keywords svn knows (or a custom Name=definition entry).',
      });
    }
  }
  return issues;
}

/** Sample values used to illustrate expansion in previews. */
export interface KeywordSample {
  revision: number;
  /** Already formatted GMT string, e.g. "2026-08-23 09:15:42Z". */
  date: string;
  author: string;
  /** Full URL of the head version of the sample file. */
  headURL: string;
}

export function defaultKeywordSample(overrides: Partial<KeywordSample> = {}): KeywordSample {
  return {
    revision: 1234,
    date: '2026-08-23 09:15:42Z',
    author: 'jordan',
    headURL: 'https://svn.example.com/repos/calc/trunk/src/calc.c',
    ...overrides,
  };
}

function idComponents(sample: KeywordSample): { name: string; rest: string } {
  const name = sample.headURL.split('/').filter(Boolean).pop() ?? 'file';
  const rest = `${sample.revision} ${sample.date} ${sample.author}`;
  return { name, rest };
}

function keywordValue(keywordAsWritten: string, sample: KeywordSample): string {
  const canonical = lookupKeyword(keywordAsWritten)?.name.toLowerCase() ?? '';
  switch (canonical) {
    case 'rev':
      return String(sample.revision);
    case 'date':
      return sample.date;
    case 'author':
      return sample.author;
    case 'headurl':
    case 'url':
      return sample.headURL;
    case 'id': {
      const { name, rest } = idComponents(sample);
      return `${name} ${rest}`;
    }
    case 'header':
      return `${sample.headURL} ${idComponents(sample).rest}`;
    default:
      return '';
  }
}

/**
 * Expand one keyword anchor as Subversion's classic style would:
 * `$Rev$` -> `$Rev: 1234 $` (the spelling in the anchor is preserved).
 * Unknown keywords return the anchor unchanged.
 */
export function expandKeywordAnchor(
  keywordAsWritten: string,
  sample: KeywordSample,
  /** Existing payload inside `$Keyword: ...$`, for fixed-width-style refills. */
  existingPayload?: string
): string {
  const value = keywordValue(keywordAsWritten, sample);
  if (value === '') return `$${keywordAsWritten}${existingPayload ? `:${existingPayload}` : ''}$`;
  return `$${keywordAsWritten}: ${value} $`;
}

const KEYWORD_ANCHOR = /\$([A-Za-z][A-Za-z0-9_]*)(:([^$\r\n]*))?\$/g;

/**
 * Rewrite a sample text: every `$Keyword$` / `$Keyword: …$` anchor whose
 * keyword is in `enabledKeywords` (compared case-insensitively, like the
 * editor's checkbox list) expands to its preview value; all other anchors
 * are left untouched.
 */
export function expandKeywordsInText(
  text: string,
  enabledKeywords: readonly string[],
  sample: KeywordSample
): string {
  const enabled = new Set(enabledKeywords.map((keyword) => keyword.toLowerCase()));
  return text.replace(KEYWORD_ANCHOR, (anchor, name: string) => {
    if (!enabled.has(name.toLowerCase())) return anchor;
    return expandKeywordAnchor(name, sample);
  });
}

/**
 * Whether keyword substitution applies at all: Subversion substitutes only in
 * text files. A missing svn:mime-type means "text" by default; an svn:eol-style
 * value always implies text.
 */
export function isTextLikeFile(mimeType?: string | null, eolStyle?: string | null): boolean {
  if (eolStyle && eolStyle.trim() !== '') return true;
  if (!mimeType || mimeType.trim() === '') return true;
  const value = mimeType.toLowerCase();
  if (value.startsWith('text/')) return true;
  if (value.endsWith('+xml') || value.endsWith('/xml')) return true;
  if (value === 'application/json' || value === 'application/javascript') return true;
  return false;
}
