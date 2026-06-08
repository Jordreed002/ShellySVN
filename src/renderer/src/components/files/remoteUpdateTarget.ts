import type { SvnStatusEntry } from '@shared/types';
import { resolveRemoteUrlToLocalPath } from '@renderer/utils/pathResolution';

export interface RemoteUpdateTarget {
  repoUrl: string;
  localPath: string;
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
  workingCopyRoot,
  currentPath,
}: ResolveRemoteUpdateTargetOptions): RemoteUpdateTarget {
  const repoRootClean = repositoryRoot.replace(/\/$/, '');
  const repoUrl = entry.remoteUrl ?? `${repoRootClean}${entry.path}`;

  // The clicked item's own local path is the exact target to bring into the
  // working copy. Updating anything broader (e.g. the current directory) would
  // pull in the item's siblings, so prefer entry.path. Only fall back to
  // URL-derived resolution when the entry has no local path.
  const localPath =
    entry.path && entry.path.trim().length > 0
      ? entry.path
      : (resolveRemoteUrlToLocalPath(repoUrl, workingCopyRoot, repoRootClean) ?? currentPath);

  return { repoUrl, localPath };
}
