// These types are duplicated here for the logic engine's independence
// In production, they would be imported from @shellysvn/shared

export type SvnStatusChar =
  | ' '  // No modifications
  | 'A'  // Added
  | 'C'  // Conflicted
  | 'D'  // Deleted
  | 'I'  // Ignored
  | 'M'  // Modified
  | 'R'  // Replaced
  | 'X'  // Unversioned directory (externals)
  | '?'  // Unversioned
  | '!'  // Missing
  | '~'  // Obstructed

export interface SvnStatusEntry {
  path: string;
  status: SvnStatusChar;
  revision?: number;
  author?: string;
  date?: string;
  isDirectory: boolean;
  propsStatus?: SvnStatusChar;
  lock?: {
    owner: string;
    comment: string;
    date: string;
  };
}

export interface SvnStatusResult {
  path: string;
  entries: SvnStatusEntry[];
  revision: number;
}

export interface SvnLogPath {
  action: 'A' | 'D' | 'M' | 'R';
  path: string;
  copyFromPath?: string;
  copyFromRev?: number;
}

export interface SvnLogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  paths: SvnLogPath[];
}

export interface SvnLogResult {
  entries: SvnLogEntry[];
  startRevision: number;
  endRevision: number;
}

export interface SvnInfoResult {
  path: string;
  url: string;
  repositoryRoot: string;
  repositoryUuid: string;
  revision: number;
  nodeKind: 'file' | 'dir';
  lastChangedAuthor: string;
  lastChangedRevision: number;
  lastChangedDate: string;
  workingCopyRoot?: string;
}

// Additional types for extended operations
export interface SvnDiffLine {
  type: 'added' | 'removed' | 'context' | 'header' | 'hunk';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface SvnDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: SvnDiffLine[];
}

export interface SvnDiffFile {
  oldPath: string;
  newPath: string;
  hunks: SvnDiffHunk[];
  isBinary?: boolean;
}

export interface SvnDiffResult {
  files: SvnDiffFile[];
  hasChanges: boolean;
  isBinary?: boolean;
  rawDiff?: string;
}

export interface SvnBlameLine {
  lineNumber: number;
  revision: number;
  author: string;
  date: string;
  content: string;
}

export interface SvnBlameResult {
  path: string;
  lines: SvnBlameLine[];
  startRevision: number;
  endRevision: number;
}

export interface SvnRepoEntry {
  name: string;
  path: string;
  url: string;
  kind: 'file' | 'dir';
  size?: number;
  revision: number;
  author: string;
  date: string;
}

export interface SvnListResult {
  path: string;
  entries: SvnRepoEntry[];
}
