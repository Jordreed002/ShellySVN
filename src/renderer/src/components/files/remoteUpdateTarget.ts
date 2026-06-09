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
  workingCopyUrl,
  workingCopyRoot,
  currentPath,
}: ResolveRemoteUpdateTargetOptions): RemoteUpdateTarget {
  const repoRootClean = repositoryRoot.replace(/\/$/, '');
  const repoUrl = entry.remoteUrl ?? `${repoRootClean}${entry.path}`;
  const workingCopyUrlClean = workingCopyUrl?.replace(/\/$/, '');

  // Map the item's repository URL onto the working copy to derive the precise
  // local path of the clicked item. `entry.path` cannot be used directly: in
  // online browse mode it is a repository path (e.g. /Clients/x), not a local
  // filesystem path.
  if (workingCopyUrlClean) {
    const normalizedRepoUrl = repoUrl.replace(/\\/g, '/');
    const workingCopyUrlWithSlash = `${workingCopyUrlClean}/`;

    // The item is the working copy directory itself.
    if (normalizedRepoUrl === workingCopyUrlClean) {
      return { repoUrl, localPath: currentPath };
    }

    // The item is a descendant of the working copy URL — append the relative
    // repo path to the current local directory.
    if (normalizedRepoUrl.startsWith(workingCopyUrlWithSlash)) {
      const separator = currentPath.includes('\\') ? '\\' : '/';
      const relativePath = normalizedRepoUrl
        .slice(workingCopyUrlWithSlash.length)
        .replace(/\//g, separator);
      const currentPathClean = currentPath.replace(/[\\/]+$/, '');
      return {
        repoUrl,
        localPath: `${currentPathClean}${separator}${relativePath}`,
      };
    }
  }

  const resolvedLocalPath = resolveRemoteUrlToLocalPath(repoUrl, workingCopyRoot, repoRootClean);

  return {
    repoUrl,
    localPath: resolvedLocalPath ?? entry.path ?? currentPath,
  };
}
