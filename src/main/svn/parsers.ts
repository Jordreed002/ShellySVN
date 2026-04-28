import { XMLParser } from 'fast-xml-parser';
import type {
  SvnBlameResult,
  SvnDiffFile,
  SvnDiffHunk,
  SvnDiffResult,
  SvnExternal,
  SvnInfoResult,
  SvnListResult,
  SvnLockInfo,
  SvnLogResult,
  SvnStatusResult,
} from '@shared/types';
import {
  parseSvnBlameEntriesXml,
  parseSvnListEntriesXml,
} from '../utils/svn-xml';
import { debug } from '../utils/debug';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true,
});

const SVN_STATUS_MAP: Record<string, SvnStatusResult['entries'][0]['status']> = {
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

function mapSvnStatus(status?: string): SvnStatusResult['entries'][0]['status'] {
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

export function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  const entries: SvnStatusResult['entries'] = [];

  try {
    const parsed = xmlParser.parse(xml) as {
      status?: {
        target?: {
          entry?:
            | Array<{
                '@_path': string;
                'wc-status'?: {
                  '@_item': string;
                  '@_props'?: string;
                  '@_revision'?: string;
                  '@_switched'?: boolean | string;
                  commit?: { '@_revision': string; author?: string; date?: string };
                  lock?: { owner?: string; comment?: string; creationdate?: string };
                };
              }>
            | {
                '@_path': string;
                'wc-status'?: {
                  '@_item': string;
                  '@_props'?: string;
                  '@_revision'?: string;
                  '@_switched'?: boolean | string;
                  commit?: { '@_revision': string; author?: string; date?: string };
                  lock?: { owner?: string; comment?: string; creationdate?: string };
                };
              };
        };
      };
    };

    const entryList = parsed.status?.target?.entry;
    if (!entryList) {
      return { path: basePath, entries: [], revision: 0 };
    }

    const entriesArray = Array.isArray(entryList) ? entryList : [entryList];
    for (const entry of entriesArray) {
      const wcStatus = entry['wc-status'];
      if (!wcStatus) continue;

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
        switched: parseBooleanAttribute(wcStatus['@_switched']),
        lock: wcStatus.lock
          ? {
              owner: wcStatus.lock.owner || '',
              comment: wcStatus.lock.comment || '',
              date: wcStatus.lock.creationdate || '',
            }
          : undefined,
      });
    }
  } catch (error) {
    debug.error('[SVN] Failed to parse status XML:', error);
    return {
      path: basePath,
      entries,
      revision: 0,
      parseError: error instanceof Error ? error.message : 'Failed to parse status XML',
    };
  }

  return { path: basePath, entries, revision: 0 };
}

export function parseSvnInfoXml(xml: string): SvnInfoResult {
  try {
    const parsed = xmlParser.parse(xml) as {
      info?: {
        entry?: {
          '@_path'?: string;
          '@_revision'?: string;
          url?: string;
          repository?: { root?: string; uuid?: string };
          commit?: { '@_revision'?: string; author?: string; date?: string };
          lock?: { owner?: string; comment?: string; creationdate?: string; token?: string };
          'wcroot-abspath'?: string;
        };
      };
    };

    const entry = parsed.info?.entry;
    if (!entry) {
      return {
        path: '',
        url: '',
        repositoryRoot: '',
        repositoryUuid: '',
        revision: 0,
        nodeKind: 'dir',
        lastChangedAuthor: '',
        lastChangedRevision: 0,
        lastChangedDate: '',
        workingCopyRoot: undefined,
      };
    }

    const lockInfo: SvnLockInfo | undefined = entry.lock
      ? {
          path: entry['@_path'] || '',
          owner: entry.lock.owner || '',
          comment: entry.lock.comment || '',
          date: entry.lock.creationdate || '',
          token: entry.lock.token,
        }
      : undefined;

    return {
      path: entry['@_path'] || '',
      url: entry.url || '',
      repositoryRoot: entry.repository?.root || '',
      repositoryUuid: entry.repository?.uuid || '',
      revision: entry['@_revision'] ? parseInt(entry['@_revision'], 10) : 0,
      nodeKind: 'dir',
      lastChangedAuthor: entry.commit?.author || '',
      lastChangedRevision: entry.commit?.['@_revision']
        ? parseInt(entry.commit['@_revision'], 10)
        : 0,
      lastChangedDate: entry.commit?.date || '',
      workingCopyRoot: entry['wcroot-abspath'] || undefined,
      lock: lockInfo,
    };
  } catch (error) {
    debug.error('[SVN] Failed to parse info XML:', error);
    return {
      path: '',
      url: '',
      repositoryRoot: '',
      repositoryUuid: '',
      revision: 0,
      nodeKind: 'dir',
      lastChangedAuthor: '',
      lastChangedRevision: 0,
      lastChangedDate: '',
      parseError: error instanceof Error ? error.message : 'Failed to parse info XML',
    };
  }
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
    debug.error('[SVN] Failed to parse log XML:', error);
    parseError = error instanceof Error ? error.message : 'Failed to parse log XML';
  }

  const revisions = entries.map((e) => e.revision);
  return {
    entries,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0,
    ...(parseError && { parseError }),
  };
}

