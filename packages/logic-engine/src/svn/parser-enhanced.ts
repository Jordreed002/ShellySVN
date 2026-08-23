/**
 * SVN XML Parser with improved error handling
 *
 * This module provides robust XML parsing for SVN command output
 * with comprehensive error handling and validation.
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  SvnStatusResult,
  SvnStatusEntry,
  SvnLogResult,
  SvnLogEntry,
  SvnLogPath,
  SvnInfoResult,
  SvnStatusChar,
} from '@shellysvn/shared';

/**
 * Parser error class for specific XML parsing errors
 */
export class SvnXmlParseError extends Error {
  constructor(
    message: string,
    public readonly xml?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SvnXmlParseError';
  }
}

/**
 * Controlled error thrown when XML input violates the hardened limits.
 */
export class SvnXmlInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvnXmlInputError';
  }
}

/**
 * Hardened limits for XML produced by the SVN CLI.
 *
 * This standalone binary cannot import the canonical guard implementation
 * from `@shellysvn/shared` (only type-only imports resolve at build time), so
 * this file carries a mirror of the utilities in
 * `packages/shared/src/svn-parsers.ts` and the factory in
 * `src/main/utils/svn-xml.ts`. Keep the limits and logic in sync.
 *
 * Rationale: `svn status --xml` emits ~200-400 bytes per entry, so a
 * 100k-file working copy produces ~20-40 MB of XML; 128 MiB gives 3-6x
 * headroom while bounding the parsed tree to well under 1 GB. Legitimate SVN
 * nesting tops out around 6 elements; 64 is >10x headroom. Real attribute
 * values and text nodes (paths, messages, svn:mergeinfo) stay far below
 * 8 MiB.
 */
export const SVN_XML_LIMITS = {
  maxInputChars: 128 * 1024 * 1024,
  maxDepth: 64,
  maxValueChars: 8 * 1024 * 1024,
} as const;

/**
 * Decode the well-known XML entities that fast-xml-parser would have decoded
 * with `processEntities: true`. Only the five predefined entities (and their
 * numeric aliases like `&#39;`) are decoded; single-pass replacement means
 * `&amp;lt;` decodes to `&lt;`, matching fast-xml-parser's behavior.
 */
const SVN_XML_ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|#38|#34|#39|#60|#62|#x26|#x22|#x27|#x3C|#x3E|#x3c|#x3e);/g;
const SVN_XML_ENTITY_VALUES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#38': '&',
  '#34': '"',
  '#39': "'",
  '#60': '<',
  '#62': '>',
  '#x26': '&',
  '#x22': '"',
  '#x27': "'",
  '#x3C': '<',
  '#x3E': '>',
  '#x3c': '<',
  '#x3e': '>',
};

export function decodeSvnXmlEntities(value: string): string {
  if (!value.includes('&')) {
    return value;
  }
  return value.replace(SVN_XML_ENTITY_PATTERN, (match, name: string) =>
    SVN_XML_ENTITY_VALUES[name] ?? match
  );
}

/**
 * Fail fast when the raw XML nests deeper than the limit, before the parser
 * builds a tree. Comments, CDATA, processing instructions, and DOCTYPE
 * declarations (including `<!ENTITY` lines) never count towards the depth,
 * so entity-declaration bombs are inert by construction.
 */
