import type {
  SvnChangelistResult,
  SvnExternal,
  SvnListResult,
  SvnShelveListResult,
} from '@shared/types';
import { join } from 'path';
import { parseSvnExternals, parseSvnListXml } from '../svn/parsers';
import {
  parseSvnPropertiesXml,
  parseSvnShelvesXml,
  parseSvnStatusEntriesXml,
} from '../utils/svn-xml';
import { debug } from '../utils/debug';
import { runSvnText } from './svn-executor';

export async function listRepository(
  url: string,
  revision?: string,
  depth?: 'empty' | 'immediates' | 'infinity',
  credentials?: { username: string; password: string }
): Promise<SvnListResult> {
  const args = ['list', '--xml', '--non-interactive'];
  if (revision) args.push('-r', revision);
  if (depth) args.push('--depth', depth);
  args.push(url);

  const xml = await runSvnText(args, { credentials });
  return parseSvnListXml(xml, url);
}

export async function changelistAdd(
  paths: string[],
  changelist: string
): Promise<{ success: boolean }> {
  await runSvnText(['changelist', changelist, ...paths]);
  return { success: true };
}

export async function changelistRemove(paths: string[]): Promise<{ success: boolean }> {
  await runSvnText(['changelist', '--remove', ...paths]);
  return { success: true };
}

export async function changelistList(path: string): Promise<SvnChangelistResult> {
  try {
    const xml = await runSvnText(['status', '--xml', path]);
    const changelists: Map<string, string[]> = new Map();
    const defaultFiles: string[] = [];

    for (const entry of parseSvnStatusEntriesXml(xml)) {
      if (entry.changelist) {
        if (!changelists.has(entry.changelist)) {
          changelists.set(entry.changelist, []);
        }
        changelists.get(entry.changelist)!.push(entry.path);
      } else {
        defaultFiles.push(entry.path);
      }
    }

    return {
      changelists: Array.from(changelists.entries()).map(([name, files]) => ({ name, files })),
      defaultFiles,
    };
  } catch {
    return { changelists: [], defaultFiles: [] };
  }
}

export function changelistCreate(): { success: boolean } {
  return { success: true };
}

export async function changelistDelete(
  name: string,
  path: string
): Promise<{ success: boolean }> {
  try {
    const xml = await runSvnText(['status', '--xml', path]);
    const filesToRemove = parseSvnStatusEntriesXml(xml)
      .filter((entry) => entry.changelist === name)
      .map((entry) => entry.path);

    if (filesToRemove.length > 0) {
      await runSvnText(['changelist', '--remove', ...filesToRemove]);
    }

    return { success: true };
  } catch (error) {
    debug.error('[SVN] Changelist delete error:', error);
    return { success: false };
  }
}

export async function shelveList(path: string): Promise<SvnShelveListResult> {
  try {
    const output = await runSvnText(['shelve', '--list', '--xml', path]);
    return { shelves: parseSvnShelvesXml(output) };
  } catch {
    return { shelves: [] };
  }
}

export async function shelveSave(
  name: string,
  path: string,
  message?: string
): Promise<{ success: boolean }> {
  const args = ['shelve', name];
  if (message) args.push('-m', message);
  args.push(path);
  await runSvnText(args);
  return { success: true };
}

export async function shelveApply(name: string, path: string): Promise<{ success: boolean }> {
  await runSvnText(['unshelve', name, path]);
  return { success: true };
}

export async function shelveDelete(name: string, path: string): Promise<{ success: boolean }> {
  await runSvnText(['shelve', '--delete', name, path]);
  return { success: true };
}

export async function proplist(path: string): Promise<{ name: string; value: string }[]> {
  const output = await runSvnText(['proplist', '--xml', '-v', path]);
  return parseSvnPropertiesXml(output);
}

export async function propset(
  path: string,
  name: string,
  value: string
): Promise<{ success: boolean }> {
  await runSvnText(['propset', name, value, path]);
  return { success: true };
}

export async function propdel(path: string, name: string): Promise<{ success: boolean }> {
  await runSvnText(['propdel', name, path]);
  return { success: true };
}

export async function externalsList(path: string): Promise<SvnExternal[]> {
  try {
    const output = await runSvnText(['propget', 'svn:externals', '-R', path]);
    return parseSvnExternals(output, path);
  } catch (error) {
    debug.error('[SVN] Externals list error:', error);
    return [];
  }
}

export async function externalsAdd(
  workingCopyPath: string,
  external: Omit<SvnExternal, 'name'> & { name?: string }
): Promise<{ success: boolean }> {
  try {
    let current = '';
    try {
      current = await runSvnText(['propget', 'svn:externals', workingCopyPath]);
    } catch {
      // No existing externals.
    }

    const extName = external.name || external.path.split('/').pop() || 'external';
    const extDef = `${external.revision ? `-r${external.revision} ` : ''}${external.url} ${extName}`;
    const newValue = current.trim() ? `${current.trim()}\n${extDef}` : extDef;

    await runSvnText(['propset', 'svn:externals', newValue, workingCopyPath]);
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals add error:', error);
    return { success: false };
  }
}

export async function externalsEdit(
  workingCopyPath: string,
  externalPath: string,
  external: Omit<SvnExternal, 'name'> & { name?: string }
): Promise<{ success: boolean }> {
  try {
    const current = await getExistingExternals(workingCopyPath);
    const lines = removeExternalDefinition(current, externalPath);
    lines.push(formatExternalDefinition(external));
    await saveExternals(workingCopyPath, lines);
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals edit error:', error);
    return { success: false };
  }
}

export async function externalsRemove(
  workingCopyPath: string,
  externalPath: string
): Promise<{ success: boolean }> {
  try {
    const current = await getExistingExternals(workingCopyPath);
    await saveExternals(workingCopyPath, removeExternalDefinition(current, externalPath));
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals remove error:', error);
    return { success: false };
  }
}

export async function externalsUpdate(
  workingCopyPath: string,
  externalPath?: string
): Promise<{ success: boolean }> {
  try {
    await runSvnText(['update', externalPath ? join(workingCopyPath, externalPath) : workingCopyPath]);
    return { success: true };
  } catch (error) {
    debug.error('[SVN] Externals update error:', error);
    return { success: false };
  }
}

async function getExistingExternals(workingCopyPath: string): Promise<string> {
  try {
    return await runSvnText(['propget', 'svn:externals', workingCopyPath]);
  } catch {
    return '';
  }
}

function formatExternalDefinition(external: Omit<SvnExternal, 'name'> & { name?: string }): string {
  const extName = external.name || external.path.split('/').pop() || 'external';
  return `${external.revision ? `-r${external.revision} ` : ''}${external.url} ${extName}`;
}

function removeExternalDefinition(current: string, externalPath: string): string[] {
  return current
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      const parts = line.split(/\s+/);
      const name = parts[parts.length - 1];
      return name !== externalPath && !line.includes(externalPath);
    });
}

async function saveExternals(workingCopyPath: string, lines: string[]): Promise<void> {
  if (lines.some((line) => line.trim())) {
    await runSvnText(['propset', 'svn:externals', lines.join('\n'), workingCopyPath]);
  } else {
    await runSvnText(['propdel', 'svn:externals', workingCopyPath]);
  }
}
