/**
 * Shared type definitions for ShellySVN
 * Used by both main process and renderer
 */

// ============================================
// SVN Status Types
// ============================================

export type SvnStatusChar =
  | ' ' // No modifications
  | 'A' // Added
  | 'C' // Conflicted
  | 'D' // Deleted
  | 'I' // Ignored
  | 'M' // Modified
  | 'R' // Replaced
  | 'X' // Unversioned directory (externals)
  | '?' // Unversioned
  | '!' // Missing
  | '~' // Obstructed
  | 'O'; // Remote-only (sparse checkout, not on disk)

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
  /** Set when XML parsing failed - entries may be incomplete or empty */
  parseError?: string;
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
  /** Set when XML parsing failed - entries may be incomplete or empty */
  parseError?: string;
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
  lock?: SvnLockInfo;
  /** Set when XML parsing failed - fields may contain default/empty values */
  parseError?: string;
}

// ============================================
// SVN Lock Types
// ============================================

export interface SvnLockInfo {
  /** Path to the locked file */
  path: string;
  /** Username of the lock owner */
  owner: string;
  /** Lock comment (may be empty) */
  comment: string;
  /** Date when the lock was created (ISO 8601) */
  date: string;
  /** Lock token (unique identifier) */
  token?: string;
  /** Whether the lock is owned by the current user */
  isOwner?: boolean;
}

export interface SvnLockResult {
  success: boolean;
  lock?: SvnLockInfo;
  error?: string;
}

export interface SvnUnlockResult {
  success: boolean;
  error?: string;
}

export interface SvnLockListResult {
  locks: SvnLockInfo[];
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
  id: string;
  title: string;
  message?: string;
  progress?: number; // 0-100, undefined = indeterminate
  currentFile?: string;
  filesProcessed?: number;
  totalFiles?: number;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  error?: string;
}

// ============================================
// Settings Types
// ============================================

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type FontSize = 'small' | 'medium' | 'large';
export type StartupAction = 'welcome' | 'lastRepo' | 'empty';
export type WorkingCopyFormat = '1.8' | '1.9' | '1.10' | '1.11' | '1.12' | '1.13' | '1.14';

export interface SavedCredential {
  realm: string;
  username: string;
}

export interface ProxySettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  bypassForLocal: boolean;
}

export interface DiffMergeSettings {
  externalDiffTool: string;
  externalMergeTool: string;
  diffOnDoubleClick: boolean;
  ignoreWhitespace: boolean;
  ignoreEol: boolean;
  contextLines: number;
}

export interface DialogSettings {
  rememberPositions: boolean;
  rememberSizes: boolean;
  commitDialogColumns: string[];
  logMessagesPerPage: number;
  maxCachedMessages: number;
}

export interface NotificationSettings {
  enableSounds: boolean;
  enableSystemNotifications: boolean;
  showHookOutput: boolean;
  monitorPollInterval: number; // seconds
}

export interface IntegrationSettings {
  shellExtensionEnabled: boolean;
  contextMenuItems: string[];
  iconOverlaysEnabled: boolean;
}

export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  language: string;
  checkUpdatesOnStartup: boolean;
  confirmDestructiveOps: boolean;
  singleInstanceMode: boolean;
  defaultCheckoutDirectory: string;
  startupAction: StartupAction;

  // SVN
  recentRepositories: string[];
  showIgnoredFiles: boolean;
  showUnversionedFiles: boolean;
  sidebarWidth: number;
  defaultCommitMessage: string;
  autoRefreshInterval: number; // seconds, 0 = disabled
  svnClientPath: string; // empty = bundled
  workingCopyFormat: WorkingCopyFormat;
  globalIgnorePatterns: string[];
  proxySettings: ProxySettings;
  connectionTimeout: number; // seconds
  sslVerify: boolean;
  clientCertificatePath: string;

  // Diff & Merge
  diffMerge: DiffMergeSettings;

  // Dialogs
  dialogs: DialogSettings;

  // Notifications
  notifications: NotificationSettings;

  // Integration
  integration: IntegrationSettings;

  // Appearance
  fontSize: FontSize;
  showStatusBar: boolean;
  fileListHeight: 'auto' | 'fill';
  accentColor: string;
  compactFileRows: boolean;
  animationSpeed: 'none' | 'fast' | 'normal';
  showThumbnails: boolean;
  showFolderSizes: boolean;

  // Navigation
  bookmarks: Array<{ path: string; name: string; addedAt: number }>;
  recentPaths: string[];

  // Authentication
  savedCredentials: SavedCredential[];

  // SSH Settings
  sshSettings?: SSHSettings;

  // Advanced
  logLevel: LogLevel;
  svnConfigPath: string;
  logCachePath: string;
  maxLogCacheSize: number; // MB

  // Tutorial
  hasCompletedTutorial: boolean;
  tutorialStep: number; // Current step for resume capability
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
  /** Specific paths to checkout (sparse checkout) */
  sparsePaths?: string[];
}