export function parseSvnDiff(diffOutput: string): SvnDiffResult {
  if (!diffOutput || diffOutput.trim() === '') {
    return { files: [], hasChanges: false };
  }

  if (diffOutput.includes('Cannot display: file marked as a binary type')) {
    return { files: [], hasChanges: true, isBinary: true, rawDiff: diffOutput };
  }

  const files: SvnDiffFile[] = [];
  const lines = diffOutput.split('\n');
  let currentFile: SvnDiffFile | null = null;
  let currentHunk: SvnDiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith('Index: ')) {
      if (currentFile && currentHunk) currentFile.hunks.push(currentHunk);
      if (currentFile) files.push(currentFile);
      currentFile = { oldPath: '', newPath: '', hunks: [] };
      currentHunk = null;
      continue;
    }
    if (line.startsWith('=======')) continue;
    if (line.startsWith('--- ')) {
      if (currentFile) currentFile.oldPath = line.substring(4).trim();
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (currentFile) currentFile.newPath = line.substring(4).trim();
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [{ type: 'hunk', content: line }],
      };
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;
    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'added', content: line, newLineNumber: newLineNum++ });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'removed', content: line, oldLineNumber: oldLineNum++ });
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({
        type: 'context',
        content: line,
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      });
    }
  }

  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);
  return { files, hasChanges: files.length > 0 };
}

export function parseSvnBlameXml(xml: string, path: string): SvnBlameResult {
  const lines = parseSvnBlameEntriesXml(xml);
  const revisions = lines.map((l) => l.revision).filter((r) => r > 0);

  return {
    path,
    lines,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0,
  };
}

export function parseSvnListXml(xml: string, baseUrl: string): SvnListResult {
  const entries: SvnListResult['entries'] = [];

  for (const entry of parseSvnListEntriesXml(xml)) {
    const cleanName = entry.name.replace(/\/$/, '');
    entries.push({
      name: entry.name,
      path: baseUrl + '/' + cleanName,
      url: baseUrl + '/' + cleanName,
      kind: entry.kind,
      size: entry.size,
      revision: entry.revision,
      author: entry.author,
      date: entry.date,
    });
  }

  return { path: baseUrl, entries };
}

export function parseSvnExternals(output: string, basePath: string): SvnExternal[] {
  const externals: SvnExternal[] = [];
  const lines = output.split('\n').filter((l) => l.trim());
  let currentPath = basePath;

  for (const line of lines) {
    const pathMatch = line.match(/^(.+?)\s*-\s*(.+)$/);
    if (pathMatch) {
      currentPath = pathMatch[1].trim();
      const parsed = parseExternalDef(pathMatch[2].trim(), currentPath);
      if (parsed) externals.push(parsed);
    } else if (line.trim()) {
      const parsed = parseExternalDef(line.trim(), currentPath);
      if (parsed) externals.push(parsed);
    }
  }

  return externals;
}

function parseExternalDef(def: string, basePath: string): SvnExternal | null {
  let revision: number | undefined;
  let remaining = def;
  const revMatch = remaining.match(/^-r(\d+)\s*/);
  if (revMatch) {
    revision = parseInt(revMatch[1], 10);
    remaining = remaining.substring(revMatch[0].length);
  }

  const parts = remaining.trim().split(/\s+/);
  if (parts.length < 1) return null;

  const url = parts[0];
  const localPath = parts.length > 1 ? parts[parts.length - 1] : url.split('/').pop() || 'external';
  return { name: localPath, url, path: basePath + '/' + localPath, revision };
}
