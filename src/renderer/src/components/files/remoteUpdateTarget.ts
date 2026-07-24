import type { SvnStatusEntry } from '@shared/types';
import { resolveRemoteUrlToLocalPath } from '@renderer/utils/pathResolution';

export interface RemoteUpdateTarget {
  repoUrl: string;
  localPath: string | null;
}

interface ResolveRemoteUpdateTargetOptions {
  entry: SvnStatusEntry;
  repositoryRoot: string;
  workingCopyUrl?: string;
  workingCopyRoot: string;
  currentPath: string;
}

export function resolveRemoteUpdateTarget({
  entry,
  repositoryRoot,
  workingCopyUrl,
  currentPath,
}: ResolveRemoteUpdateTargetOptions): RemoteUpdateTarget {
  const repoRootClean = repositoryRoot.replace(/\/$/, '');
  const repoUrl = entry.remoteUrl ?? `${repoRootClean}/${entry.path.replace(/^[/\\]+/, '')}`;
  const workingCopyUrlClean = workingCopyUrl?.replace(/\/$/, '');

  // Anchor the repository URL to the actual URL of the displayed local folder.
  // That URL may belong to a switched subtree or nested external, so falling
  // back to entry.path would risk updating an unrelated local sibling.
  if (workingCopyUrlClean) {
    return {
      repoUrl,
      localPath: resolveRemoteUrlToLocalPath(
        repoUrl,
        currentPath,
        repositoryRoot,
        workingCopyUrlClean
      ),
    };
  }

  return {
    repoUrl,
    localPath: null,
  };
}
