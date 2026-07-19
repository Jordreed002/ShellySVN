import type { FileInfo, FsStatusResult, SvnStatusChar, SvnStatusEntry } from '@shared/types';

const STATUS_PRIORITY: Record<SvnStatusChar, number> = {
  C: 100,
  '!': 90,
  '~': 85,
  M: 80,
  D: 70,
  R: 60,
  A: 50,
  X: 40,
  '?': 30,
  I: 20,
  O: 10,
  ' ': 0,
};

export function fileInfoToEntry(file: FileInfo): SvnStatusEntry {
  return {
    path: file.path,
    remoteUrl: file.svnStatus?.remoteUrl,
    status: file.svnStatus?.status || ' ',
    revision: file.svnStatus?.revision,
    author: file.svnStatus?.author,
    date: file.svnStatus?.date,
    isDirectory: file.isDirectory,
  };
}

function normalizeStatusPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function getWorstStatus(current: SvnStatusChar, next: SvnStatusChar): SvnStatusChar {
  return STATUS_PRIORITY[next] > STATUS_PRIORITY[current] ? next : current;
}

function buildFolderStatusIndex(
  files: FileInfo[],
  deepStatus: FsStatusResult
): Map<string, SvnStatusChar> {
  const folderPaths = new Set(
    files.filter((file) => file.isDirectory).map((file) => normalizeStatusPath(file.path))
  );
  const folderStatus = new Map<string, SvnStatusChar>();

  if (folderPaths.size === 0 || deepStatus.allEntries.length === 0) {
    return folderStatus;
  }

  for (const entry of deepStatus.allEntries) {
    let parentPath = normalizeStatusPath(entry.fullPath);
    const status = entry.status;

    while (parentPath) {
      const separatorIndex = parentPath.lastIndexOf('/');
      if (separatorIndex === -1) break;

      parentPath = parentPath.slice(0, separatorIndex);
      if (folderPaths.has(parentPath)) {
        folderStatus.set(parentPath, getWorstStatus(folderStatus.get(parentPath) || ' ', status));
      }
    }
  }

  return folderStatus;
}

/**
 * Count changed items nested under each immediate folder, from the recursive
 * deep-status result. Returns a map of normalized folder path -> change count.
 */
export function buildFolderChangeCounts(
  files: FileInfo[],
  deepStatus: FsStatusResult
): Map<string, number> {
  const folderPaths = new Set(
    files.filter((file) => file.isDirectory).map((file) => normalizeStatusPath(file.path))
  );
  const counts = new Map<string, number>();

  if (folderPaths.size === 0 || deepStatus.allEntries.length === 0) {
    return counts;
  }

  for (const entry of deepStatus.allEntries) {
    // Unversioned/ignored/external/remote entries aren't pending changes.
    if (entry.status === '?' || entry.status === 'I' || entry.status === 'X') continue;

    let parentPath = normalizeStatusPath(entry.fullPath);
    const seen = new Set<string>();
    while (parentPath) {
      const separatorIndex = parentPath.lastIndexOf('/');
      if (separatorIndex === -1) break;
      parentPath = parentPath.slice(0, separatorIndex);
      // Only count once per ancestor folder, and only for visible immediate folders.
      if (folderPaths.has(parentPath) && !seen.has(parentPath)) {
        seen.add(parentPath);
        counts.set(parentPath, (counts.get(parentPath) || 0) + 1);
      }
    }
  }

  return counts;
}

export function applyDeepStatus(files: FileInfo[], deepStatus: FsStatusResult): FileInfo[] {
  const folderStatus = buildFolderStatusIndex(files, deepStatus);

  return files.map((file) => {
    if (file.isDirectory) {
      const worstStatus = folderStatus.get(normalizeStatusPath(file.path)) || ' ';
      if (worstStatus !== ' ') {
        return {
          ...file,
          svnStatus: { path: file.path, status: worstStatus, isDirectory: true },
        };
      }
    }
    return file;
  });
}
