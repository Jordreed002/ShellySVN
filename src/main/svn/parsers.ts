import { XMLParser } from 'fast-xml-parser';
import type {
  SvnBlameResult,
  SvnChildCommitInfo,
  SvnDiffFile,
  SvnDiffHunk,
  SvnDiffResult,
  SvnExternal,
  SvnInfoResult,
  SvnListResult,
  SvnLockInfo,
} from '@shared/types';
import { parseSvnBlameEntriesXml, parseSvnListEntriesXml } from '../utils/svn-xml';
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
          '@_kind'?: 'file' | 'dir';
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
      nodeKind: entry['@_kind'] === 'file' ? 'file' : 'dir',
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

export type ChildCommitInfo = SvnChildCommitInfo;

/**
 * Parse `svn info --xml --depth immediates <dir>` into a map of child name ->
 * last-commit info. The directory's own entry is skipped.
 *
 * Children excluded from the checkout are kept even though they carry no
 * `<commit>` element: they are absent from disk, so this listing is the only
 * offline evidence that they belong to the working copy at all.
 */
export function parseSvnChildCommitsXml(
  xml: string,
  dirPath: string
): Record<string, ChildCommitInfo> {
  const result: Record<string, ChildCommitInfo> = {};
  const basename = (p: string) =>
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || '';
  const dirName = basename(dirPath);

  try {
    const parsed = xmlParser.parse(xml) as {
      info?: {
        entry?: Array<Record<string, unknown>> | Record<string, unknown>;
      };
    };
    const rawEntries = parsed.info?.entry;
    if (!rawEntries) return result;
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

    for (const entry of entries) {
      const entryPath = String((entry as { '@_path'?: unknown })['@_path'] ?? '');
      const name = basename(entryPath);
      if (!name || name === dirName || name === '.') continue;
      const commit = (
        entry as { commit?: { '@_revision'?: unknown; author?: unknown; date?: unknown } }
      ).commit;
      const depth = (entry as { 'wc-info'?: { depth?: unknown } })['wc-info']?.depth;
      const excluded = String(depth ?? '') === 'exclude';
      if (!commit && !excluded) continue;
      result[name] = {
        revision: commit?.['@_revision'] ? parseInt(String(commit['@_revision']), 10) : 0,
        author: commit?.author ? String(commit.author) : '',
        date: commit?.date ? String(commit.date) : '',
        ...(excluded
          ? {
              excluded: true,
              url: String((entry as { url?: unknown }).url ?? ''),
              kind:
                String((entry as { '@_kind'?: unknown })['@_kind'] ?? '') === 'file'
                  ? ('file' as const)
                  : ('dir' as const),
            }
          : {}),
      };
    }
  } catch (error) {
    debug.error('[SVN] Failed to parse child commits XML:', error);
  }

  return result;
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
  if (!def.trim() || def.trimStart().startsWith('#')) return null;
  const parts = tokenizeExternalDef(def);
  if (parts.length < 2) return null;

  let revision: number | undefined;
  let definitionIndex = 0;
  const readRevision = (index: number): number | undefined => {
    const compact = /^(?:-r|--revision=)(\d+)$/.exec(parts[index] || '');
    if (compact) return Number(compact[1]);
    if (
      (parts[index] === '-r' || parts[index] === '--revision') &&
      /^\d+$/.test(parts[index + 1] || '')
    ) {
      return Number(parts[index + 1]);
    }
    return undefined;
  };

  revision = readRevision(0);
  if (revision !== undefined)
    definitionIndex = parts[0] === '-r' || parts[0] === '--revision' ? 2 : 1;
  if (parts.length - definitionIndex < 2) return null;

  const first = parts[definitionIndex];
  const newSyntax = /^(?:\^\/|\.\.?\/|\/|https?:\/\/|svn(?:\+ssh)?:\/\/|file:\/\/)/i.test(first);
  const localPath = newSyntax ? parts[parts.length - 1] : first;
  const url = newSyntax ? first : parts[parts.length - 1];
  if (!newSyntax) {
    for (let index = definitionIndex + 1; index < parts.length - 1; index += 1) {
      revision ??= readRevision(index);
    }
  }
  return { name: localPath, url, path: basePath + '/' + localPath, revision };
}

function tokenizeExternalDef(value: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  const source = value.trim();

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      token += character;
      escaped = false;
    } else if (
      character === '\\' &&
      quote &&
      (source[index + 1] === quote || source[index + 1] === '\\')
    ) {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}
