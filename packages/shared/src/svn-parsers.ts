import { XMLParser } from 'fast-xml-parser';
import type { SvnLogResult, SvnStatusChar, SvnStatusResult } from './types';

/**
 * Hardened limits for XML produced by the SVN CLI.
 *
 * `svn status --xml` emits roughly 200-400 bytes per entry, so a 100k-file
 * working copy produces ~20-40 MB of XML. The caps below keep generous
 * headroom over that worst case while guaranteeing that hostile XML (from a
 * compromised server or crafted patch/shelf data) can never trigger
 * unbounded memory or CPU use:
 *
 * - `maxInputChars` (128 MiB): 3-6x the largest realistic payload; bounds the
 *   parsed object tree (fast-xml-parser amplifies input ~3-6x) to well under
 *   1 GB instead of OOM-ing the process.
 * - `maxDepth` (64): the deepest legitimate SVN structure is ~6 elements
 *   (status > target > entry > wc-status > commit > author); 64 is >10x
 *   headroom and far below any nesting depth that could stress consumers.
 * - `maxValueChars` (8 MiB): applied to every attribute value and text node
 *   after parsing. Real values are paths, dates, UUIDs, log messages, and
 *   property values (svn:mergeinfo can reach hundreds of KB); 8 MiB is ample
 *   while keeping any single value bounded.
 */
export const SVN_XML_LIMITS = {
  maxInputChars: 128 * 1024 * 1024,
  maxDepth: 64,
  maxValueChars: 8 * 1024 * 1024,
} as const;

/** Controlled error thrown when XML input violates the hardened limits. */
export class SvnXmlInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvnXmlInputError';
  }
}

/**
 * Decode the well-known XML entities that fast-xml-parser would have decoded
 * with `processEntities: true`. Only the five predefined XML entities (and
 * their numeric aliases, e.g. `&#39;`/`&#x27;`) are decoded; every other
 * reference stays literal. The single-pass replace means `&amp;lt;` decodes to
 * `&lt;` (matching fast-xml-parser's ampersand-last ordering) instead of `<`.
 */
const SVN_XML_ENTITY_PATTERN =
  /&(amp|lt|gt|quot|apos|#38|#34|#39|#60|#62|#x26|#x22|#x27|#x3C|#x3E|#x3c|#x3e);/g;
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
  return value.replace(
    SVN_XML_ENTITY_PATTERN,
    (match, name: string) => SVN_XML_ENTITY_VALUES[name] ?? match
  );
}

/**
 * Fail fast when the raw XML nests deeper than `maxDepth`. Runs before the
 * parser sees the input so deeply nested bombs are rejected in O(n) without
 * building a tree. Comments, CDATA sections, processing instructions, and
 * DOCTYPE declarations (including `<!ENTITY` lines) never count towards the
 * depth, so entity-declaration bombs are inert by construction.
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
 * enforce the depth and per-value caps the raw scan cannot express, and
 * decode the well-known entities in text nodes and attribute values.
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
      // fast-xml-parser can store leaf values as array items (e.g. v4 with an
      // empty attributeNamePrefix wraps attribute values in arrays), so
      // strings inside arrays get the same cap + decode treatment.
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
 * Pre-parse input guards shared by every hardened parser entry point:
 * type check, total size cap, null-byte rejection (NUL is illegal in every
 * XML version and svn never emits it), and the depth pre-scan.
 */
function guardSvnXmlInput(xml: string): void {
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
}

/**
 * Parse with the hardened pipeline: input guards (type, size, null bytes,
 * depth pre-scan), entity-expansion-free parsing, then a depth/size-capped
 * and entity-decoded result tree. Throws {@link SvnXmlInputError} on guard
 * violations; parser errors propagate unchanged.
 *
 * This is the canonical guard implementation: the main-process factory in
 * `src/main/utils/svn-xml.ts` and the standalone logic-engine copy in
 * `packages/logic-engine/src/svn/parser-enhanced.ts` must stay consistent
 * with it (the logic-engine binary cannot import this package at runtime).
 */
