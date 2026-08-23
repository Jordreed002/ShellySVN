import type { X2jOptions, XMLParser } from 'fast-xml-parser';
import { XMLParser as FxpXMLParser } from 'fast-xml-parser';
import {
  SVN_XML_LIMITS,
  SvnXmlInputError,
  decodeSvnXmlEntities,
  parseSvnXmlWithGuards,
} from '@shared/svn-parsers';

/**
 * Hardened XML parser factory for every fast-xml-parser call site in the
 * main process. All SVN CLI XML must go through here (or through
 * `@shared/svn-parsers`, which shares the same guard implementation).
 *
 * Security properties:
 * - `processEntities: false` is forced regardless of the options passed:
 *   fast-xml-parser never resolves external entities by design, and with
 *   entity processing off, DOCTYPE/ENTITY declarations (billion laughs,
 *   quadratic blowup) stay inert text. The well-known five XML entities are
 *   decoded afterwards by the shared sanitizer, so benign `&amp;`-style
 *   values decode exactly as before.
 * - Input guards (shared `parseSvnXmlWithGuards`): max total size, null-byte
 *   rejection, and a nesting depth pre-scan — see SVN_XML_LIMITS for the
 *   rationale vs 100k-file working copies.
 * - Post-parse walk: caps attribute values/text nodes and decodes entities.
 *
 * Guard violations throw {@link SvnXmlInputError}; every existing call site
 * already wraps `parse` in try/catch and maps failures to its established
 * error shape, so hostile input degrades to a controlled error, never a
 * crash.
 */
export type SvnXmlParserOptions = Omit<
  X2jOptions,
  'processEntities' | 'ignoreAttributes' | 'textNodeName' | 'parseTagValue'
>;

export interface SvnXmlParser {
  parse<T = unknown>(xml: string): T;
}

export function createSvnXmlParser(options: SvnXmlParserOptions = {}): SvnXmlParser {
  const parser: XMLParser = new FxpXMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    allowBooleanAttributes: true,
    ...options,
    // Forced last: entity expansion can never be re-enabled by a call site.
    processEntities: false,
  });

  return {
    parse<T = unknown>(xml: string): T {
      return parseSvnXmlWithGuards(parser, xml) as T;
    },
  };
}

export { SVN_XML_LIMITS, SvnXmlInputError, decodeSvnXmlEntities };

const svnXmlParser = createSvnXmlParser({
  parseAttributeValue: true,
  trimValues: false,
});

export interface SvnStatusXmlEntry {
  path: string;
  item: string;
  revision?: number;
  author?: string;
  changelist?: string;
}

export interface SvnInfoXmlSummary {
  url: string;
  revision: number;
}

export interface SvnBlameXmlLine {
  lineNumber: number;
  revision: number;
  author: string;
  date: string;
  content: string;
}

export interface SvnListXmlEntry {
  name: string;
  kind: 'file' | 'dir';
  size?: number;
  revision: number;
  author: string;
  date: string;
}

export interface SvnShelveXmlEntry {
  name: string;
  path: string;
  date: string;
}

