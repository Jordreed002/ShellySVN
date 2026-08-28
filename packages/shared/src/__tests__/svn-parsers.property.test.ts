import { describe, expect, it } from 'vitest';

import {
  forAll,
  genArray,
  genBoolean,
  genConstant,
  genInt,
  genMap,
  genOneOf,
  genOptional,
  genPick,
  genRecord,
  genUnicodeString,
} from '@test-utils/propertyCheck';

import { parseSvnLogXml, parseSvnStatusXml } from '../svn-parsers';

/*
 * Property tests for the hardened SVN XML parsers (item #130).
 *
 * Status entries and log entries are generated, serialized to XML (with full
 * entity escaping, including hostile-but-legal attribute characters), parsed
 * back, and compared field-by-field against the expected semantic values.
 */

/** Reference copy of the SVN item-name → status-char mapping. */
const ITEM_TO_CHAR: Record<string, string> = {
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

const ITEM_NAMES = Object.keys(ITEM_TO_CHAR);

/** XML-escape a string for use inside an attribute or text node. */
function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Unicode text usable as an XML attribute/text value that survives the
 * parser's `trimValues: true` untouched: no leading/trailing whitespace,
 * never empty, and never a bare strnum-convertible token ("true"/"123") by
 * always embedding a '/'-prefixed core.
 */
const genXmlText = (minLen = 1) =>
  genMap(genUnicodeString({ minLen, maxLen: minLen + 10 }), (raw) => {
    const trimmed = raw.trim();
    return `t/${trimmed === '' ? 'x' : trimmed}`;
  });

/** Plain non-empty text (element text like author/date/msg tails). */
const genTrimmedText = genMap(genUnicodeString({ minLen: 1, maxLen: 12 }), (raw) => {
  const trimmed = raw.trim();
  return trimmed === '' ? 'x' : trimmed;
});

/** Drop `undefined` properties so toStrictEqual can compare both sides. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner !== undefined) result[key] = inner;
  }
  return result as T;
}

/* ───────────────────────────── status XML ───────────────────────────── */

interface GeneratedCommit {
  revision: number;
  author: string;
  date: string;
}

const genCommit = genRecord({
  revision: genInt({ min: 1, max: 999999 }),
  author: genTrimmedText,
  date: genTrimmedText,
});

interface GeneratedStatusEntry {
  path: string;
  item: string;
  props?: string;
  switched: string;
  commit?: GeneratedCommit;
  hasTreeConflict: boolean;
  lock?: { owner: string; comment: string; creationdate: string };
  repos?: { item: string; props?: string; commit?: GeneratedCommit };
  changelist?: string;
}

const genStatusEntry = genRecord({
  path: genXmlText(2),
  item: genPick(ITEM_NAMES),
  props: genOptional(genPick(ITEM_NAMES), 0.3),
  switched: genPick(['true', 'false'] as const),
  commit: genOptional(genCommit, 0.6),
  hasTreeConflict: genBoolean(),
  lock: genOptional(
    genRecord({ owner: genTrimmedText, comment: genTrimmedText, creationdate: genTrimmedText }),
    0.25
  ),
  repos: genOptional(
    genRecord({
      item: genPick(ITEM_NAMES),
      props: genOptional(genPick(ITEM_NAMES), 0.3),
      commit: genOptional(genCommit, 0.5),
    }),
    0.3
  ),
  // BUG (reported, source not modified): a numeric or boolean-looking
  // changelist NAME attribute (e.g. name="5" or name="true") is strnum-
  // converted by fast-xml-parser and surfaces as number/boolean on
  // SvnStatusEntry.changelist despite the string type. The generator stays
  // in the string-typed domain with a "cl-" prefix that can never convert.
  changelist: genOptional(
    genMap(genTrimmedText, (name) => `cl-${name}`),
    0.3
  ),
});

function serializeStatusEntry(entry: GeneratedStatusEntry, indent: string): string {
  const attrs = [`path="${xmlEscape(entry.path)}"`];
  if (entry.props !== undefined) attrs.push(`props="${entry.props}"`);
  if (entry.switched === 'true') attrs.push('switched="true"');
  const wcStatus: string[] = [
    `<wc-status item="${entry.item}"${attrs.length > 1 ? ` ${attrs.slice(1).join(' ')}` : ''}`,
  ];
  let wcBody = '';
  if (entry.commit) {
    wcBody += `<commit revision="${entry.commit.revision}"><author>${xmlEscape(entry.commit.author)}</author><date>${xmlEscape(entry.commit.date)}</date></commit>`;
  }
  if (entry.lock) {
    wcBody += `<lock><owner>${xmlEscape(entry.lock.owner)}</owner><comment>${xmlEscape(entry.lock.comment)}</comment><creationdate>${xmlEscape(entry.lock.creationdate)}</creationdate></lock>`;
  }
  if (entry.hasTreeConflict) {
    wcBody +=
      '<tree-conflict operation="update" action="edited" reason="edited" type="directory"/>';
  }
  let reposXml = '';
  if (entry.repos) {
    let reposBody = '';
    if (entry.repos.commit) {
      reposBody += `<commit revision="${entry.repos.commit.revision}"><author>${xmlEscape(entry.repos.commit.author)}</author><date>${xmlEscape(entry.repos.commit.date)}</date></commit>`;
    }
    reposXml = `<repos-status item="${entry.repos.item}"${entry.repos.props !== undefined ? ` props="${entry.repos.props}"` : ''}>${reposBody}</repos-status>`;
  }
  return `${indent}<entry path="${xmlEscape(entry.path)}">${wcStatus.join(' ')}${wcBody ? `>${wcBody}</wc-status>` : '/>'}${reposXml}</entry>`;
}

function serializeStatusXml(entries: GeneratedStatusEntry[]): string {
  const direct = entries.filter((entry) => entry.changelist === undefined);
  const byChangelist = new Map<string, GeneratedStatusEntry[]>();
  for (const entry of entries) {
    if (entry.changelist === undefined) continue;
    const list = byChangelist.get(entry.changelist) ?? [];
    list.push(entry);
    byChangelist.set(entry.changelist, list);
  }
  const body = [
    ...direct.map((entry) => serializeStatusEntry(entry, '    ')),
    ...[...byChangelist.entries()].map(
      ([name, list]) =>
        `    <changelist name="${xmlEscape(name)}">\n${list
          .map((entry) => serializeStatusEntry(entry, '      '))
          .join('\n')}\n    </changelist>`
    ),
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<status>\n  <target path=".">\n${body}\n  </target>\n</status>`;
}

/** The semantic entry the parser must produce for a generated entry. */
function expectedStatusEntry(entry: GeneratedStatusEntry): Record<string, unknown> {
  const itemChar = ITEM_TO_CHAR[entry.item] ?? ' ';
  const propsChar = entry.props === undefined ? undefined : (ITEM_TO_CHAR[entry.props] ?? ' ');
  const propsStatus = propsChar === ' ' || propsChar === undefined ? undefined : propsChar;
  const remoteItemChar = entry.repos ? (ITEM_TO_CHAR[entry.repos.item] ?? ' ') : undefined;
  const remotePropsChar =
    entry.repos && entry.repos.props !== undefined
      ? (ITEM_TO_CHAR[entry.repos.props] ?? ' ')
      : undefined;
  return {
    path: entry.path,
    status: itemChar === 'C' || propsStatus === 'C' || entry.hasTreeConflict ? 'C' : itemChar,
    revision: entry.commit ? entry.commit.revision : undefined,
    author: entry.commit ? entry.commit.author : undefined,
    date: entry.commit ? entry.commit.date : undefined,
    isDirectory: false,
    propsStatus,
    remoteStatus: remoteItemChar,
    remotePropsStatus:
      remotePropsChar === ' ' || remotePropsChar === undefined ? undefined : remotePropsChar,
    remoteRevision: entry.repos?.commit ? entry.repos.commit.revision : undefined,
    remoteAuthor: entry.repos?.commit ? entry.repos.commit.author : undefined,
    remoteDate: entry.repos?.commit ? entry.repos.commit.date : undefined,
    changelist: entry.changelist,
    switched: entry.switched === 'true',
    lock: entry.lock
      ? {
          owner: entry.lock.owner,
          comment: entry.lock.comment,
          date: entry.lock.creationdate,
        }
      : undefined,
    treeConflict: entry.hasTreeConflict
      ? { operation: 'update', action: 'edited', reason: 'edited', type: 'directory' }
      : undefined,
  };
}

describe('parseSvnStatusXml properties', () => {
  it('recognizes the tree-conflicted attribute emitted by svn status --xml', () => {
    const result = parseSvnStatusXml(
      '<status><target path="C:/wc"><entry path="C:/wc/added"><wc-status item="added" props="normal" copied="true" tree-conflicted="true"/></entry></target></status>',
      'C:/wc'
    );

    expect(result.entries[0]).toMatchObject({
      path: 'C:/wc/added',
      status: 'C',
      treeConflict: {},
    });
  });

  it('round-trips generated status entries (semantic field equality)', () => {
    forAll(
      genArray(genStatusEntry, { min: 1, max: 8 }),
      (entries) => {
        const result = parseSvnStatusXml(serializeStatusXml(entries), '/wc');
        expect(result.path).toBe('/wc');
        expect(result.revision).toBe(0);
        expect(result.parseError).toBeUndefined();
        expect(result.entries).toHaveLength(entries.length);
        // The parser emits direct target entries first, then changelist
        // entries grouped in first-occurrence order of the changelist name.
        const changelists = new Map<string, GeneratedStatusEntry[]>();
        for (const entry of entries) {
          if (entry.changelist === undefined) continue;
          const list = changelists.get(entry.changelist) ?? [];
          list.push(entry);
          changelists.set(entry.changelist, list);
        }
        const orderedEntries = [
          ...entries.filter((entry) => entry.changelist === undefined),
          ...[...changelists.values()].flat(),
        ];
        const expected = orderedEntries.map((entry) => stripUndefined(expectedStatusEntry(entry)));
        const actual = result.entries.map((entry) =>
          stripUndefined(entry as Record<string, unknown>)
        );
        expect(actual).toStrictEqual(expected);
        const anyRemote = entries.some((entry) => entry.repos !== undefined);
        expect(result.remoteChecked).toBe(anyRemote);
        return true;
      },
      { runs: 120 }
    );
  });

  it('returns an empty result for XML without a target element', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 20 }),
      (filler) => {
        const result = parseSvnStatusXml(`<status>${filler}</status>`, '/wc');
        expect(result.entries).toEqual([]);
        expect(result.path).toBe('/wc');
        return true;
      },
      { runs: 50 }
    );
  });

  it('never throws on hostile unicode input', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 60 }),
      (hostile) => {
        expect(() => parseSvnStatusXml(hostile, '/wc')).not.toThrow();
        const result = parseSvnStatusXml(hostile, '/wc');
        return Array.isArray(result.entries);
      },
      { runs: 200 }
    );
  });
});

/* ────────────────────────────── log XML ────────────────────────────── */

interface GeneratedLogPath {
  action: 'A' | 'D' | 'M' | 'R';
  text: string;
  copyFromPath?: string;
  copyFromRev?: number;
}

const genLogPath = genRecord({
  action: genPick(['A', 'D', 'M', 'R'] as const),
  text: genXmlText(1),
  copyFromPath: genOptional(genXmlText(1), 0.4),
  copyFromRev: genOptional(genInt({ min: 1, max: 99999 }), 0.4),
});

interface GeneratedLogEntry {
  revision: number;
  author?: string;
  date: string;
  message: string;
  paths: GeneratedLogPath[];
  revprops?: Array<{ name: string; value: string }>;
}

const genLogEntry = genRecord({
  revision: genInt({ min: 1, max: 99999 }),
  author: genOptional(genTrimmedText, 0.15),
  date: genTrimmedText,
  message: genOneOf(
    genConstant(''),
    genMap(genUnicodeString({ minLen: 1, maxLen: 30 }), (raw) => raw.trim() || 'msg')
  ),
  paths: genArray(genLogPath, { min: 0, max: 5 }),
  revprops: genOptional(
    genArray(
      genRecord({
        name: genXmlText(1),
        value: genMap(genUnicodeString({ minLen: 0, maxLen: 10 }), (raw) => raw.trim()),
      }),
      { min: 1, max: 3 }
    ),
    0.3
  ),
});

function serializeLogEntry(entry: GeneratedLogEntry): string {
  let body = '';
  if (entry.author !== undefined) body += `<author>${xmlEscape(entry.author)}</author>`;
  body += `<date>${xmlEscape(entry.date)}</date>`;
  body += `<msg>${xmlEscape(entry.message)}</msg>`;
  if (entry.paths.length > 0) {
    body += `<paths>${entry.paths
      .map((path) => {
        const attrs = [`action="${path.action}"`];
        if (path.copyFromPath !== undefined)
          attrs.push(`copyfrom-path="${xmlEscape(path.copyFromPath)}"`);
        if (path.copyFromRev !== undefined) attrs.push(`copyfrom-rev="${path.copyFromRev}"`);
        return `<path ${attrs.join(' ')}>${xmlEscape(path.text)}</path>`;
      })
      .join('')}</paths>`;
  }
  if (entry.revprops !== undefined && entry.revprops.length > 0) {
    body += `<revprops>${entry.revprops
      .map((prop) => `<property name="${xmlEscape(prop.name)}">${xmlEscape(prop.value)}</property>`)
      .join('')}</revprops>`;
  }
  return `  <logentry revision="${entry.revision}">${body}</logentry>`;
}

describe('parseSvnLogXml properties', () => {
  it('round-trips generated log entries (copyfrom, hostile attribute chars, revprops)', () => {
    forAll(
      genArray(genLogEntry, { min: 1, max: 6 }),
      (entries) => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<log>\n${entries
          .map(serializeLogEntry)
          .join('\n')}\n</log>`;
        const result = parseSvnLogXml(xml);
        expect(result.parseError).toBeUndefined();
        expect(result.entries).toHaveLength(entries.length);
        expect(result.startRevision).toBe(Math.min(...entries.map((entry) => entry.revision)));
        expect(result.endRevision).toBe(Math.max(...entries.map((entry) => entry.revision)));

        entries.forEach((entry, index) => {
          const parsed = result.entries[index];
          expect(parsed.revision).toBe(entry.revision);
          expect(parsed.author).toBe(entry.author ?? 'unknown');
          expect(parsed.date).toBe(entry.date);
          expect(parsed.message).toBe(entry.message);
          expect(parsed.paths).toHaveLength(entry.paths.length);
          entry.paths.forEach((path, pathIndex) => {
            expect(parsed.paths[pathIndex]).toStrictEqual({
              path: path.text,
              action: path.action,
              ...(path.copyFromPath !== undefined && { copyFromPath: path.copyFromPath }),
              ...(path.copyFromRev !== undefined && { copyFromRev: path.copyFromRev }),
            });
          });
          if (entry.revprops !== undefined && entry.revprops.length > 0) {
            expect(parsed.revisionProperties).toStrictEqual(
              Object.fromEntries(entry.revprops.map((prop) => [prop.name, prop.value]))
            );
          } else {
            expect(parsed.revisionProperties).toBeUndefined();
          }
        });
        return true;
      },
      { runs: 120 }
    );
  });

  it('returns an empty result for XML without logentry elements', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 20 }),
      (filler) => {
        const result = parseSvnLogXml(`<log>${filler}</log>`);
        expect(result.entries).toEqual([]);
        expect(result.startRevision).toBe(0);
        expect(result.endRevision).toBe(0);
        return true;
      },
      { runs: 50 }
    );
  });

  it('never throws on hostile unicode input', () => {
    forAll(
      genUnicodeString({ minLen: 0, maxLen: 60 }),
      (hostile) => {
        expect(() => parseSvnLogXml(hostile)).not.toThrow();
        const result = parseSvnLogXml(hostile);
        return Array.isArray(result.entries);
      },
      { runs: 200 }
    );
  });
});