function assertSvnXmlDepthWithinLimit(xml: string): void {
  const { maxDepth } = SVN_XML_LIMITS;
  let depth = 0;
  for (let i = 0; i < xml.length; i += 1) {
    if (xml.charCodeAt(i) !== 0x3c /* < */) {
      continue;
    }
    const next = xml[i + 1];
    if (next === '/') {
      if (depth > 0) depth -= 1;
    } else if (next === '!') {
      if (xml.startsWith('<![CDATA[', i)) {
        const end = xml.indexOf(']]>', i);
        i = end === -1 ? xml.length : end + 2;
      } else if (xml.startsWith('<!--', i)) {
        const end = xml.indexOf('-->', i);
        i = end === -1 ? xml.length : end + 2;
      } else {
        // DOCTYPE and other declarations cannot increase the depth.
        const end = xml.indexOf('>', i);
        i = end === -1 ? xml.length : end;
      }
    } else if (next === '?') {
      const end = xml.indexOf('?>', i);
      i = end === -1 ? xml.length : end + 1;
    } else if (next !== undefined && /[A-Za-z_:]/.test(next)) {
      // Find the real end of this tag, ignoring '>' inside quoted attribute
      // values, so that hostile quoted content cannot hide tag boundaries.
      let j = i + 1;
      let quote = '';
      while (j < xml.length) {
        const ch = xml[j];
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '>') {
          break;
        }
        j += 1;
      }
      // Self-closing tags (<wc-status .../>) never increase the depth: real
      // `svn status` output contains hundreds of thousands of them.
      const selfClosing = j > i && xml[j - 1] === '/';
      if (!selfClosing) {
        depth += 1;
        if (depth > maxDepth) {
          throw new SvnXmlInputError(
            `SVN XML nesting depth exceeds ${maxDepth} (possible hostile input)`
          );
        }
      }
      i = j;
    }
    // Any other '<' is malformed markup; the lenient parser handles it.
  }
}

/**
 * Walk the freshly parsed tree with an explicit stack (no recursion):
 * enforce the depth and per-value caps on attribute values and text nodes,
 * then decode the well-known entities.
 */
function sanitizeSvnXmlTree(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const { maxDepth, maxValueChars } = SVN_XML_LIMITS;
  const stack: Array<{ node: Record<string, unknown> | unknown[]; depth: number }> = [
    { node: value as Record<string, unknown> | unknown[], depth: 0 },
  ];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as {
      node: Record<string, unknown> | unknown[];
      depth: number;
    };
    if (depth > maxDepth) {
      throw new SvnXmlInputError(
        `SVN XML nesting depth exceeds ${maxDepth} (possible hostile input)`
      );
    }
    if (Array.isArray(node)) {
      // fast-xml-parser v4 with an empty attributeNamePrefix stores attribute
      // values as array items, so strings inside arrays get the same cap +
      // decode treatment as object properties.
      for (let index = 0; index < node.length; index += 1) {
        const item = node[index];
        if (typeof item === 'string') {
          if (item.length > maxValueChars) {
            throw new SvnXmlInputError(
              `SVN XML value exceeds ${maxValueChars} characters (possible hostile input)`
            );
          }
          if (item.includes('&')) {
            node[index] = decodeSvnXmlEntities(item);
          }
        } else if (item !== null && typeof item === 'object') {
          stack.push({ node: item as Record<string, unknown>, depth });
        }
      }
      continue;
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (typeof child === 'string') {
        if (child.length > maxValueChars) {
          throw new SvnXmlInputError(
            `SVN XML value of "${key}" exceeds ${maxValueChars} characters (possible hostile input)`
          );
        }
        if (child.includes('&')) {
          node[key] = decodeSvnXmlEntities(child);
        }
      } else if (child !== null && typeof child === 'object') {
        stack.push({ node: child as Record<string, unknown>, depth: depth + 1 });
      }
    }
  }
  return value;
}

/**
 * XML parser configuration: hardened factory mirroring
 * `createSvnXmlParser` from `src/main/utils/svn-xml.ts`. Entity expansion is
 * disabled (fast-xml-parser resolves no external entities by design, and
 * `processEntities: false` leaves DOCTYPE/ENTITY declarations inert, so
 * billion-laughs payloads cannot expand); input size, depth, and per-value
 * caps bound hostile documents; the well-known five entities are decoded
 * after parsing.
 */
