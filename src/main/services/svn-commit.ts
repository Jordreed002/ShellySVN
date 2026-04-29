import type { IpcMainInvokeEvent } from 'electron';
import { executeHooksForType, HookScript } from '../hooks/HookExecutor';
import { getStore } from '../ipc/store';
import { debug } from '../utils/debug';
import { runSvnText } from './svn-executor';
import { runSvnOperationWithProgress } from './svn-progress';

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

export async function commit(
  paths: string[],
  message: string
): Promise<{ success: boolean; revision?: number; error?: string }> {
  const workingCopyPath = paths[0];
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const startResult = await executeHooksForType(hooks, 'start-commit', {
    workingCopyPath,
    files: paths,
    message,
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
    message,
  });
  if (!preResult.allSucceeded) {
    return {
      success: false,
      error: preResult.error || 'Pre-commit hook blocked the operation',
    };
  }

  const output = await runSvnText(['commit', '-m', message, ...paths]);
  const match = output.match(/Committed revision (\d+)\./);
  const result = {
    success: true,
    revision: match ? parseInt(match[1], 10) : 0,
  };

  executeHooksForType(hooks, 'post-commit', {
    workingCopyPath,
    files: paths,
    message,
    revision: result.revision,
  }).catch((err) => debug.error('[SVN] Post-commit hook error:', err));

  return result;
}

export async function commitWithProgress(
  event: IpcMainInvokeEvent,
  operationId: string,
  paths: string[],
  message: string
): Promise<{ success: boolean; revision: number; error?: string; output?: string }> {
  const workingCopyPath = paths[0];
  const hooks = await getHooksForWorkingCopy(workingCopyPath);

  const startResult = await executeHooksForType(hooks, 'start-commit', {
    workingCopyPath,
    files: paths,
    message,
  });
  if (!startResult.allSucceeded) {
    return {
      success: false,
      revision: 0,
      error: startResult.error || 'Start-commit hook blocked the operation',
    };
  }

  const preResult = await executeHooksForType(hooks, 'pre-commit', {
    workingCopyPath,
    files: paths,
    message,
  });
  if (!preResult.allSucceeded) {
    return {
      success: false,
      revision: 0,
      error: preResult.error || 'Pre-commit hook blocked the operation',
    };
  }

  const result = await runSvnOperationWithProgress(event, operationId, 'commit', [
    'commit',
    '-m',
    message,
    ...paths,
  ]);

  if (result.success) {
    executeHooksForType(hooks, 'post-commit', {
      workingCopyPath,
      files: paths,
      message,
      revision: result.revision,
    }).catch((err) => debug.error('[SVN] Post-commit hook error:', err));
  }

  return result;
}
