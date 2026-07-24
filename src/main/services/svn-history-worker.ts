import type {
  SvnBlameResult,
  SvnDiffResult,
  SvnLogRequestOptions,
  SvnLogResult,
} from '@shared/types';

import { getSharedWorkerPool } from '../workers/WorkerPool';
import { resolveSvnExecution } from './svn-executor';
import {
  getNetworkOptionsForUrl,
  getNetworkOptionsForWorkingCopyPath,
} from './svn-network-context';

export async function getWorkerLog(
  path: string,
  limit = 100,
  startRev?: number,
  endRev?: number,
  useMergeHistory = false,
  workerJobId?: string,
  options: Omit<SvnLogRequestOptions, 'signal'> = {}
): Promise<SvnLogResult> {
  const { svnCommand, context } = await resolveSvnExecution();
  const networkOptions = /^https?:\/\//i.test(path)
    ? await getNetworkOptionsForUrl(path)
    : await getNetworkOptionsForWorkingCopyPath(path);
  return getSharedWorkerPool().run(
    'svn:log',
    {
      path,
      limit,
      startRev,
      endRev,
      useMergeHistory,
      stopOnCopy: options.stopOnCopy,
      strictNodeHistory: options.strictNodeHistory,
      includeAllRevisionProperties: options.includeAllRevisionProperties,
      revisionProperties: options.revisionProperties,
      svnCommand,
      context,
      ...networkOptions,
    },
    {
      id:
        workerJobId ??
        `svn-log:${JSON.stringify([
          path,
          limit,
          startRev,
          endRev,
          useMergeHistory,
          options.stopOnCopy,
          options.strictNodeHistory,
          options.includeAllRevisionProperties,
          options.revisionProperties,
        ])}`,
      priority: 'interactive',
      joinExisting: true,
    }
  );
}

export async function getWorkerDiff(
  path: string,
  revision?: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  const { svnCommand, context } = await resolveSvnExecution();
  const networkOptions = /^https?:\/\//i.test(path)
    ? await getNetworkOptionsForUrl(path)
    : await getNetworkOptionsForWorkingCopyPath(path);
  return getSharedWorkerPool().run(
    'svn:diff',
    {
      path,
      revision,
      svnCommand,
      context,
      ...networkOptions,
    },
    {
      id: workerJobId ?? `svn-diff:${path}:${revision ?? ''}`,
      priority: 'interactive',
      joinExisting: true,
    }
  );
}

export async function getWorkerDiffStreaming(
  path: string,
  revision?: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  const { svnCommand, context } = await resolveSvnExecution();
  const networkOptions = /^https?:\/\//i.test(path)
    ? await getNetworkOptionsForUrl(path)
    : await getNetworkOptionsForWorkingCopyPath(path);
  return getSharedWorkerPool().run(
    'svn:diffStreaming',
    {
      path,
      revision,
      svnCommand,
      context,
      ...networkOptions,
    },
    {
      id: workerJobId ?? `svn-diff-streaming:${path}:${revision ?? ''}`,
      priority: 'interactive',
      joinExisting: true,
    }
  );
}

export async function getWorkerUrlDiff(
  leftUrl: string,
  rightUrl: string,
  workerJobId?: string
): Promise<SvnDiffResult> {
  const { svnCommand, context } = await resolveSvnExecution();
  const networkOptions = await getNetworkOptionsForUrl(leftUrl);
  return getSharedWorkerPool().run(
    'svn:diffUrls',
    {
      leftUrl,
      rightUrl,
      svnCommand,
      context,
      ...networkOptions,
    },
    {
      id: workerJobId ?? `svn-diff-urls:${leftUrl}:${rightUrl}`,
      priority: 'interactive',
      joinExisting: true,
    }
  );
}

export async function getWorkerBlame(
  path: string,
  startRevision?: number,
  endRevision?: number,
  workerJobId?: string
): Promise<SvnBlameResult> {
  const { svnCommand, context } = await resolveSvnExecution();
  const networkOptions = /^https?:\/\//i.test(path)
    ? await getNetworkOptionsForUrl(path)
    : await getNetworkOptionsForWorkingCopyPath(path);
  return getSharedWorkerPool().run(
    'svn:blame',
    {
      path,
      startRevision,
      endRevision,
      svnCommand,
      context,
      ...networkOptions,
    },
    {
      id: workerJobId ?? `svn-blame:${path}:${startRevision ?? ''}:${endRevision ?? ''}`,
      priority: 'interactive',
      joinExisting: true,
    }
  );
}