const createParser = () => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    parseAttributeValue: true,
    isArray: (name) => ['entry', 'logentry', 'path', 'paths'].includes(name),
    // Forced last: entity expansion can never be re-enabled.
    processEntities: false,
  });

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors fast-xml-parser's own `parse(): any` signature
    parse(xml: string): any {
      if (typeof xml !== 'string') {
        throw new SvnXmlInputError(
          `SVN XML input must be a string, received ${typeof xml}`
        );
      }
      const { maxInputChars } = SVN_XML_LIMITS;
      if (xml.length > maxInputChars) {
        throw new SvnXmlInputError(
          `SVN XML input of ${xml.length} characters exceeds the ${maxInputChars} character limit`
        );
      }
      if (xml.includes('\u0000')) {
        throw new SvnXmlInputError('SVN XML input contains a null byte (possible hostile input)');
      }
      if (xml.length > 0) {
        assertSvnXmlDepthWithinLimit(xml);
      }
      return sanitizeSvnXmlTree(parser.parse(xml));
    },
  };
};

/**
 * Safe string extraction from parsed XML
 */
function safeString(value: unknown, defaultValue = ''): string {
  if (value === null || value === undefined) return defaultValue;
  return String(value);
}

/**
 * Safe number extraction from parsed XML
 */
function safeNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue;
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Validate status character
 */
function isValidStatusChar(char: string): char is SvnStatusChar {
  return [' ', 'A', 'C', 'D', 'I', 'M', 'R', 'X', '?', '!', '~'].includes(char);
}

/**
 * Parse SVN status XML output with robust error handling
 */
