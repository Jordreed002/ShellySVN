import { XMLParser } from 'fast-xml-parser';

const svnXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: false,
  parseTagValue: false,
  allowBooleanAttributes: true,
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
    const parsed = svnXmlParser.parse(xml) as {
      status?: {
        target?: {
          entry?:
            | Array<{
                '@_path'?: string;
                'wc-status'?: {
                  '@_item'?: string;
                  '@_revision'?: number;
                  commit?: {
                    '@_revision'?: number;
                    author?: string;
                  };
                };
                changelist?: string;
              }>
            | {
                '@_path'?: string;
                'wc-status'?: {
                  '@_item'?: string;
                  '@_revision'?: number;
                  commit?: {
                    '@_revision'?: number;
                    author?: string;
                  };
                };
                changelist?: string;
              };
        };
      };
    };

    return asArray(parsed.status?.target?.entry)
      .map((entry) => {
        const wcStatus = entry['wc-status'];
        if (!entry['@_path'] || !wcStatus?.['@_item']) {
          return null;
        }

        return {
          path: entry['@_path'],
          item: wcStatus['@_item'],
          revision: wcStatus.commit?.['@_revision'] ?? wcStatus['@_revision'],
          author: wcStatus.commit?.author,
          changelist: entry.changelist,
        };
      })
      .filter((entry): entry is SvnStatusXmlEntry => entry !== null);
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

    return asArray(parsed.lists?.list?.entry)
      .map((entry) => {
        if (!entry['@_kind'] || entry.name === undefined) {
          return null;
        }

        return {
          name: entry.name,
          kind: entry['@_kind'],
          size: optionalNumber(entry.size),
          revision: entry.commit?.['@_revision'] ?? 0,
          author: entry.commit?.author ?? '',
          date: entry.commit?.date ?? '',
        };
      })
      .filter((entry): entry is SvnListXmlEntry => entry !== null);
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
    const parsed = svnXmlParser.parse(xml) as {
      properties?: {
        target?: {
          property?:
            | Array<{
                '@_name'?: string;
                '#text'?: string;
              }>
            | {
                '@_name'?: string;
                '#text'?: string;
              };
        };
        property?:
          | Array<{
              '@_name'?: string;
              '#text'?: string;
            }>
          | {
              '@_name'?: string;
              '#text'?: string;
            };
      };
    };

    const propertyList = parsed.properties?.target?.property ?? parsed.properties?.property;

    return asArray(propertyList)
      .map((property) => {
        if (!property['@_name']) {
          return null;
        }

        return {
          name: property['@_name'],
          value: property['#text'] ?? '',
        };
      })
      .filter((property): property is SvnPropertyXmlEntry => property !== null);
  } catch {
    return [];
  }
}
