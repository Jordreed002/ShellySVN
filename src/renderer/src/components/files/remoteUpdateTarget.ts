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

  if (workingCopyUrlClean) {
    const normalizedRepoUrl = repoUrl.replace(/\\/g, '/');
    const workingCopyUrlWithSlash = `${workingCopyUrlClean}/`;

    if (normalizedRepoUrl === workingCopyUrlClean) {
      return { repoUrl, localPath: currentPath };
    }

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
