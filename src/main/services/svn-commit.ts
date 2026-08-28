import type { IpcMainInvokeEvent } from 'electron';
import type { SvnOperationRevision } from '@shared/types';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getStore } from '../ipc/store';
import { debug } from '../utils/debug';
import { runSvnText } from './svn-executor';
import { runSerializedWorkingCopyMutation } from './svn-mutation-queue';
import { getNetworkOptionsForWorkingCopyPath } from './svn-network-context';
import { runSvnOperationWithProgress } from './svn-progress';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { isAbsolute, relative } from 'node:path';

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

function sanitizeCommitMessage(message: string): string {
  return message.split('\u0000').join('');
}

export async function commit(
  paths: string[],
  message: string,
  unversionedPaths: string[] = []
): Promise<{ success: boolean; revision?: SvnOperationRevision; error?: string }> {
  validateSvnTargets(paths, 'Commit target');
  validateUnversionedCommitTargets(paths, unversionedPaths);
  const workingCopyPath = paths[0];
  return runSerializedWorkingCopyMutation(workingCopyPath, async () => {
    return commitUnserialized(paths, message, unversionedPaths);
  });
}

async function commitUnserialized(
  paths: string[],
  message: string,
  unversionedPaths: string[]
): Promise<{ success: boolean; revision?: SvnOperationRevision; error?: string }> {
  const workingCopyPath = paths[0];
  const cleanMessage = sanitizeCommitMessage(message);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const startResult = await executeHooksForType(hooks, 'start-commit', {
    workingCopyPath,
    files: paths,
    message: cleanMessage,
  });
  if (!startResult.allSucceeded) {
    return {
      success: false,
      error: startResult.error || 'Start-commit hook blocked the operation',
    };
  }

  const preResult = await executeHooksForType(hooks, 'pre-commit', {
    workingCopyPath,
    files: paths,
    message: cleanMessage,
  });
  if (!preResult.allSucceeded) {
    return {
      success: false,
      error: preResult.error || 'Pre-commit hook blocked the operation',
    };
  }

  await addUnversionedCommitTargets(unversionedPaths);

  const networkOptions = await getNetworkOptionsForWorkingCopyPath(workingCopyPath);
  const output = await runSvnText(
    withSvnTargets(['commit', '-m', cleanMessage], paths),
    networkOptions
  );
  const match = output.match(/Committed revision (\d+)\./);
  const result = {
    success: true,
    revision: match ? parseInt(match[1], 10) : null,
  };

  executeHooksForType(hooks, 'post-commit', {
    workingCopyPath,
    files: paths,
    message: cleanMessage,
    revision: result.revision,
  }).catch((err) => debug.error('[SVN] Post-commit hook error:', err));

  return result;
}

export async function commitWithProgress(
  event: IpcMainInvokeEvent,
  operationId: string,
  paths: string[],
  message: string,
  unversionedPaths: string[] = []
): Promise<{
  success: boolean;
  revision: SvnOperationRevision;
  error?: string;
  output?: string;
}> {
  validateSvnTargets(paths, 'Commit target');
  validateUnversionedCommitTargets(paths, unversionedPaths);
  const workingCopyPath = paths[0];
  return runSerializedWorkingCopyMutation(workingCopyPath, async () =>
    commitWithProgressUnserialized(event, operationId, paths, message, unversionedPaths)
  );
}

async function commitWithProgressUnserialized(
  event: IpcMainInvokeEvent,
  operationId: string,
  paths: string[],
  message: string,
  unversionedPaths: string[]
): Promise<{
  success: boolean;
  revision: SvnOperationRevision;
  error?: string;
  output?: string;
}> {
  const workingCopyPath = paths[0];
  const cleanMessage = sanitizeCommitMessage(message);
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const startResult = await executeHooksForType(hooks, 'start-commit', {
    workingCopyPath,
    files: paths,
    message: cleanMessage,
  });
  if (!startResult.allSucceeded) {
    return {
      success: false,
      revision: null,
      error: startResult.error || 'Start-commit hook blocked the operation',
    };
  }

  const preResult = await executeHooksForType(hooks, 'pre-commit', {
    workingCopyPath,
    files: paths,
    message: cleanMessage,
  });
  if (!preResult.allSucceeded) {
    return {
      success: false,
      revision: null,
      error: preResult.error || 'Pre-commit hook blocked the operation',
    };
  }

  await addUnversionedCommitTargets(unversionedPaths);

  const networkOptions = await getNetworkOptionsForWorkingCopyPath(workingCopyPath);
  const result = await runSvnOperationWithProgress(
    event,
    operationId,
    'commit',
    withSvnTargets(['commit', '-m', cleanMessage], paths),
    networkOptions
  );

  if (result.success) {
    executeHooksForType(hooks, 'post-commit', {
      workingCopyPath,
      files: paths,
      message: cleanMessage,
      revision: result.revision,
    }).catch((err) => debug.error('[SVN] Post-commit hook error:', err));
  }

  return result;
}

function validateUnversionedCommitTargets(paths: string[], unversionedPaths: string[]): void {
  if (unversionedPaths.length > 0) {
    validateSvnTargets(unversionedPaths, 'Unversioned commit target');
  }
  const selected = new Set(paths);
  if (unversionedPaths.some((path) => !selected.has(path))) {
    throw new Error('Every unversioned commit target must also be selected for commit.');
  }
}

function topLevelTargets(paths: string[]): string[] {
  return paths.filter(
    (path, index) =>
      !paths.some((parent, parentIndex) => {
        if (index === parentIndex) return false;
        const child = relative(parent, path);
        return child !== '' && !child.startsWith('..') && !isAbsolute(child);
      })
  );
}

async function addUnversionedCommitTargets(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runSvnText(withSvnTargets(['add', '--parents'], topLevelTargets(paths)));
}
