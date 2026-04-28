import { existsSync, mkdirSync } from 'fs';
import { dirname, join, relative } from 'path';

import type { SvnInfoResult, SvnStatusResult, UpdateOptions } from '@shared/types';
import { getAuthCache } from '../auth-cache';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getStore } from '../ipc/store';
import { parseSvnInfoXml, parseSvnStatusXml } from '../svn/parsers';
import { debug } from '../utils/debug';
import { runSvnText } from './svn-executor';

const DEFAULT_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'].join(',');

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

function parseUpdatedRevision(output: string): number {
  const match = output.match(/Updated to revision (\d+)\./);
  return match ? parseInt(match[1], 10) : 0;
}

export async function getWorkingCopyContext(
  localPath: string
): Promise<{ workingCopyRoot: string; repositoryRoot: string; url: string } | null> {
  let currentPath = localPath;

  for (let attempts = 0; attempts < 50; attempts++) {
    const svnDir = join(currentPath, '.svn');
    if (existsSync(svnDir)) {
      try {
        const xml = await runSvnText(['info', '--xml', currentPath]);
        const info = parseSvnInfoXml(xml);

        if (info.workingCopyRoot && info.repositoryRoot && info.url) {
          const relativePath = localPath.slice(currentPath.length);
          return {
            workingCopyRoot: info.workingCopyRoot,
            repositoryRoot: info.repositoryRoot,
            url: info.url + relativePath.split(/[/\\]/).join('/'),
          };
        }
      } catch {}
    }

    const parent = dirname(currentPath);
    if (parent === currentPath) break;
    currentPath = parent;
  }

  return null;
}

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

export async function update(
  path: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: UpdateOptions
): Promise<{ success: boolean; revision?: number; error?: string }> {
  try {
    await runSvnText(['info', '--xml', path], { cwd: path, trustSslFailures: true });
  } catch (error) {
    const errorMsg = (error as Error).message || '';
    debug.error('[SVN] Working copy validation failed for update:', path, errorMsg);
    return {
      success: false,
      error:
        'Not a valid working copy. The selected path is not under SVN version control. ' +
        'Make sure you have checked out the repository and the .svn directory exists.',
    };
  }

  const hooks = await getHooksForWorkingCopy(path);
  const preResult = await executeHooksForType(hooks, 'pre-update', {
    workingCopyPath: path,
  });
  if (!preResult.allSucceeded) {
    return { success: false, error: preResult.error || 'Pre-update hook blocked' };
  }

  try {
    const args = ['update'];
    const revision = options?.revision?.trim();
    if (revision && revision.toUpperCase() !== 'HEAD') {
      args.push('-r', revision);
    }
    if (depth) args.push('--depth', depth);
    if (options?.ignoreExternals) args.push('--ignore-externals');
    if (options?.force) args.push('--force');
    args.push(path);

    const output = await runSvnText(args, { trustSslFailures: true });
    const result = {
      success: true,
      revision: parseUpdatedRevision(output),
    };

    executeHooksForType(hooks, 'post-update', {
      workingCopyPath: path,
      revision: result.revision,
    }).catch((err) => debug.error('[SVN] Post-update hook error:', err));

    return result;
  } catch (error) {
    const errorMsg = (error as Error).message || '';
    debug.error('[SVN] Update failed:', path, errorMsg);

    if (errorMsg.includes('E155007')) {
      return {
        success: false,
        error: 'Not a working copy. The selected path is not under SVN version control.',
      };
    }
    if (errorMsg.includes('E155004')) {
      return {
        success: false,
        error: 'Working copy is locked. Try running "Cleanup" from the toolbar to resolve this issue.',
      };
    }
    if (errorMsg.includes('E155036')) {
      return {
        success: false,
        error:
          'Working copy format is too old. Please upgrade the working copy using "svn upgrade" in the terminal.',
      };
    }

    return { success: false, error: `SVN update failed: ${errorMsg}` };
  }
}