export function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  if (!xml || xml.trim() === '') {
    return { path: basePath, entries: [], revision: 0 };
  }

  try {
    const parser = createParser();
    const parsed = parser.parse(xml);
    const target = parsed.status?.target;

    if (!target) {
      console.warn('parseSvnStatusXml: No target element found in XML');
      return { path: basePath, entries: [], revision: 0 };
    }

    // Handle both array and single entry
    const entriesRaw = target.entry || [];
    const entriesArray = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw];

    const entries: SvnStatusEntry[] = entriesArray
      .filter((entry: Record<string, unknown>) => entry != null)
      .map((entry: Record<string, unknown>) => {
        const status = entry['wc-status'] as Record<string, unknown> | undefined;
        const path = safeString(entry.path);
        const item = safeString(status?.item, ' ');
        const props = safeString(status?.props, ' ');
        const commit = status?.commit as Record<string, unknown> | undefined;
        const lock = status?.lock as Record<string, unknown> | undefined;

        // Validate status character
        const validStatus = isValidStatusChar(item) ? item : ' ';

        return {
          path,
          status: validStatus,
          revision: safeNumber(commit?.revision),
          author: safeString(commit?.author),
          date: safeString(commit?.date),
          isDirectory: false, // Will be determined by file system check
          propsStatus: props !== ' ' && isValidStatusChar(props) ? props : undefined,
          lock: lock
            ? {
                owner: safeString(lock.owner),
                comment: safeString(lock.comment),
                date: safeString(lock['creation-date']),
              }
            : undefined,
        };
      });

    return {
      path: basePath,
      entries,
      revision: safeNumber(parsed.status?.target?.revision),
    };
  } catch (error) {
    throw new SvnXmlParseError(
      'Failed to parse SVN status XML',
      xml,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Parse SVN log XML output with robust error handling
 */
export function parseSvnLogXml(xml: string): SvnLogResult {
  if (!xml || xml.trim() === '') {
    return { entries: [], startRevision: 0, endRevision: 0 };
  }

  try {
    const parser = createParser();
    const parsed = parser.parse(xml);
    const logEntries = parsed.log?.logentry;

    if (!logEntries || (Array.isArray(logEntries) && logEntries.length === 0)) {
      return { entries: [], startRevision: 0, endRevision: 0 };
    }

    const entriesArray = Array.isArray(logEntries) ? logEntries : [logEntries];

    const entries: SvnLogEntry[] = entriesArray
      .filter((entry: Record<string, unknown>) => entry != null)
      .map((entry: Record<string, unknown>) => {
        const paths = entry.paths?.path || [];
        const pathsArray = Array.isArray(paths) ? paths : [paths];

        const parsedPaths: SvnLogPath[] = pathsArray
          .filter((p: Record<string, unknown>) => p != null)
          .map((p: Record<string, unknown>) => ({
            action: (safeString(p.action, 'M') || 'M') as 'A' | 'D' | 'M' | 'R',
            path: safeString(p['#text'] || p['_'] || p.path),
            copyFromPath: p['copyfrom-path'] ? safeString(p['copyfrom-path']) : undefined,
            copyFromRev: p['copyfrom-rev'] ? safeNumber(p['copyfrom-rev']) : undefined,
          }));

        return {
          revision: safeNumber(entry.revision),
          author: safeString(entry.author, 'unknown'),
          date: safeString(entry.date),
          message: safeString(entry.msg || entry.message),
          paths: parsedPaths,
        };
      });

    // Sort by revision descending
    entries.sort((a, b) => b.revision - a.revision);

    const revisions = entries.map((e) => e.revision);

    return {
      entries,
      startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
      endRevision: revisions.length > 0 ? Math.max(...revisions) : 0,
    };
  } catch (error) {
    throw new SvnXmlParseError(
      'Failed to parse SVN log XML',
      xml,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Parse SVN info XML output with robust error handling
 */
export function parseSvnInfoXml(xml: string): SvnInfoResult {
  if (!xml || xml.trim() === '') {
    throw new SvnXmlParseError('Empty XML input for SVN info');
  }

  try {
    const parser = createParser();
    const parsed = parser.parse(xml);
    const info = parsed.info;

    if (!info) {
      throw new SvnXmlParseError('No info element found in XML');
    }

    const entry = (info.entry || info) as Record<string, unknown>;
    const repository = (entry.repository || {}) as Record<string, unknown>;
    const commit = (entry.commit || {}) as Record<string, unknown>;

    // Validate node kind
    const nodeKindRaw = safeString(entry.kind, 'unknown');
    const nodeKind: 'file' | 'dir' =
      nodeKindRaw === 'file' || nodeKindRaw === 'dir' ? nodeKindRaw : 'dir';

    return {
      path: safeString(entry.path),
      url: safeString(repository.url),
      repositoryRoot: safeString(repository.root),
      repositoryUuid: safeString(repository.uuid),
      revision: safeNumber(entry.revision),
      nodeKind,
      lastChangedAuthor: safeString(commit.author),
      lastChangedRevision: safeNumber(commit.revision),
      lastChangedDate: safeString(commit.date),
      workingCopyRoot: info['wc-root-abspath'] ? safeString(info['wc-root-abspath']) : undefined,
    };
  } catch (error) {
    if (error instanceof SvnXmlParseError) {
      throw error;
    }
    throw new SvnXmlParseError(
      'Failed to parse SVN info XML',
      xml,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Parse SVN list XML output
 */
export function parseSvnListXml(xml: string): {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    kind: 'file' | 'dir';
    size?: number;
    revision: number;
    author: string;
    date: string;
  }>;
} {
  if (!xml || xml.trim() === '') {
    return { path: '', entries: [] };
  }

  try {
    const parser = createParser();
    const parsed = parser.parse(xml);
    const list = parsed.list;

    if (!list) {
      return { path: '', entries: [] };
    }

    const entriesRaw = list.entry || [];
    const entriesArray = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw];

    const entries = entriesArray
      .filter((entry: Record<string, unknown>) => entry != null)
      .map((entry: Record<string, unknown>) => {
        const commit = (entry.commit || {}) as Record<string, unknown>;

        return {
          name: safeString(entry.name),
          path: safeString(entry.path),
          kind: safeString(entry.kind, 'file') === 'dir' ? 'dir' : ('file' as 'file' | 'dir'),
          size: entry.size !== undefined ? safeNumber(entry.size) : undefined,
          revision: safeNumber(commit.revision),
          author: safeString(commit.author),
          date: safeString(commit.date),
        };
      });

    return {
      path: safeString(list.path),
      entries,
    };
  } catch (error) {
    throw new SvnXmlParseError(
      'Failed to parse SVN list XML',
      xml,
      error instanceof Error ? error : undefined
    );
  }
}

export default {
  parseSvnStatusXml,
  parseSvnLogXml,
  parseSvnInfoXml,
  parseSvnListXml,
  SvnXmlParseError,
};
