/**
 * Shared type definitions for ShellySVN
 * Used by both main process and renderer
 */

// ============================================
// SVN Status Types
// ============================================

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

// ============================================
// SVN Log Types
// ============================================

export interface SvnLogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  paths: SvnLogPath[];
}

export interface SvnLogPath {
  action: 'A' | 'D' | 'M' | 'R';
  path: string;
  copyFromPath?: string;
  copyFromRev?: number;
}

export interface SvnLogResult {
  entries: SvnLogEntry[];
  startRevision: number;
  endRevision: number;
}

// ============================================
// SVN Diff Types
// ============================================

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
  rawDiff?: string; // For binary files or when parsing fails
}

// ============================================
// SVN Info Types
// ============================================

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

// ============================================
// File System Types
// ============================================

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: string;
  svnStatus?: SvnStatusEntry;
}

export interface DirectoryInfo {
  path: string;
  files: FileInfo[];
  totalCount: number;
}

// ============================================
// IPC Channel Definitions
// ============================================

export type SvnChannels = {
  'svn:status': (path: string) => SvnStatusResult;
  'svn:log': (path: string, limit?: number, startRev?: number, endRev?: number) => SvnLogResult;
  'svn:info': (path: string) => SvnInfoResult;
  'svn:update': (path: string) => { success: boolean; revision: number };
  'svn:commit': (paths: string[], message: string) => { success: boolean; revision: number };
  'svn:revert': (paths: string[]) => { success: boolean };
  'svn:add': (paths: string[]) => { success: boolean };
  'svn:delete': (paths: string[]) => { success: boolean };
  'svn:cleanup': (path: string) => { success: boolean };
};

export type DialogChannels = {
  'dialog:openDirectory': () => string | null;
  'dialog:openFile': (filters?: FileFilter[]) => string | null;
  'dialog:saveFile': (defaultName?: string) => string | null;
};

export type AppChannels = {
  'app:getVersion': () => string;
  'app:getPath': (name: 'home' | 'appData' | 'desktop' | 'documents' | 'temp') => string;
  'app:openExternal': (url: string) => void;
};

export interface FileFilter {
  name: string;
  extensions: string[];
}

// ============================================
// Progress Types
// ============================================

export interface ProgressState {
  id: string
  title: string
  message?: string
  progress?: number // 0-100, undefined = indeterminate
  currentFile?: string
  filesProcessed?: number
  totalFiles?: number
  status: 'running' | 'completed' | 'cancelled' | 'error'
  error?: string
}

// ============================================
// Settings Types
// ============================================

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type FontSize = 'small' | 'medium' | 'large'
export type StartupAction = 'welcome' | 'lastRepo' | 'empty'
export type WorkingCopyFormat = '1.8' | '1.9' | '1.10' | '1.11' | '1.12' | '1.13' | '1.14'

export interface SavedCredential {
  realm: string
  username: string
}

export interface ProxySettings {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  bypassForLocal: boolean
}

export interface DiffMergeSettings {
  externalDiffTool: string
  externalMergeTool: string
  diffOnDoubleClick: boolean
  ignoreWhitespace: boolean
  ignoreEol: boolean
  contextLines: number
}

export interface DialogSettings {
  rememberPositions: boolean
  rememberSizes: boolean
  commitDialogColumns: string[]
  logMessagesPerPage: number
  maxCachedMessages: number
}

export interface NotificationSettings {
  enableSounds: boolean
  enableSystemNotifications: boolean
  showHookOutput: boolean
  monitorPollInterval: number // seconds
}

export interface IntegrationSettings {
  shellExtensionEnabled: boolean
  contextMenuItems: string[]
  iconOverlaysEnabled: boolean
}

export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system'
  language: string
  checkUpdatesOnStartup: boolean
  confirmDestructiveOps: boolean
  singleInstanceMode: boolean
  defaultCheckoutDirectory: string
  startupAction: StartupAction
  
  // SVN
  recentRepositories: string[]
  showIgnoredFiles: boolean
  showUnversionedFiles: boolean
  sidebarWidth: number
  defaultCommitMessage: string
  autoRefreshInterval: number // seconds, 0 = disabled
  svnClientPath: string // empty = bundled
  workingCopyFormat: WorkingCopyFormat
  globalIgnorePatterns: string[]
  proxySettings: ProxySettings
  connectionTimeout: number // seconds
  sslVerify: boolean
  clientCertificatePath: string
  
  // Diff & Merge
  diffMerge: DiffMergeSettings
  
  // Dialogs
  dialogs: DialogSettings
  
  // Notifications
  notifications: NotificationSettings
  
  // Integration
  integration: IntegrationSettings
  
  // Appearance
  fontSize: FontSize
  showStatusBar: boolean
  fileListHeight: 'auto' | 'fill'
  accentColor: string
  compactFileRows: boolean
  animationSpeed: 'none' | 'fast' | 'normal'
  showThumbnails: boolean
  showFolderSizes: boolean
  
  // Navigation
  bookmarks: Array<{ path: string; name: string; addedAt: number }>
  recentPaths: string[]
  
  // Authentication
  savedCredentials: SavedCredential[]
  
  // Advanced
  logLevel: LogLevel
  svnConfigPath: string
  logCachePath: string
  maxLogCacheSize: number // MB
}

