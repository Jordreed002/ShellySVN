import type { SvnBlameResult, SvnDiffResult, SvnLogResult } from '@shared/types';
import { parseSvnBlameXml, parseSvnDiff, parseSvnLogXml } from '../svn/parsers';
import { parseDiffStreaming } from '../utils/diff-parser';
import debug from '../utils/debug';
import { runSvnText } from './svn-executor';

export async function getLog(path: string, limit = 100): Promise<SvnLogResult> {
  try {
    const xml = await runSvnText(['log', '--xml', '-l', String(limit), path]);
    return parseSvnLogXml(xml);
  } catch (error) {
    debug.error('[SVN] Log error:', error);
    return { entries: [], startRevision: 0, endRevision: 0 };
  }
}

export async function getDiff(path: string, revision?: string): Promise<SvnDiffResult> {
  try {
    const args = ['diff'];
    if (revision) {
      args.push('-c', revision);
    }
    args.push(path);

    const output = await runSvnText(args);
    return parseSvnDiff(output);
  } catch (error) {
    debug.error('[SVN] Diff error:', error);
    return { files: [], hasChanges: false, rawDiff: (error as Error).message };
  }
}

export async function getDiffStreaming(path: string, revision?: string): Promise<SvnDiffResult> {
  try {
    const args = ['diff'];
    if (revision) {
      args.push('-c', revision);
    }
    args.push(path);

    const output = await runSvnText(args);
    if (output.includes('Cannot display: file marked as a binary type')) {
      return {
        files: [],
        hasChanges: true,
        isBinary: true,
        rawDiff: output,
      };
    }

    return await parseDiffStreaming(output);
  } catch (error) {
    debug.error('[SVN] Streaming diff error:', error);
    return { files: [], hasChanges: false, rawDiff: (error as Error).message };
  }
}

export async function getBlame(
  path: string,
  startRevision?: number,
  endRevision?: number
): Promise<SvnBlameResult> {
  try {
    const args = ['blame', '--xml', '-v'];
    if (startRevision !== undefined && endRevision !== undefined) {
      args.push('-r', `${startRevision}:${endRevision}`);
    }
    args.push(path);

    const xml = await runSvnText(args);
    return parseSvnBlameXml(xml, path);
  } catch (error) {
    debug.error('[SVN] Blame error:', error);
    return { path, lines: [], startRevision: 0, endRevision: 0 };
  }
}