/**
 * Checkout progress information for streaming updates
 */
export interface CheckoutProgress {
  /** Current file being checked out */
  currentFile?: string;
  /** Number of files processed so far */
  filesProcessed: number;
  /** Total files to process (may be undefined until SVN reports it) */
  totalFiles?: number;
  /** Progress percentage (0-100) if available */
  percentage?: number;
  /** Bytes transferred so far */
  bytesTransferred?: number;
  /** Total bytes to transfer */
  totalBytes?: number;
  /** Current operation status */
  status: 'running' | 'completed' | 'cancelled' | 'error';
  /** Error message if status is 'error' */
  error?: string;
  /** Final revision when completed */
  revision?: number;
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
// Client Certificate Types
// ============================================

export interface ClientCertificate {
  /** Unique identifier (UUID) */
  id: string;
  /** Display name for the certificate */
  name: string;
  /** Path to the certificate file (PEM format) */
  path: string;
  /** Whether certificate requires a passphrase */
  hasPassphrase: boolean;
  /** Associated realm/host pattern (optional - for auto-selection) */
  realmPattern?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsedAt?: number;
}

// ============================================
// SSH Key Types
// ============================================

export interface SSHKey {
  /** Unique identifier (UUID) */
  id: string;
  /** Display name for the key */
  name: string;
  /** Path to the private key file */
  privateKeyPath: string;
  /** Key type */
  keyType: 'rsa' | 'ed25519' | 'ecdsa' | 'dsa' | 'unknown';
  /** Whether key has a passphrase */
  hasPassphrase: boolean;
  /** Associated host pattern (optional - for auto-selection) */
  hostPattern?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsedAt?: number;
}

export interface SSHSettings {
  /** Path to SSH client (empty = use system default) */
  sshClientPath: string;
  /** Whether to use ssh-agent/Pageant */
  useAgent: boolean;
  /** Configured SSH keys */
  keys: SSHKey[];
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
  directStatus: {
    [filename: string]: { status: SvnStatusChar; revision?: number; author?: string };
  };
  allEntries: { status: SvnStatusChar; fullPath: string; revision?: number; author?: string }[];
}

export interface ElectronAPI {
  svn: {
    status: (path: string) => Promise<SvnStatusResult>;
    log: (
      path: string,
      limit?: number,
      startRev?: number,
      endRev?: number
    ) => Promise<SvnLogResult>;
    info: (path: string) => Promise<SvnInfoResult>;
    infoUrl: (url: string) => Promise<SvnInfoResult>;
    getWorkingCopyContext: (
      path: string
    ) => Promise<{ workingCopyRoot: string; repositoryRoot: string; url: string } | null>;
    diff: (path: string, revision?: string) => Promise<SvnDiffResult>;
    diffStreaming: (path: string, revision?: string) => Promise<SvnDiffResult>;
    update: (
      path: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity'
    ) => Promise<{ success: boolean; revision: number; error?: string }>;
    updateItem: (path: string) => Promise<{ success: boolean; revision: number; error?: string }>;
    updateToRevision: (
      workingCopyRoot: string,
      url: string,
      localPath: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      setDepthSticky?: boolean
    ) => Promise<{ success: boolean; revision: number; error?: string }>;
    commit: (paths: string[], message: string) => Promise<{ success: boolean; revision: number }>;
    revert: (paths: string[]) => Promise<{ success: boolean }>;
    add: (paths: string[]) => Promise<{ success: boolean }>;
    delete: (paths: string[]) => Promise<{ success: boolean }>;
    cleanup: (path: string) => Promise<{ success: boolean }>;
    lock: (path: string, message?: string) => Promise<{ success: boolean; output?: string }>;
    unlock: (path: string, force?: boolean) => Promise<{ success: boolean; output?: string }>;
    lockInfo: (path: string) => Promise<SvnLockInfo | null>;
    lockForce: (path: string, message?: string) => Promise<SvnLockResult>;
    unlockForce: (path: string) => Promise<SvnUnlockResult>;
    lockList: (path: string) => Promise<SvnLockInfo[]>;
    checkout: (
      url: string,
      path: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => Promise<{ success: boolean; revision: number; output?: string }>;
    checkoutWithProgress: (
      url: string,
      path: string,
      onProgress: (progress: CheckoutProgress) => void,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => Promise<{ success: boolean; revision: number; output?: string }>;
    cancelCheckout: () => Promise<void>;
    export: (
      url: string,
      path: string,
      revision?: string
    ) => Promise<{ success: boolean; revision: number; output?: string }>;
    import: (
      path: string,
      url: string,
      message: string
    ) => Promise<{ success: boolean; revision: number; output?: string }>;
    resolve: (
      path: string,
      resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict'
    ) => Promise<{ success: boolean }>;
    switch: (
      path: string,
      url: string,
      revision?: string
    ) => Promise<{ success: boolean; revision: number; output?: string }>;
    copy: (
      src: string,
      dst: string,
      message: string
    ) => Promise<{ success: boolean; revision: number; output?: string }>;
    merge: (
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>
    ) => Promise<{ success: boolean; output?: string }>;
    relocate: (
      from: string,
      to: string,
      path: string
    ) => Promise<{ success: boolean; output?: string }>;
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
    list: (
      url: string,
      revision?: string,
      depth?: 'empty' | 'immediates' | 'infinity',
      credentials?: { username: string; password: string }
    ) => Promise<SvnListResult>;
    patch: {
      create: (
        paths: string[],
        outputPath: string
      ) => Promise<{ success: boolean; output: string }>;
      apply: (patchPath: string, targetPath: string, dryRun?: boolean) => Promise<SvnPatchResult>;
    };
    externals: {
      list: (path: string) => Promise<SvnExternal[]>;
      add: (
        workingCopyPath: string,
        external: Omit<SvnExternal, 'name'> & { name?: string }
      ) => Promise<{ success: boolean }>;
      remove: (workingCopyPath: string, externalPath: string) => Promise<{ success: boolean }>;
    };
    diagnostics: (workingCopyPath: string) => Promise<RepoDiagnostics>;
  };
  external: {
    openDiffTool: (
      tool: string,
      left: string,
      right: string
    ) => Promise<{ success: boolean; error?: string }>;
    openMergeTool: (
      tool: string,
      base: string,
      mine: string,
      theirs: string,
      merged: string
    ) => Promise<{ success: boolean; error?: string }>;
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
    applyStatus: (
      files: FileInfo[],
      directStatus: FsStatusResult['directStatus'],
      allEntries: FsStatusResult['allEntries']
    ) => Promise<FileInfo[]>;
    cancelScan: (path: string) => Promise<void>;
    isVersioned: (path: string) => Promise<boolean>;
    readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
    readImageAsBase64: (
      filePath: string
    ) => Promise<{ success: boolean; data?: string; error?: string }>;
    getFolderSizes: (folderPaths: string[]) => Promise<Record<string, number>>;
    copyFile: (source: string, target: string) => Promise<{ success: boolean; error?: string }>;
    writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
    watch: (
      path: string,
      callback: (event: { path: string; eventType: string; changedPath: string }) => void,
      options?: { watchSvnOnly?: boolean }
    ) => (() => void) | undefined;
    unwatch: (path: string) => Promise<{ success: boolean }>;
    exists: (path: string) => Promise<boolean>;
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
    window: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
    };
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
    onAction: (
      callback: (link: {
        action: string;
        params: Record<string, string>;
        path?: string;
        url?: string;
      }) => void
    ) => () => void;
  };
}

// ============================================
// Repository Diagnostics Types
// ============================================

export interface RepoDiagnostics {
  // Working copy info
  isValidWorkingCopy: boolean;
  workingCopyRoot: string | null;