// ============================================
// SVN Checkout Options
// ============================================

export interface CheckoutOptions {
  /** Trust SSL certificate */
  trustSsl?: boolean;
  /** Trust SSL certificate permanently */
  trustPermanently?: boolean;
  /** SSL failure types to accept */
  sslFailures?: string[];
  /** Authentication credentials */
  credentials?: AuthCredential;
}

// ============================================
// Auth Types
// ============================================

export interface AuthCredential {
  username: string;
  password: string;
}

export interface AuthListEntry {
  realm: string;
  username: string;
  createdAt: number;
}

// ============================================
// Changelist Types
// ============================================

export interface SvnChangelist {
  name: string;
  comment?: string;
  files: string[];
}

export interface SvnChangelistResult {
  changelists: SvnChangelist[];
  defaultFiles: string[]; // Files not in any changelist
}

// ============================================
// Shelve Types (SVN 1.10+)
// ============================================

export interface SvnShelve {
  name: string;
  message?: string;
  path: string;
  date: string;
}

export interface SvnShelveListResult {
  shelves: SvnShelve[];
}

// ============================================
// SVN Blame (Annotate) Types
// ============================================

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

// ============================================
// SVN Repository List Types
// ============================================

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

// ============================================
// SVN Patch Types
// ============================================

export interface SvnPatchResult {
  success: boolean;
  filesPatched: number;
  rejects: number;
  output: string;
}

// ============================================
// SVN Externals Types
// ============================================

export interface SvnExternal {
  name: string;
  url: string;
  path: string;
  revision?: number;
  pegRevision?: number;
  depth?: 'empty' | 'files' | 'immediates' | 'infinity';
}

// ============================================
// SVN Execution Context (Settings Enforcement)
// ============================================

export interface SvnExecutionContext {
  proxySettings?: ProxySettings;
  connectionTimeout?: number;
  sslVerify?: boolean;
  clientCertificatePath?: string;
}

// ============================================
// Project Monitor Types
// ============================================

export interface WorkingCopyInfo {
  path: string;
  url: string;
  revision: number;
  hasChanges: boolean;
  lastChecked: number;
  isMonitored: boolean;
}

// ============================================
// IPC API Types
// ============================================

// Status result from fs:getStatus and fs:getDeepStatus
export interface FsStatusResult {
  directStatus: { [filename: string]: { status: SvnStatusChar; revision?: number; author?: string } }
  allEntries: { status: SvnStatusChar; fullPath: string; revision?: number; author?: string }[]
}