export interface SvnPropertyXmlEntry {
  name: string;
  value: string;
  inherited?: boolean;
  inheritedFrom?: string;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function optionalNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseSvnStatusEntriesXml(xml: string): SvnStatusXmlEntry[] {
  try {
    type StatusEntry = {
      '@_path'?: string;
      'wc-status'?: {
        '@_item'?: string;
        '@_revision'?: number;
        commit?: { '@_revision'?: number; author?: string };
      };
      changelist?: string;
    };
    const parsed = svnXmlParser.parse(xml) as {
      status?: {
        target?: {
          entry?: StatusEntry | StatusEntry[];
          changelist?:
            | { '@_name'?: string; entry?: StatusEntry | StatusEntry[] }
            | Array<{ '@_name'?: string; entry?: StatusEntry | StatusEntry[] }>;
        };
        changelist?:
          | { '@_name'?: string; entry?: StatusEntry | StatusEntry[] }
          | Array<{ '@_name'?: string; entry?: StatusEntry | StatusEntry[] }>;
      };
    };

    const target = parsed.status?.target;
    const entries: Array<{ entry: StatusEntry; changelist?: string }> = asArray(target?.entry).map(
      (entry) => ({ entry })
    );
    for (const changelist of [
      ...asArray(target?.changelist),
      ...asArray(parsed.status?.changelist),
    ]) {
      entries.push(
        ...asArray(changelist.entry).map((entry) => ({
          entry,
          changelist: changelist['@_name'],
        }))
      );
    }

    const results: SvnStatusXmlEntry[] = [];
    for (const { entry, changelist } of entries) {
      const wcStatus = entry['wc-status'];
      if (entry['@_path'] && wcStatus?.['@_item']) {
        results.push({
          path: entry['@_path'],
          item: wcStatus['@_item'],
          revision: wcStatus.commit?.['@_revision'] ?? wcStatus['@_revision'],
          author: wcStatus.commit?.author,
          changelist: changelist ?? entry.changelist,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function parseSvnInfoSummaryXml(xml: string): SvnInfoXmlSummary | null {
  try {
    const parsed = svnXmlParser.parse(xml) as {
      info?: {
        entry?: {
          '@_revision'?: number;
          url?: string;
        };
      };
    };

    const entry = parsed.info?.entry;
    if (!entry) {
      return null;
    }

    return {
      url: entry.url ?? '',
      revision: entry['@_revision'] ?? 0,
    };
  } catch {
    return null;
  }
}

export function parseSvnBlameEntriesXml(xml: string): SvnBlameXmlLine[] {
  try {
    const parsed = svnXmlParser.parse(xml) as {
      blame?: {
        target?: {
          entry?:
            | Array<{
                '@_line-number'?: number;
                commit?: {
                  '@_revision'?: number;
                  author?: string;
                  date?: string;
                };
                text?: string;
              }>
            | {
                '@_line-number'?: number;
                commit?: {
                  '@_revision'?: number;
                  author?: string;
                  date?: string;
                };
                text?: string;
              };
        };
      };
    };

    return asArray(parsed.blame?.target?.entry)
      .map((entry) => {
        const lineNumber = entry['@_line-number'];
        if (typeof lineNumber !== 'number') {
          return null;
        }

        return {
          lineNumber,
          revision: entry.commit?.['@_revision'] ?? 0,
          author: entry.commit?.author ?? 'unknown',
          date: entry.commit?.date ?? '',
          content: entry.text ?? '',
        };
      })
      .filter((entry): entry is SvnBlameXmlLine => entry !== null);
  } catch {
    return [];
  }
}

export function parseSvnListEntriesXml(xml: string): SvnListXmlEntry[] {
  try {
    const parsed = svnXmlParser.parse(xml) as {
      lists?: {
        list?: {
          entry?:
            | Array<{
                '@_kind'?: 'file' | 'dir';
                name?: string;
                size?: number | string;
                commit?: {
                  '@_revision'?: number;
                  author?: string;
                  date?: string;
                };
              }>
            | {
                '@_kind'?: 'file' | 'dir';
                name?: string;
                size?: number | string;
                commit?: {
                  '@_revision'?: number;
                  author?: string;
                  date?: string;
                };
              };
        };
      };
    };

    const results: SvnListXmlEntry[] = [];
    for (const entry of asArray(parsed.lists?.list?.entry)) {
      if (entry['@_kind'] && entry.name !== undefined) {
        results.push({
          name: entry.name,
          kind: entry['@_kind'],
          size: optionalNumber(entry.size),
          revision: entry.commit?.['@_revision'] ?? 0,
          author: entry.commit?.author ?? '',
          date: entry.commit?.date ?? '',
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function parseSvnShelvesXml(xml: string): SvnShelveXmlEntry[] {
  try {
    const parsed = svnXmlParser.parse(xml) as {
      shelves?: {
        shelf?:
          | Array<{
              '@_name'?: string;
              path?: string;
              date?: string;
            }>
          | {
              '@_name'?: string;
              path?: string;
              date?: string;
            };
      };
    };

    return asArray(parsed.shelves?.shelf)
      .map((shelf) => {
        if (!shelf['@_name']) {
          return null;
        }

        return {
          name: shelf['@_name'],
          path: shelf.path ?? '',
          date: shelf.date ?? '',
        };
      })
      .filter((shelf): shelf is SvnShelveXmlEntry => shelf !== null);
  } catch {
    return [];
  }
}

export function parseSvnPropertiesXml(xml: string): SvnPropertyXmlEntry[] {
  try {
    interface PropertyNode {
      '@_name'?: string;
      '#text'?: string;
    }
    interface PropertyTarget {
      '@_path'?: string;
      property?: PropertyNode | PropertyNode[];
      inherited_property?: PropertyNode | PropertyNode[];
    }
    const parsed = svnXmlParser.parse(xml) as {
      properties?: {
        target?: PropertyTarget | PropertyTarget[];
        property?: PropertyNode | PropertyNode[];
      };
    };

    const mapProperties = (
      properties: PropertyNode | PropertyNode[] | undefined,
      inheritedFrom?: string
    ): SvnPropertyXmlEntry[] =>
      asArray(properties).flatMap((property) => {
        if (!property['@_name']) {
          return [];
        }

        return [
          {
            name: property['@_name'],
            value: property['#text'] ?? '',
            ...(inheritedFrom ? { inherited: true, inheritedFrom } : {}),
          },
        ];
      });

    const targets = asArray(parsed.properties?.target);
    if (targets.length === 0) {
      return mapProperties(parsed.properties?.property);
    }

    return targets.flatMap((target) => [
      ...mapProperties(target.property),
      ...mapProperties(target.inherited_property, target['@_path']),
    ]);
  } catch {
    return [];
  }
}