  // Repository info
  repositoryRoot: string | null;
  repositoryUrl: string | null;
  repositoryUuid: string | null;

  // Auth status
  hasCredentials: boolean;
  credentialRealm: string | null;
  credentialUsername: string | null;

  // Connection test
  connectionStatus: 'ok' | 'auth-required' | 'ssl-error' | 'network-error' | 'unknown';
  connectionError?: string;
}

// ============================================
// Sparse Checkout & Lazy Loading Types
// ============================================

export type TreeSelectionState = {
  selectedPaths: Set<string>;
  expandedPaths: Set<string>;
};

export interface LazyTreeNode {
  /** Full path to the node */
  path: string;
  /** Display name (basename of path) */
  name: string;
  /** Node type: file or directory */
  kind: 'file' | 'dir';
  /** Whether the node is currently being loaded */
  isLoading: boolean;
  /** Whether the node has been loaded and its children populated */
  isLoaded: boolean;
  /** Child nodes (only populated when isLoaded is true) */
  children: LazyTreeNode[];
  /** Whether the node has children (for directories) */
  hasChildren: boolean;
  /** SVN status for the node */
  status?: SvnStatusEntry;
}

export interface SparseCheckoutResult {
  /** Whether the checkout operation was successful */
  success: boolean;
  /** SVN revision at checkout */
  revision?: number;
  /** Error message if checkout failed */
  error?: string;
  /** Paths that were checked out */
  pathsCheckedOut?: string[];
  /** Total files/directories checked out */
  count?: number;
}

export interface LazyTreeLoaderState {
  /** Whether the tree is currently loading */
  isLoading: boolean;
  /** Loading error if any */
  error?: string;
  /** Map of all nodes by their path */
  nodes: Map<string, LazyTreeNode>;
  /** Root nodes of the tree */
  roots: LazyTreeNode[];
  /** Currently selected paths */
  selection: TreeSelectionState;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: ElectronAPI;
  }
}