export interface ElectronAPI {
  svn: {
    status: (path: string) => Promise<SvnStatusResult>;
    log: (path: string, limit?: number, startRev?: number, endRev?: number) => Promise<SvnLogResult>;
    info: (path: string) => Promise<SvnInfoResult>;
    diff: (path: string, revision?: string) => Promise<SvnDiffResult>;
    update: (path: string) => Promise<{ success: boolean; revision: number }>;
    commit: (paths: string[], message: string) => Promise<{ success: boolean; revision: number }>;
    revert: (paths: string[]) => Promise<{ success: boolean }>;
    add: (paths: string[]) => Promise<{ success: boolean }>;
    delete: (paths: string[]) => Promise<{ success: boolean }>;
    cleanup: (path: string) => Promise<{ success: boolean }>;
    lock: (path: string, message?: string) => Promise<{ success: boolean; output?: string }>;
    unlock: (path: string, force?: boolean) => Promise<{ success: boolean; output?: string }>;
    checkout: (url: string, path: string, revision?: string, depth?: 'empty' | 'files' | 'immediates' | 'infinity', options?: CheckoutOptions) => Promise<{ success: boolean; revision: number; output?: string }>;
    export: (url: string, path: string, revision?: string) => Promise<{ success: boolean; revision: number; output?: string }>;
    import: (path: string, url: string, message: string) => Promise<{ success: boolean; revision: number; output?: string }>;
    resolve: (path: string, resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict') => Promise<{ success: boolean }>;
    switch: (path: string, url: string, revision?: string) => Promise<{ success: boolean; revision: number; output?: string }>;
    copy: (src: string, dst: string, message: string) => Promise<{ success: boolean; revision: number; output?: string }>;
    merge: (source: string, target: string, revisions?: string[], ranges?: Array<{ start: number; end: number }>) => Promise<{ success: boolean; output?: string }>;
    relocate: (from: string, to: string, path: string) => Promise<{ success: boolean; output?: string }>;
    changelist: {
      add: (paths: string[], changelist: string) => Promise<{ success: boolean }>;
      remove: (paths: string[]) => Promise<{ success: boolean }>;
      list: (path: string) => Promise<SvnChangelistResult>;
      create: (name: string, comment?: string) => Promise<{ success: boolean }>;
      delete: (name: string, path: string) => Promise<{ success: boolean }>;
    };
    move: (src: string, dst: string) => Promise<{ success: boolean; output?: string }>;
    rename: (src: string, dst: string) => Promise<{ success: boolean; output?: string }>;
    shelve: {
      list: (path: string) => Promise<SvnShelveListResult>;
      save: (name: string, path: string, message?: string) => Promise<{ success: boolean }>;
      apply: (name: string, path: string) => Promise<{ success: boolean }>;
      delete: (name: string, path: string) => Promise<{ success: boolean }>;
    };
    proplist: (path: string) => Promise<{ name: string; value: string }[]>;
    propset: (path: string, name: string, value: string) => Promise<{ success: boolean }>;
    propdel: (path: string, name: string) => Promise<{ success: boolean }>;
    blame: (path: string, startRevision?: number, endRevision?: number) => Promise<SvnBlameResult>;
    list: (url: string, revision?: string, depth?: 'empty' | 'immediates' | 'infinity') => Promise<SvnListResult>;
    patch: {
      create: (paths: string[], outputPath: string) => Promise<{ success: boolean; output: string }>;
      apply: (patchPath: string, targetPath: string, dryRun?: boolean) => Promise<SvnPatchResult>;
    };
    externals: {
      list: (path: string) => Promise<SvnExternal[]>;
      add: (workingCopyPath: string, external: Omit<SvnExternal, 'name'> & { name?: string }) => Promise<{ success: boolean }>;
      remove: (workingCopyPath: string, externalPath: string) => Promise<{ success: boolean }>;
    };
  };
  external: {
    openDiffTool: (tool: string, left: string, right: string) => Promise<{ success: boolean; error?: string }>;
    openMergeTool: (tool: string, base: string, mine: string, theirs: string, merged: string) => Promise<{ success: boolean; error?: string }>;
    openFolder: (path: string) => Promise<{ success: boolean }>;
    openFile: (path: string) => Promise<{ success: boolean }>;
  };
  monitor: {
    getWorkingCopies: () => Promise<WorkingCopyInfo[]>;
    addWorkingCopy: (path: string) => Promise<{ success: boolean }>;
    removeWorkingCopy: (path: string) => Promise<{ success: boolean }>;
    refreshStatus: (path: string) => Promise<WorkingCopyInfo | null>;
    startMonitoring: () => Promise<void>;
    stopMonitoring: () => Promise<void>;
  };
  fs: {
    listDirectory: (path: string) => Promise<FileInfo[]>;
    listDrives: () => Promise<FileInfo[]>;
    getParent: (path: string) => Promise<string | null>;
    getStatus: (path: string) => Promise<FsStatusResult>;
    getDeepStatus: (path: string) => Promise<FsStatusResult>;
    applyStatus: (files: FileInfo[], directStatus: FsStatusResult['directStatus'], allEntries: FsStatusResult['allEntries']) => Promise<FileInfo[]>;
    cancelScan: (path: string) => Promise<void>;
    isVersioned: (path: string) => Promise<boolean>;
    readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
    readImageAsBase64: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    getFolderSizes: (folderPaths: string[]) => Promise<Record<string, number>>;
    copyFile: (source: string, target: string) => Promise<{ success: boolean; error?: string }>;
    writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
    watch: (path: string, callback: (event: { path: string; eventType: string; changedPath: string }) => void, options?: { watchSvnOnly?: boolean }) => (() => void) | undefined;
    unwatch: (path: string) => Promise<{ success: boolean }>;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
    openFile: (filters?: FileFilter[]) => Promise<string | null>;
    saveFile: (defaultName?: string) => Promise<string | null>;
  };
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: 'home' | 'appData' | 'desktop' | 'documents' | 'temp') => Promise<string>;
    openExternal: (url: string) => Promise<void>;
    clearCache: () => Promise<{ success: boolean; error?: string }>;
    getCacheSize: () => Promise<{ size: number; files: number }>;
  };
  store: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: <T>(key: string, value: T) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  auth: {
    get: (realm: string) => Promise<AuthCredential | null>;
    set: (realm: string, username: string, password: string) => Promise<{ success: boolean }>;
    delete: (realm: string) => Promise<{ success: boolean }>;
    list: () => Promise<AuthListEntry[]>;
    has: (realm: string) => Promise<boolean>;
    clear: () => Promise<{ success: boolean }>;
    isEncryptionAvailable: () => Promise<boolean>;
  };
  shell: {
    register: () => Promise<{ success: boolean }>;
    unregister: () => Promise<{ success: boolean }>;
    isRegistered: () => Promise<{ registered: boolean }>;
    updateOverlay: (path: string, status: string) => Promise<{ success: boolean }>;
    clearOverlay: (path: string) => Promise<{ success: boolean }>;
    clearAllOverlays: () => Promise<{ success: boolean }>;
  };
  deepLink: {
    onAction: (callback: (link: { action: string; params: Record<string, string>; path?: string; url?: string }) => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: ElectronAPI;
  }
}
