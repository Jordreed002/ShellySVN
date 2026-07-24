import type { SvnStatusResult } from '@shared/types';

import type { SvnStatusMap } from '../ipc/fs';
import { getSharedWorkerPool } from '../workers/WorkerPool';
import type { FsSvnStatusEntry } from '../workers/types';
import { resolveSvnExecution } from './svn-executor';

export type FsStatusDepth = 'empty' | 'files' | 'immediates' | 'infinity';

export interface FsStatusResult {
  directStatus: SvnStatusMap;
  allEntries: FsSvnStatusEntry[];
}

const activeFsStatusRequests = new Map<string, Promise<FsStatusResult>>();

export function getWorkerFsStatus(
  dirPath: string,
  depth: FsStatusDepth = 'immediates'
): Promise<FsStatusResult> {
  const jobId = `fs-status:${depth}:${dirPath}`;
  const activeRequest = activeFsStatusRequests.get(jobId);
  if (activeRequest) return activeRequest;

  const request = (async () => {
    const { svnCommand, context } = await resolveSvnExecution();
    return getSharedWorkerPool().run(
      'svn:fsStatus',
      {
        dirPath,
        svnCommand,
        context,
        depth,
      },
      {
        id: jobId,
        priority: 'interactive',
        joinExisting: true,
      }
    );
  })();

  activeFsStatusRequests.set(jobId, request);
  const removeCompletedRequest = () => {
    if (activeFsStatusRequests.get(jobId) === request) {
      activeFsStatusRequests.delete(jobId);
    }
  };
  void request.then(removeCompletedRequest, removeCompletedRequest);
  return request;
}

export interface WorkerSvnStatusOptions {
  showUpdates?: boolean;
  trustSslFailures?: boolean;
  trustedSslFailures?: string;
  credentials?: { username: string; password: string };
  jobId?: string;
}

export async function getWorkerSvnStatus(
  path: string,
  options: WorkerSvnStatusOptions = {}
): Promise<SvnStatusResult> {
  const { svnCommand, context } = await resolveSvnExecution();
  const result = await getSharedWorkerPool().run(
    'svn:workingCopyStatus',
    {
      dirPath: path,
      svnCommand,
      context,
      showUpdates: options.showUpdates,
      trustSslFailures: options.trustSslFailures,
      trustedSslFailures: options.trustedSslFailures,
      credentials: options.credentials,
    },
    {
      id:
        options.jobId ?? (options.showUpdates ? `svn-status-remote:${path}` : `svn-status:${path}`),
      priority: 'interactive',
      joinExisting: true,
    }
  );

  return options.showUpdates ? { ...result, remoteChecked: true } : result;
}
