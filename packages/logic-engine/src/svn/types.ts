// Re-export types from shared
export type {
  SvnStatusChar,
  SvnStatusEntry,
  SvnStatusResult,
  SvnLogEntry,
  SvnLogPath,
  SvnLogResult,
  SvnInfoResult
} from './types'

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
