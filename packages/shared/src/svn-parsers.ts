import { XMLParser } from 'fast-xml-parser';
import type { SvnLogResult, SvnStatusChar, SvnStatusResult } from './types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true,
});

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
    const parsed = xmlParser.parse(xml) as {
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

    const entriesArray = [
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

      entries.push({
        path: entry['@_path'] || '',
        status: mapSvnStatus(wcStatus['@_item']),
        revision: wcStatus.commit?.['@_revision']
          ? parseInt(wcStatus.commit['@_revision'], 10)
          : undefined,
        author: wcStatus.commit?.author,
        date: wcStatus.commit?.date,
        isDirectory: false,
        propsStatus: mapPropsStatus(wcStatus['@_props']),
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
        treeConflict: wcStatus['tree-conflict']
          ? {
              operation: wcStatus['tree-conflict']['@_operation'],
              action: wcStatus['tree-conflict']['@_action'],
              reason: wcStatus['tree-conflict']['@_reason'],
              type: wcStatus['tree-conflict']['@_type'],
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
    const parsed = xmlParser.parse(xml) as {
      log?: {
        logentry?:
          | Array<{
              '@_revision': string;
              author?: string;
              date?: string;
              msg?: string;
              paths?: { path?: Array<Record<string, string>> | Record<string, string> };
            }>
          | {
              '@_revision': string;
              author?: string;
              date?: string;
              msg?: string;
              paths?: { path?: Array<Record<string, string>> | Record<string, string> };
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

      entries.push({
        revision: parseInt(entry['@_revision'], 10) || 0,
        author: entry.author || 'unknown',
        date: entry.date || '',
        message: entry.msg || '',
        paths: pathList.map((p) => ({
          path: p['#text'] || '',
          action: (p['@_action'] || '') as 'A' | 'D' | 'M' | 'R',
          kind: p['@_kind'] || '',
        })),
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
