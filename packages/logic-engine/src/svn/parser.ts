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
import { SVN_XML_LIMITS, SvnXmlInputError, decodeSvnXmlEntities } from './parser-enhanced';

/**
 * Hardened parser mirror of the guards in `./parser-enhanced.ts` (which in
 * turn mirror `packages/shared/src/svn-parsers.ts` and the factory in
 * `src/main/utils/svn-xml.ts`). This Bun-built binary can only type-import
 * `@shellysvn/shared`, so the runtime guard helpers are duplicated here —
 * keep the limits and logic in sync with those files.
 *
 * Security properties (identical to the canonical factory):
 * - `processEntities: false`: entity expansion is disabled, so DOCTYPE/ENTITY
 *   declarations (billion laughs) stay inert text; the well-known five XML
 *   entities are decoded after parsing by `sanitizeSvnXmlTree`.
 * - Input guards: max total size, null-byte rejection, and a nesting-depth
 *   pre-scan before the tree is built; a post-parse walk caps attribute
 *   values/text nodes at `SVN_XML_LIMITS.maxValueChars`.
 * - Guard violations throw {@link SvnXmlInputError}, so hostile SVN CLI
 *   output degrades to a controlled error instead of a crash.
 */

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

const parser = (() => {
  const raw = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    parseAttributeValue: true,
    // Forced last: entity expansion can never be re-enabled.
    processEntities: false,
  });

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors fast-xml-parser's own `parse(): any` signature
    parse(xml: string): any {
      if (typeof xml !== 'string') {
        throw new SvnXmlInputError(`SVN XML input must be a string, received ${typeof xml}`);
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
      return sanitizeSvnXmlTree(raw.parse(xml));
    },
  };
})();

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse SVN status XML output
 */
export function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  const parsed = parser.parse(xml);
  const target = parsed.status?.target;

  if (!target) {
    return { path: basePath, entries: [], revision: 0 };
  }

  // Handle single entry (not in array)
  const entriesRaw = target.entry
    ? Array.isArray(target.entry)
      ? target.entry
      : [target.entry]
    : [];

  const entries: SvnStatusEntry[] = entriesRaw.map((entry: Record<string, unknown>) => {
    const status = entry['wc-status'] as Record<string, unknown>;
    const path = String(entry.path || '');
    const item = String(status?.item || ' ');
    const props = String(status?.props || ' ');
    const commit = status?.commit as Record<string, unknown> | undefined;

    return {
      path,
      status: item as SvnStatusChar,
      revision: commit?.revision ? Number(commit.revision) : undefined,
      author: commit?.author ? String(commit.author) : undefined,
      date: commit?.date ? String(commit.date) : undefined,
      isDirectory: false, // Will be determined by file system check
      propsStatus: props !== ' ' ? (props as SvnStatusChar) : undefined,
    };
  });

  return {
    path: basePath,
    entries,
    revision: parsed.status?.target?.revision || 0,
  };
}

/**
 * Parse SVN log XML output
 */
export function parseSvnLogXml(xml: string): SvnLogResult {
  const parsed = parser.parse(xml);
  const logEntries = parsed.log?.logentry;

  if (!logEntries) {
    return { entries: [], startRevision: 0, endRevision: 0 };
  }

  const entriesRaw = Array.isArray(logEntries) ? logEntries : [logEntries];

  const entries: SvnLogEntry[] = entriesRaw.map((entry: Record<string, unknown>) => {
    const paths = entry.paths?.path;
    const pathsRaw = paths ? (Array.isArray(paths) ? paths : [paths]) : [];

    const parsedPaths: SvnLogPath[] = pathsRaw.map((p: Record<string, unknown>) => ({
      action: String(p.action || 'M') as 'A' | 'D' | 'M' | 'R',
      path: String(p['#text'] || p['_'] || ''),
      copyFromPath: p['copyfrom-path'] ? String(p['copyfrom-path']) : undefined,
      copyFromRev: p['copyfrom-rev'] ? Number(p['copyfrom-rev']) : undefined,
    }));

    return {
      revision: Number(entry.revision || 0),
      author: String(entry.author || 'unknown'),
      date: String(entry.date || ''),
      message: String(entry.msg || ''),
      paths: parsedPaths,
    };
  });

  const revisions = entries.map((e) => e.revision);

  return {
    entries,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0,
  };
}

/**
 * Parse SVN info XML output
 */
export function parseSvnInfoXml(xml: string): SvnInfoResult {
  const parsed = parser.parse(xml);
  const info = parsed.info;

  if (!info) {
    throw new Error('Failed to parse SVN info XML');
  }

  const entry = info.entry || {};
  const repository = entry.repository || {};
  const commit = entry.commit || {};

  return {
    path: String(entry.path || ''),
    url: String(repository.url || ''),
    repositoryRoot: String(repository.root || ''),
    repositoryUuid: String(repository.uuid || ''),
    revision: Number(entry.revision || 0),
    nodeKind: String(entry.kind || 'unknown') as 'file' | 'dir',
    lastChangedAuthor: String(commit.author || ''),
    lastChangedRevision: Number(commit.revision || 0),
    lastChangedDate: String(commit.date || ''),
    workingCopyRoot: info['wc-root-abspath'] ? String(info['wc-root-abspath']) : undefined,
  };
}

/**
 * Parse SVN property XML output
 */
export function parseSvnPropertiesXml(xml: string): { name: string; value: string }[] {
  const parsed = parser.parse(xml);
  const properties = parsed.properties?.target?.property ?? parsed.properties?.property;

  return asArray(properties)
    .map((property: Record<string, unknown>) => {
      if (!property.name) {
        return null;
      }

      return {
        name: String(property.name),
        value: String(property['#text'] ?? ''),
      };
    })
    .filter((property): property is { name: string; value: string } => property !== null);
}
