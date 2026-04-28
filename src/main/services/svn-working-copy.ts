import type { SvnInfoResult, SvnStatusResult } from '@shared/types';
import { parseSvnInfoXml, parseSvnStatusXml } from '../svn/parsers';
import debug from '../utils/debug';
import { runSvnText } from './svn-executor';

const DEFAULT_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'].join(',');

export async function getStatus(path: string): Promise<SvnStatusResult> {
  try {
    const xml = await runSvnText(['status', '--xml', path]);
    return parseSvnStatusXml(xml, path);
  } catch (error) {
    debug.error('[SVN] Status error:', error);
    return { path, entries: [], revision: 0 };
  }
}

export async function getInfo(path: string): Promise<SvnInfoResult> {
  try {
    const xml = await runSvnText(['info', '--xml', path]);
    return parseSvnInfoXml(xml);
  } catch (error) {
    debug.error('[SVN] Info error:', error);
    throw error;
  }
}

export async function getInfoUrl(url: string): Promise<SvnInfoResult> {
  try {
    const xml = await runSvnText([
      'info',
      '--xml',
      '--non-interactive',
      '--trust-server-cert-failures',
      DEFAULT_SSL_FAILURES,
      url,
    ]);
    return parseSvnInfoXml(xml);
  } catch (error) {
    debug.error('[SVN] Info URL error:', error);
    throw error;
  }
}

export async function revert(paths: string[]): Promise<{ success: boolean }> {
  await runSvnText(['revert', ...paths]);
  return { success: true };
}

export async function add(paths: string[]): Promise<{ success: boolean }> {
  await runSvnText(['add', ...paths]);
  return { success: true };
}

export async function remove(paths: string[]): Promise<{ success: boolean }> {
  await runSvnText(['delete', ...paths]);
  return { success: true };
}

export async function cleanup(path: string): Promise<{ success: boolean }> {
  await runSvnText(['cleanup', path]);
  return { success: true };
}

export async function move(src: string, dst: string): Promise<{ success: boolean; output?: string }> {
  const output = await runSvnText(['move', src, dst]);
  return { success: true, output };
}

export async function rename(src: string, dst: string): Promise<{ success: boolean; output?: string }> {
  return move(src, dst);
}