export async function updateItem(
  localPath: string
): Promise<{ success: boolean; revision: number; error?: string }> {
  try {
    const context = await getWorkingCopyContext(localPath);
    if (!context) {
      return { success: false, revision: 0, error: 'Not inside a working copy' };
    }

    if (!existsSync(localPath)) {
      mkdirSync(localPath, { recursive: true });
    }

    const output = await runSvnText(['update', '--depth', 'infinity', localPath]);

    return {
      success: true,
      revision: parseUpdatedRevision(output),
    };
  } catch (error) {
    return {
      success: false,
      revision: 0,
      error: (error as Error)?.message || 'Update failed',
    };
  }
}

export async function updateToRevision(
  workingCopyRoot: string,
  repoUrl: string,
  localPath: string,
  depth: 'empty' | 'files' | 'immediates' | 'infinity' = 'infinity',
  setDepthSticky: boolean = false
): Promise<{ success: boolean; revision: number; error?: string }> {
  try {
    const relativePath = relative(workingCopyRoot, localPath);

    debug.log('[updateToRevision] workingCopyRoot:', workingCopyRoot);
    debug.log('[updateToRevision] repoUrl:', repoUrl);
    debug.log('[updateToRevision] localPath:', localPath);
    debug.log('[updateToRevision] relativePath:', relativePath);
    debug.log('[updateToRevision] depth:', depth);
    debug.log('[updateToRevision] setDepthSticky:', setDepthSticky);

    const authCache = getAuthCache();
    const credentialMatch = repoUrl ? authCache.findForUrl(repoUrl) : null;
    const credentials = credentialMatch
      ? { username: credentialMatch.username, password: credentialMatch.password }
      : undefined;
    if (credentials) {
      debug.log('[updateToRevision] Using cached credentials for realm:', credentialMatch?.realm);
    }

    const pathParts = relativePath.split(/[/\\]/).filter((part) => part.length > 0);

    for (let i = 0; i < pathParts.length - 1; i++) {
      const partialPath = pathParts.slice(0, i + 1).join('/');
      const fullPath = join(workingCopyRoot, partialPath);

      const parentArgs = ['update', '--set-depth', 'immediates', partialPath];
      if (!existsSync(fullPath)) {
        debug.log('[updateToRevision] Creating parent with --set-depth immediates:', partialPath);
        await runSvnText(parentArgs, { cwd: workingCopyRoot, trustSslFailures: true, credentials });
      } else {
        debug.log(
          '[updateToRevision] Opening parent to see children with --set-depth immediates:',
          partialPath
        );
        try {
          await runSvnText(parentArgs, {
            cwd: workingCopyRoot,
            trustSslFailures: true,
            credentials,
          });
        } catch (error) {
          debug.log(
            '[updateToRevision] Parent depth update failed (may already be sufficient):',
            (error as Error)?.message
          );
        }
      }
    }

    const targetFullPath = join(workingCopyRoot, relativePath);
    if (!existsSync(targetFullPath)) {
      debug.log('[updateToRevision] Target does not exist, fetching with --depth empty first:', relativePath);
      try {
        await runSvnText(['update', '--depth', 'empty', relativePath], {
          cwd: workingCopyRoot,
          trustSslFailures: true,
          credentials,
        });
      } catch (error) {
        debug.log('[updateToRevision] Initial target fetch failed:', (error as Error)?.message);
      }
    }

    const args = ['update'];
    if (setDepthSticky) {
      args.push('--set-depth', depth);
    } else {
      args.push('--depth', depth);
    }
    args.push(relativePath);

    debug.log('[updateToRevision] Running svn with args:', args);
    const output = await runSvnText(args, {
      cwd: workingCopyRoot,
      trustSslFailures: true,
      credentials,
    });

    return {
      success: true,
      revision: parseUpdatedRevision(output),
    };
  } catch (error) {
    return {
      success: false,
      revision: 0,
      error: (error as Error)?.message || 'Update failed',
    };
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
