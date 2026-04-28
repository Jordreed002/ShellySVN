import { XMLParser } from 'fast-xml-parser';

import type { SvnLockInfo } from '@shared/types';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getStore } from '../ipc/store';
import { parseSvnInfoXml } from '../svn/parsers';
import { debug } from '../utils/debug';
import { runSvnText } from './svn-executor';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true,
});

async function getHooksForWorkingCopy(workingCopyPath: string): Promise<HookScript[]> {
  try {
    const store = await getStore();
    const stored = await store.get<Record<string, HookScript[]>>('shellysvn:hook-scripts');
    if (stored && stored[workingCopyPath]) {
      return stored[workingCopyPath];
    }
  } catch (error) {
    debug.error('[SVN] Failed to get hooks (continuing without hooks):', error);
  }
  return [];
}

function getParentPath(path: string): string {
  const lastSepIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSepIndex >= 0 ? path.substring(0, lastSepIndex) : path;
}

export async function lock(path: string, message?: string): Promise<{ success: boolean; output?: string; error?: string }> {
  const workingCopyPath = getParentPath(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-lock', {
    workingCopyPath,
    files: [path],
    message,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-lock hook blocked' };
  }

  const args = ['lock'];
  if (message) args.push('-m', message);
  args.push(path);
  const output = await runSvnText(args);
  return { success: true, output };
}

export async function unlock(path: string, force?: boolean): Promise<{ success: boolean; output?: string; error?: string }> {
  const workingCopyPath = getParentPath(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-unlock', {
    workingCopyPath,
    files: [path],
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-unlock hook blocked' };
  }

  const args = ['unlock'];
  if (force) args.push('--force');
  args.push(path);
  const output = await runSvnText(args);
  return { success: true, output };
}

export async function getLockInfo(path: string): Promise<SvnLockInfo | null> {
  try {
    const xml = await runSvnText(['info', '--xml', path]);
    const info = parseSvnInfoXml(xml);
    return info.lock || null;
  } catch (error) {
    debug.error('[SVN] Lock info error:', error);
    return null;
  }
}

export async function forceLock(path: string, message?: string): Promise<{ success: boolean; lock?: SvnLockInfo; error?: string }> {
  const workingCopyPath = getParentPath(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-lock', {
    workingCopyPath,
    files: [path],
    message,
    force: true,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-lock hook blocked' };
  }

  try {
    const args = ['lock', '--force'];
    if (message) args.push('-m', message);
    args.push(path);
    await runSvnText(args);

    const xml = await runSvnText(['info', '--xml', path]);
    const info = parseSvnInfoXml(xml);

    return { success: true, lock: info.lock };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug.error('[SVN] Force lock error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

export async function forceUnlock(path: string): Promise<{ success: boolean; error?: string }> {
  const workingCopyPath = getParentPath(path);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const preResult = await executeHooksForType(hooks, 'pre-unlock', {
    workingCopyPath,
    files: [path],
    force: true,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-unlock hook blocked' };
  }

  try {
    await runSvnText(['unlock', '--force', path]);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug.error('[SVN] Force unlock error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

export async function listLocks(path: string): Promise<SvnLockInfo[]> {
  try {
    const xml = await runSvnText(['status', '--xml', path]);
    const locks: SvnLockInfo[] = [];

    const parsed = xmlParser.parse(xml) as {
      status?: {
        target?: {
          entry?:
            | Array<{
                '@_path': string;
                'wc-status'?: {
                  '@_item': string;
                  lock?: {
                    owner?: string;
                    comment?: string;
                    creationdate?: string;
                    token?: string;
                  };
                };
              }>
            | {
                '@_path': string;
                'wc-status'?: {
                  '@_item': string;
                  lock?: {
                    owner?: string;
                    comment?: string;
                    creationdate?: string;
                    token?: string;
                  };
                };
              };
        };
      };
    };

    const entries = parsed.status?.target?.entry;
    if (!entries) return [];

    const entriesArray = Array.isArray(entries) ? entries : [entries];

    for (const entry of entriesArray) {
      const wcStatus = entry['wc-status'];
      if (wcStatus?.lock) {
        locks.push({
          path: entry['@_path'] || '',
          owner: wcStatus.lock.owner || '',
          comment: wcStatus.lock.comment || '',
          date: wcStatus.lock.creationdate || '',
          token: wcStatus.lock.token,
        });
      }
    }

    return locks;
  } catch (error) {
    debug.error('[SVN] Lock list error:', error);
    return [];
  }
}
