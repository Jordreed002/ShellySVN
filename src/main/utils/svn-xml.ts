import { XMLParser } from 'fast-xml-parser';

const svnXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true,
});

export interface SvnStatusXmlEntry {
  path: string;
  item: string;
  revision?: number;
  author?: string;
}

export interface SvnInfoXmlSummary {
  url: string;
  revision: number;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
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
