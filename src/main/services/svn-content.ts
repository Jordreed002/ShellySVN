import type { SvnCatResult } from '@shared/types';

import { requireSvnRevision } from '../utils/svn-revision';
import { escapeLocalPegTargets, validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { runSvn } from './svn-executor';
import { resolveSvnExecution } from './svn-executor';
import { getSharedWorkerPool } from '../workers/WorkerPool';
import {
  getNetworkOptionsForUrl,
  getNetworkOptionsForWorkingCopyPath,
} from './svn-network-context';

const MAX_CAT_BYTES = 32 * 1024 * 1024;

function validateRevision(revision?: string): void {
  if (revision === undefined) return;
  if (!/^(?:\d+|HEAD|BASE|COMMITTED|PREV|\{[^\r\n{}]+\})$/i.test(revision.trim())) {
    throw new Error('Invalid SVN revision');
  }
}

export async function catRepositoryFile(
  target: string,
  revision?: string,
  workerJobId?: string
): Promise<SvnCatResult> {
  validateSvnTargets([target], 'Cat target');
  validateRevision(revision);

  const args = ['cat'];
  if (revision) args.push('-r', requireSvnRevision(revision, 'cat revision'));
  const targetArgs = withSvnTargets(args, [target]);
  const networkOptions = /^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(target)
    ? await getNetworkOptionsForUrl(target)
    : await getNetworkOptionsForWorkingCopyPath(target);

  if (workerJobId) {
    const { svnCommand, context } = await resolveSvnExecution();
    return getSharedWorkerPool().run(
      'svn:cat',
      {
        target: escapeLocalPegTargets([target])[0],
        revision: revision?.trim(),
        svnCommand,
        context,
        ...networkOptions,
      },
      { id: workerJobId, priority: 'interactive', joinExisting: true }
    );
  }

  const result = await runSvn(targetArgs, {
    ...networkOptions,
    binaryStdout: true,
    maxStdoutBytes: MAX_CAT_BYTES,
  });
  const contentBase64 = result.stdoutBase64 ?? '';
  const bytes = Buffer.from(contentBase64, 'base64');
  const text = bytes.toString('utf8');
  const binary = bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes);

  return {
    target,
    revision: revision?.trim(),
    contentBase64,
    byteLength: bytes.length,
    binary,
    truncated: result.stdoutTruncated,
  };
}