export function parseSvnXmlWithGuards(parser: XMLParser, xml: string): unknown {
  guardSvnXmlInput(xml);
  const parsed = parser.parse(xml);
  return sanitizeSvnXmlTree(parsed);
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Security: never expand entities inside the parser. fast-xml-parser does
  // not fetch external entities by design, and `processEntities: false`
  // additionally leaves every entity reference (including DOCTYPE-declared
  // ones) as literal text, which makes billion-laughs payloads inert. The
  // well-known five entities are decoded afterwards by sanitizeSvnXmlTree.
  processEntities: false,
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true,
});

const parseXmlHardened = (xml: string): unknown => parseSvnXmlWithGuards(xmlParser, xml);

const SVN_STATUS_MAP: Record<string, SvnStatusChar> = {
  none: ' ',
  normal: ' ',
  added: 'A',
  conflicted: 'C',
  deleted: 'D',
  ignored: 'I',
  modified: 'M',
  replaced: 'R',
  external: 'X',
  unversioned: '?',
  missing: '!',
  obstructed: '~',
  incomplete: '!',
};

function mapSvnStatus(status?: string): SvnStatusChar {
  if (!status) return ' ';
  return SVN_STATUS_MAP[status] ?? ' ';
}

function parseBooleanAttribute(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

function mapPropsStatus(status?: string): SvnStatusResult['entries'][0]['propsStatus'] {
  const mapped = mapSvnStatus(status);
  return mapped === ' ' ? undefined : mapped;
}

type StatusCommitXml = { '@_revision': string; author?: string; date?: string };

type StatusXmlEntry = {
  '@_path': string;
  'wc-status'?: {
    '@_item': string;
    '@_props'?: string;
    '@_revision'?: string;
    '@_switched'?: boolean | string;
    '@_tree-conflicted'?: boolean | string;
    commit?: StatusCommitXml;
    lock?: { owner?: string; comment?: string; creationdate?: string };
    'tree-conflict'?: {
      '@_operation'?: string;
      '@_action'?: string;
      '@_reason'?: string;
      '@_type'?: string;
    };
  };
  'repos-status'?: {
    '@_item': string;
    '@_props'?: string;
    commit?: StatusCommitXml;
  };
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  const entries: SvnStatusResult['entries'] = [];

  try {
    const parsed = parseXmlHardened(xml) as {
      status?: {
        target?: {
          entry?: StatusXmlEntry[] | StatusXmlEntry;
          changelist?:
            | Array<{ '@_name'?: string; entry?: StatusXmlEntry[] | StatusXmlEntry }>
            | { '@_name'?: string; entry?: StatusXmlEntry[] | StatusXmlEntry };
        };
      };
    };

    const target = parsed.status?.target;
    if (!target) {
      return { path: basePath, entries: [], revision: 0 };
    }

    const entriesArray: Array<{ entry: StatusXmlEntry; changelist?: string }> = [
      ...asArray(target.entry).map((entry) => ({ entry })),
      ...asArray(target.changelist).flatMap((changelist) =>
        asArray(changelist.entry).map((entry) => ({
          entry,
          changelist: changelist['@_name'],
        }))
      ),
    ];
    if (entriesArray.length === 0) {
      return { path: basePath, entries: [], revision: 0 };
    }

    for (const { entry, changelist } of entriesArray) {
      const wcStatus = entry['wc-status'];
      if (!wcStatus) continue;
      const reposStatus = entry['repos-status'];
      const propsStatus = mapPropsStatus(wcStatus['@_props']);
      // Current SVN clients commonly expose the marker as an attribute in
      // `svn status --xml`; older/fixture output may include a detail element.
      const hasTreeConflict =
        parseBooleanAttribute(wcStatus['@_tree-conflicted']) || Boolean(wcStatus['tree-conflict']);
      const itemStatus = mapSvnStatus(wcStatus['@_item']);

      entries.push({
        path: entry['@_path'] || '',
        // A property-only conflict is reported in the second status column
        // while the text item may merely be "modified". Promote every SVN
        // conflict kind to the primary UI status without discarding its detail.
        status: itemStatus === 'C' || propsStatus === 'C' || hasTreeConflict ? 'C' : itemStatus,
        revision: wcStatus.commit?.['@_revision']
          ? parseInt(wcStatus.commit['@_revision'], 10)
          : undefined,
        author: wcStatus.commit?.author,
        date: wcStatus.commit?.date,
        isDirectory: false,
        propsStatus,
        remoteStatus: reposStatus ? mapSvnStatus(reposStatus['@_item']) : undefined,
        remotePropsStatus: reposStatus ? mapPropsStatus(reposStatus['@_props']) : undefined,
        remoteRevision: reposStatus?.commit?.['@_revision']
          ? parseInt(reposStatus.commit['@_revision'], 10)
          : undefined,
        remoteAuthor: reposStatus?.commit?.author,
        remoteDate: reposStatus?.commit?.date,
        changelist,
        switched: parseBooleanAttribute(wcStatus['@_switched']),
        lock: wcStatus.lock
          ? {
              owner: wcStatus.lock.owner || '',
              comment: wcStatus.lock.comment || '',
              date: wcStatus.lock.creationdate || '',
            }
          : undefined,
        treeConflict: hasTreeConflict
          ? {
              operation: wcStatus['tree-conflict']?.['@_operation'],
              action: wcStatus['tree-conflict']?.['@_action'],
              reason: wcStatus['tree-conflict']?.['@_reason'],
              type: wcStatus['tree-conflict']?.['@_type'],
            }
          : undefined,
      });
    }
  } catch (error) {
    return {
      path: basePath,
      entries,
      revision: 0,
      parseError: error instanceof Error ? error.message : 'Failed to parse status XML',
    };
  }

  return {
    path: basePath,
    entries,
    revision: 0,
    remoteChecked: entries.some((entry) => entry.remoteStatus !== undefined),
  };
}

export function parseSvnLogXml(xml: string): SvnLogResult {
  const entries: SvnLogResult['entries'] = [];
  let parseError: string | undefined;

  try {
    const parsed = parseXmlHardened(xml) as {
      log?: {
        logentry?:
          | Array<{
              '@_revision': string;
              author?: string;
              date?: string;
              msg?: string;
              paths?: { path?: Array<Record<string, string>> | Record<string, string> };
              revprops?: {
                property?:
                  | Array<{ '@_name'?: string; '#text'?: string }>
                  | { '@_name'?: string; '#text'?: string };
              };
            }>
          | {
              '@_revision': string;
              author?: string;
              date?: string;
              msg?: string;
              paths?: { path?: Array<Record<string, string>> | Record<string, string> };
              revprops?: {
                property?:
                  | Array<{ '@_name'?: string; '#text'?: string }>
                  | { '@_name'?: string; '#text'?: string };
              };
            };
      };
    };

    const logEntries = parsed.log?.logentry;
    if (!logEntries) {
      return { entries: [], startRevision: 0, endRevision: 0 };
    }

    for (const entry of Array.isArray(logEntries) ? logEntries : [logEntries]) {
      const pathList = entry.paths?.path
        ? Array.isArray(entry.paths.path)
          ? entry.paths.path
          : [entry.paths.path]
        : [];
      const revisionPropertyList = entry.revprops?.property
        ? Array.isArray(entry.revprops.property)
          ? entry.revprops.property
          : [entry.revprops.property]
        : [];
      const revisionProperties = Object.fromEntries(
        revisionPropertyList
          .filter((property) => Boolean(property['@_name']))
          .map((property) => [property['@_name'] as string, property['#text'] ?? ''])
      );

      entries.push({
        revision: parseInt(entry['@_revision'], 10) || 0,
        author: entry.author || 'unknown',
        date: entry.date || '',
        message: entry.msg || '',
        paths: pathList.map((p) => ({
          path: p['#text'] || '',
          action: (p['@_action'] || '') as 'A' | 'D' | 'M' | 'R',
          ...(p['@_copyfrom-path'] && { copyFromPath: p['@_copyfrom-path'] }),
          ...(p['@_copyfrom-rev'] && {
            copyFromRev: parseInt(p['@_copyfrom-rev'], 10) || 0,
          }),
        })),
        ...(Object.keys(revisionProperties).length > 0 && { revisionProperties }),
      });
    }
  } catch (error) {
    parseError = error instanceof Error ? error.message : 'Failed to parse log XML';
  }

  const revisions = entries.map((entry) => entry.revision);
  return {
    entries,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0,
    ...(parseError && { parseError }),
  };
}
