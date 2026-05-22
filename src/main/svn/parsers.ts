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
} from '@shared/types';
import {
  parseSvnBlameEntriesXml,
  parseSvnListEntriesXml,
} from '../utils/svn-xml';
import { debug } from '../utils/debug';

export { parseSvnLogXml, parseSvnStatusXml } from '@shared/svn-parsers';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true,
});

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
          'wc-info'?: { 'wcroot-abspath'?: string };
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

    const workingCopyRoot = entry['wc-info']?.['wcroot-abspath'] || entry['wcroot-abspath'];
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
      workingCopyRoot: workingCopyRoot || undefined,
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
    const recursiveSeparatorIndex = line.lastIndexOf(' - ');
    if (recursiveSeparatorIndex >= 0) {
      currentPath = line.slice(0, recursiveSeparatorIndex).trim();
      const parsed = parseExternalDef(line.slice(recursiveSeparatorIndex + 3).trim(), currentPath);
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
