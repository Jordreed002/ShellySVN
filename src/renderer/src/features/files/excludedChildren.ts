import type { FileInfo, SvnChildCommitInfo } from '@shared/types';

/**
 * A folder removed with "Exclude and remove locally" is gone from disk but still
 * belongs to the working copy, so a filesystem listing cannot show it and there
 * is nothing left to right-click — the way back disappears with the folder.
 *
 * `svn info --depth immediates` (already read for the last-activity column)
 * reports those children with `depth == exclude`, which is enough to put them
 * back in the listing as not-fetched rows carrying their repository URL. That is
 * what makes "Update to Working Copy" available and able to resolve a target.
 */
/** True when `candidate` is the working copy root or sits beneath it. */
export function isInsideWorkingCopy(
  candidate: string,
  workingCopyRoot: string | undefined
): boolean {
  if (!candidate || !workingCopyRoot) return false;
  const root = workingCopyRoot.replace(/[\\/]+$/, '');
  if (candidate === root) return true;
  return candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
}

export function appendExcludedChildren(
  files: FileInfo[],
  childCommits: Record<string, SvnChildCommitInfo> | undefined,
  dirPath: string
): FileInfo[] {
  if (!childCommits) return files;

  const separator = dirPath.includes('\\') && !dirPath.includes('/') ? '\\' : '/';
  const present = new Set(files.map((file) => file.name));
  const base = dirPath.replace(/[\\/]+$/, '');

  const excluded = Object.entries(childCommits)
    .filter(([name, info]) => info.excluded && !present.has(name))
    .map(([name, info]): FileInfo => {
      const path = base ? `${base}${separator}${name}` : name;
      // Single files can be excluded too, and one shown as a folder would offer
      // the wrong actions and open an empty column.
      const isDirectory = info.kind !== 'file';
      return {
        name,
        path,
        isDirectory,
        size: 0,
        modifiedTime: info.date || '',
        svnStatus: {
          path,
          remoteUrl: info.url,
          status: 'O',
          revision: info.revision || undefined,
          author: info.author || undefined,
          isDirectory,
        },
      };
    });

  return excluded.length > 0 ? [...files, ...excluded] : files;
}
