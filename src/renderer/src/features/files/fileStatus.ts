import type { FileInfo, FsStatusResult, SvnStatusChar, SvnStatusEntry } from '@shared/types';

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

export function applyDeepStatus(files: FileInfo[], deepStatus: FsStatusResult): FileInfo[] {
  const statusPriority: Record<string, number> = {
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
    ' ': 0,
  };

  return files.map((file) => {
    if (file.isDirectory) {
      let worstStatus: SvnStatusChar = ' ';
      for (const entry of deepStatus.allEntries) {
        if (
          entry.fullPath.startsWith(file.path + '\\') ||
          entry.fullPath.startsWith(file.path + '/')
        ) {
          if (statusPriority[entry.status] > statusPriority[worstStatus]) {
            worstStatus = entry.status;
          }
        }
      }
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
