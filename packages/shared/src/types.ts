/**
 * Shared type definitions for ShellySVN
 * Used by both main process and renderer
 */

export type SvnCommandErrorCategory =
  | 'authentication'
  | 'certificate'
  | 'network'
  | 'working-copy'
  | 'conflict'
  | 'locked'
  | 'out-of-date'
  | 'not-found'
  | 'cancelled'
  | 'timeout'
  | 'validation'
  | 'command';

export interface SvnCommandErrorDetails {
  message: string;
  svnErrorCode?: string;
  category: SvnCommandErrorCategory;
  command?: string;
  target?: string;
  retryable: boolean;
  authenticationRequired: boolean;
  certificateError: boolean;
  /** Redacted stderr/message safe to cross IPC and display. */
  safeStderr: string;
}

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
  remoteUrl?: string;
  status: SvnStatusChar;
  revision?: number;
  author?: string;
  date?: string;
  isDirectory: boolean;
  /** For directories: number of changed items nested inside (recursive rollup). */
  childChangeCount?: number;
  propsStatus?: SvnStatusChar;
  remoteStatus?: SvnStatusChar;
  remotePropsStatus?: SvnStatusChar;
  remoteRevision?: number;
  remoteAuthor?: string;
  remoteDate?: string;
  changelist?: string;
  switched?: boolean;
  lock?: {
    owner: string;
    comment: string;
    date: string;
  };
  treeConflict?: {
    operation?: string;
    action?: string;
    reason?: string;
    type?: string;
  };
}

/** The depths `svn update --depth` / `--set-depth` accept. */
export type SvnUpdateDepth = 'empty' | 'files' | 'immediates' | 'infinity';

/**
 * An editor found on `PATH`. Only ever reported by the main process, which also
 * owns the mapping from `id` to the command it runs — the renderer names an
 * editor, it never supplies a command line.
 */
export interface CodeEditorInfo {
  id: string;
  label: string;
  /** The launcher that was found, e.g. `code`. Shown so the action is inspectable. */
  command: string;
  /** Whether it suits files, folders or both. Detected editors take both. */
  appliesTo?: 'files' | 'folders' | 'both';
  /** True for an application the user added in Settings. */
  custom?: boolean;
}

/**
 * One immediate child of a directory as reported by `svn info --depth
 * immediates`. Read from the working copy, so it costs no network round trip.
 */
export interface SvnChildCommitInfo {
  revision: number;
  author: string;
  date: string;
  /** Repository URL of the child. Only recorded for excluded children. */
  url?: string;
  /** Whether the child is a file or a directory — both can be excluded. */
  kind?: 'file' | 'dir';
  /**
   * The child is versioned but excluded from this checkout (`svn update
   * --set-depth exclude`), so it is absent from disk while still belonging to
   * the working copy. This is how an excluded folder stays offerable for
   * "Update to Working Copy" — nothing else reports it.
   */
  excluded?: boolean;
}

export interface SvnStatusResult {
  path: string;
  entries: SvnStatusEntry[];
  revision: number;
  /** Set when the status result includes repository-side update information */
  remoteChecked?: boolean;
  /** Set when XML parsing failed - entries may be incomplete or empty */
  parseError?: string;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

export interface WorkingCopyUpgradeStatus {
  path: string;
  required: boolean;
  reason?: string;
  error?: string;
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
  /** Non-standard revision properties requested with --with-revprop/--with-all-revprops. */
  revisionProperties?: Record<string, string>;
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
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

export type SvnMergeInfoKind = 'merged' | 'eligible';

export interface SvnMergeInfoResult {
  source: string;
  target: string;
  kind: SvnMergeInfoKind;
  revisions: number[];
  properties: Array<{
    value: string;
    inherited: boolean;
    inheritedFrom?: string;
  }>;
  rawOutput: string;
}

export interface SvnCatResult {
  target: string;
  revision?: string;
  contentBase64: string;
  byteLength: number;
  binary: boolean;
  truncated: boolean;
}

export interface SvnPropertyGetOptions {
  revision?: string;
  depth?: 'empty' | 'files' | 'immediates' | 'infinity';
  showInherited?: boolean;
}

export interface SvnProperty {
  name: string;
  value: string;
  inherited?: boolean;
  inheritedFrom?: string;
}

export interface SvnPropertyListResult {
  properties: SvnProperty[];
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

export interface SvnPropertyValueResult {
  value?: string;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

export interface SvnCleanupOptions {
  removeUnversioned?: boolean;
  removeIgnored?: boolean;
  vacuumPristines?: boolean;
  includeExternals?: boolean;
}

export interface SvnCleanupPreview {
  unversioned: string[];
  ignored: string[];
}

/** A verified repository revision, or null when SVN produced no authoritative revision. */
export type SvnOperationRevision = number | null;
export type SvnRevertDepth = 'empty' | 'files' | 'immediates' | 'infinity';
export interface SvnRevertPreview {
  depth: SvnRevertDepth;
  paths: string[];
}

export interface SvnMutationNotification {
  localPaths: string[];
  repositoryUrls: string[];
}

export interface SvnNativeAuthEntry {
  kind: string;
  realm: string;
  username?: string;
  certificate?: string;
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
  error?: string;
  commandError?: SvnCommandErrorDetails;
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

export interface SvnWorkingCopyContext {
  /** Administrative root of the working copy containing the selected path. */
  workingCopyRoot: string;
  repositoryRoot: string;
  repositoryUuid: string;
  /** Actual or derived repository URL corresponding exactly to `localPath`. */
  url: string;
  /** Normalized local path requested by the caller. */
  localPath: string;
  /** Nearest existing/versioned ancestor used to derive sparse or missing targets. */
  nearestVersionedPath: string;
  /** Actual SVN URL of `nearestVersionedPath` (respects switches and externals). */
  nearestVersionedUrl: string;
  /** True when `url` was derived for a path not directly described by `svn info`. */
  derived: boolean;
}

export interface SvnMutationResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  output?: string;
  commandError?: SvnCommandErrorDetails;
}

/** Canonical result for SVN actions that do not return domain-specific data. */
export type OperationResult = SvnMutationResult;

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

export interface SvnLockInfoResult {
  lock?: SvnLockInfo;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

export interface SvnLockResult {
  success: boolean;
  lock?: SvnLockInfo;
  error?: string;
  commandError?: SvnCommandErrorDetails;
}

export interface SvnUnlockResult {
  success: boolean;
  error?: string;
  commandError?: SvnCommandErrorDetails;
}

export interface SvnLockListResult {
  locks: SvnLockInfo[];
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
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
  'svn:statusRemote': (path: string) => SvnStatusResult;
  'svn:workingCopyUpgradeStatus': (path: string) => WorkingCopyUpgradeStatus;
  'svn:upgradeWorkingCopy': (path: string) => { success: boolean; output?: string; error?: string };
  'svn:log': (path: string, limit?: number, startRev?: number, endRev?: number) => SvnLogResult;
  'svn:info': (path: string) => SvnInfoResult;
  'svn:update': (
    path: string,
    depth?: 'empty' | 'files' | 'immediates' | 'infinity',
    options?: UpdateOptions
  ) => { success: boolean; revision: number };
  'svn:commit': (paths: string[], message: string) => { success: boolean; revision: number };
  'svn:revert': (paths: string[], depth?: SvnRevertDepth) => { success: boolean };
  'svn:add': (paths: string[]) => { success: boolean };
  'svn:delete': (paths: string[]) => { success: boolean };
  'svn:cleanup': (path: string) => { success: boolean };
  'svn:trustServerCertificate': (
    url: string,
    errorText: string
  ) => { success: boolean; error?: string };
};

export type DialogChannels = {
  'dialog:openDirectory': () => string | null;
  'dialog:openFile': (filters?: FileFilter[]) => string | null;
  'dialog:saveFile': (defaultName?: string) => string | null;
};

export type AppChannels = {
  'app:getVersion': () => string;
  'app:getPlatform': () => 'win32' | 'darwin' | 'linux';
  'app:openExternal': (url: string) => void;
};

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface MessageDialogOptions {
  type?: 'info' | 'warning' | 'error';
  title?: string;
  message: string;
  detail?: string;
}

export interface ConfirmDialogOptions extends MessageDialogOptions {
  confirmLabel?: string;
  cancelLabel?: string;
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
  externalToolOverrides: ExternalToolOverride[];
  diffOnDoubleClick: boolean;
  ignoreWhitespace: boolean;
  ignoreEol: boolean;
  contextLines: number;
}

/**
 * An application the user registered themselves, offered in "Open in" alongside
 * the editors found on `PATH`.
 *
 * `command` is whatever the user typed: an absolute path to a binary or `.app`,
 * or a bare launcher name to resolve like a shell would. `arguments` may contain
 * `{path}` where the file or folder should go; without it the path is appended,
 * which is what almost every launcher expects.
 */
export interface CustomOpenWithTool {
  /** Stable id, generated when the row is added. */
  id: string;
  name: string;
  command: string;
  arguments?: string;
  /** Which entries offer it. Defaults to both. */
  appliesTo?: 'files' | 'folders' | 'both';
}

export type ExternalToolRole = 'editor' | 'diff' | 'merge';
export type ExternalToolArgument = string;

export interface ExternalToolSummary {
  id: string;
  name: string;
  roles: ExternalToolRole[];
  builtIn: boolean;
  available: boolean;
  argumentTemplate: ExternalToolArgument[];
}

export interface ExternalToolOverride {
  extension: string;
  diffTool: string;
  mergeTool: string;
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

export interface NotificationOptions {
  title: string;
  body: string;
  type: 'success' | 'warning' | 'error' | 'info';
  silent?: boolean;
}

export interface ShellIntegrationStatus {
  platform: 'windows' | 'macos' | 'linux' | 'unsupported';
  supported: boolean;
  registered: boolean;
  helperPath: string | null;
  helperExists: boolean;
  contextMenuAvailable: boolean;
  iconOverlaysAvailable: boolean;
  finderBadgesAvailable: boolean;
  needsAdmin: boolean;
  fallbackAvailable: boolean;
  message: string;
  repairActions: string[];
  limitations: string[];
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
  updateChannel: UpdateChannel;
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
  /** Applications added by hand, listed in the "Open in" context menu. */
  customOpenWithTools: CustomOpenWithTool[];
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
  /** Default Explorer layout: classic list or Finder-style Miller columns. */
  explorerViewMode: 'list' | 'miller';
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

export type UpdateChannel = 'stable' | 'preview';

export type AppUpdateState =
  | {
      status: 'unsupported';
      installedVersion: string;
      channel: UpdateChannel;
      manualDownloadUrl: string;
      reason: 'development' | 'unpackaged' | 'unsupported-format';
    }
  | { status: 'idle' | 'checking' | 'upToDate'; installedVersion: string; channel: UpdateChannel }
  | {
      status: 'available' | 'downloaded';
      installedVersion: string;
      channel: UpdateChannel;
      availableVersion: string;
      releaseName?: string;
      releaseDate?: string;
      releaseNotes?: string;
      releaseUrl?: string;
    }
  | {
      status: 'downloading';
      installedVersion: string;
      channel: UpdateChannel;
      availableVersion: string;
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | {
      status: 'error';
      installedVersion: string;
      channel: UpdateChannel;
      code: 'network' | 'signature' | 'checksum' | 'permission' | 'cancelled' | 'unknown';
      message: string;
      retryable: boolean;
      source: 'scheduled' | 'manual' | 'download' | 'install';
    };

export type RestartAndInstallResult =
  | { started: true }
  | {
      started: false;
      reason: 'not-downloaded' | 'svn-operation-active' | 'unsupported';
    };

export type SvnCacheNamespace = 'info' | 'status' | 'log' | 'entries';

export interface SvnCacheEntry<T = unknown> {
  namespace: SvnCacheNamespace;
  key: string;
  path: string;
  data: T;
  cachedAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
}

export interface SvnCacheStats {
  infoCount: number;
  statusCount: number;
  logCount: number;
  entriesCount: number;
  totalSize: number;
  logSize: number;
  offlineSize: number;
  logBudgetBytes: number;
  offlineBudgetBytes: number;
  filePath: string;
}

export interface AppCacheBreakdown {
  electron: number;
  logs: number;
  offline: number;
  auth: number;
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
  /** Opaque main-process authentication session. */
  authSessionId?: string;
  /** Specific paths to checkout (sparse checkout) */
  sparsePaths?: string[];
}

export interface UpdateOptions {
  /** Target revision. HEAD or empty means latest. */
  revision?: string;
  /** Ignore externals during update. */
  ignoreExternals?: boolean;
  /** Force update, allowing obstructions to be replaced. */
  force?: boolean;
}

/**
 * Checkout progress information for streaming updates
 */
export interface CheckoutProgress {
  /** Stable ID that can be passed to the matching cancellation API. */
  operationId?: string;
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
  revision?: SvnOperationRevision;
}

export interface SvnOperationProgress extends CheckoutProgress {
  operationId: string;
  operation: 'checkout' | 'update' | 'commit' | 'export' | 'import' | 'merge';
}

export interface SvnMergeOptions {
  /** Second source for SVN's two-source/tree merge form. */
  secondSource?: string;
  dryRun?: boolean;
  depth?: 'empty' | 'files' | 'immediates' | 'infinity';
  ignoreAncestry?: boolean;
  allowMixedRevisions?: boolean;
  onlyRecordMerge?: boolean;
}

// ============================================
// Auth Types
// ============================================

export interface AuthSessionRequest {
  realm: string;
  username: string;
  password: string;
  persistence: 'session' | 'stored';
}

export interface AuthSession {
  id: string;
  realm: string;
  username: string;
  persistent: boolean;
  expiresAt: string | null;
}

export interface AuthStatus {
  available: boolean;
  username?: string;
  persistent: boolean;
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
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
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
  unsupportedReason?: string;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
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
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
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
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

// ============================================
// SVN Patch Types
// ============================================

export interface SvnPatchResult {
  success: boolean;
  appliedWithConflicts: boolean;
  filesPatched: number;
  rejects: number;
  rejectFiles: string[];
  offsetHunks: number;
  fuzzedHunks: number;
  output: string;
}

export interface SvnPatchApplyOptions {
  reverse?: boolean;
  ignoreWhitespace?: boolean;
  stripCount?: number;
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

export interface SvnExternalsResult {
  externals: SvnExternal[];
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

// ============================================
// SVN Execution Context (Settings Enforcement)
// ============================================

export interface SvnExecutionContext {
  proxySettings?: ProxySettings;
  connectionTimeout?: number;
  sslVerify?: boolean;
  clientCertificatePath?: string;
  svnConfigPath?: string;
  sshSettings?: SSHSettings;
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

export interface DeepStatusProgress {
  path: string;
  jobId: string;
  phase: 'queued' | 'running' | 'complete' | 'cancelled' | 'error';
  activeScans: number;
  queuedScans: number;
  elapsedMs: number;
  filesFound?: number;
  error?: string;
}

export interface DirectoryMetadataResult {
  parentPath: string | null;
  isVersioned: boolean;
  statusData: FsStatusResult;
  svnInfo: SvnInfoResult | null;
  workingCopyUpgradeStatus: WorkingCopyUpgradeStatus | null;
  workingCopyContext: SvnWorkingCopyContext | null;
}

export interface WebhookDeliverRequest {
  webhookId: string;
  deliveryId: string;
  url: string;
  event: string;
  timestamp: number;
  payload: unknown;
  timeout?: number;
}

export interface WebhookDeliverResult {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

export interface CancellableRequestOptions {
  signal?: AbortSignal;
}

export interface SvnLogRequestOptions extends CancellableRequestOptions {
  stopOnCopy?: boolean;
  strictNodeHistory?: boolean;
  includeAllRevisionProperties?: boolean;
  revisionProperties?: string[];
}

export interface ElectronAPI {
  svn: {
    capabilities: () => Promise<{
      shelving: boolean;
      nativeShelving: boolean;
      remoteProperties: boolean;
    }>;
    onMutation: (callback: (notification: SvnMutationNotification) => void) => () => void;
    nativeAuth: {
      list: (patterns?: string[]) => Promise<SvnNativeAuthEntry[]>;
      remove: (patterns: string[]) => Promise<{ success: boolean; output?: string }>;
    };
    status: (path: string, options?: CancellableRequestOptions) => Promise<SvnStatusResult>;
    statusRemote: (path: string, options?: CancellableRequestOptions) => Promise<SvnStatusResult>;
    workingCopyUpgradeStatus: (path: string) => Promise<WorkingCopyUpgradeStatus>;
    upgradeWorkingCopy: (
      path: string
    ) => Promise<{ success: boolean; output?: string; error?: string }>;
    log: (
      path: string,
      limit?: number,
      startRev?: number,
      endRev?: number,
      useMergeHistory?: boolean,
      options?: SvnLogRequestOptions
    ) => Promise<SvnLogResult>;
    mergeInfo: (
      source: string,
      target: string,
      kind: SvnMergeInfoKind
    ) => Promise<SvnMergeInfoResult>;
    cat: (
      target: string,
      revision?: string,
      options?: CancellableRequestOptions
    ) => Promise<SvnCatResult>;
    info: (path: string) => Promise<SvnInfoResult>;
    infoUrl: (url: string) => Promise<SvnInfoResult>;
    getWorkingCopyContext: (path: string) => Promise<SvnWorkingCopyContext | null>;
    diff: (
      path: string,
      revision?: string,
      options?: CancellableRequestOptions
    ) => Promise<SvnDiffResult>;
    diffUrls: (
      leftUrl: string,
      rightUrl: string,
      options?: CancellableRequestOptions
    ) => Promise<SvnDiffResult>;
    diffStreaming: (
      path: string,
      revision?: string,
      options?: CancellableRequestOptions
    ) => Promise<SvnDiffResult>;
    update: (
      path: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: UpdateOptions
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }>;
    updateWithProgress: (
      path: string,
      onProgress: (progress: CheckoutProgress) => void,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: UpdateOptions
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      error?: string;
      output?: string;
    }>;
    cancelUpdate: (operationId?: string) => Promise<{ success: boolean; error?: string }>;
    updateItem: (
      path: string
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }>;
    /** Sparse-exclude one or many versioned files/folders from this checkout. */
    exclude: (paths: string | string[]) => Promise<{ success: boolean; error?: string }>;
    updateToRevision: (
      workingCopyRoot: string,
      url: string,
      localPath: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      setDepthSticky?: boolean
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; error?: string }>;
    commit: (
      paths: string[],
      message: string
    ) => Promise<{ success: boolean; revision: SvnOperationRevision }>;
    commitWithProgress: (
      paths: string[],
      message: string,
      onProgress: (progress: SvnOperationProgress) => void
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      error?: string;
      output?: string;
    }>;
    cancelOperation: (operationId?: string) => Promise<{ success: boolean; error?: string }>;
    revert: (paths: string[], depth?: SvnRevertDepth) => Promise<{ success: boolean }>;
    revertPreview: (paths: string[], depth?: SvnRevertDepth) => Promise<SvnRevertPreview>;
    unversion: (paths: string[]) => Promise<{ success: boolean }>;
    childCommits: (path: string) => Promise<Record<string, SvnChildCommitInfo>>;
    add: (paths: string[]) => Promise<{ success: boolean }>;
    delete: (paths: string[]) => Promise<{ success: boolean }>;
    cleanup: (path: string, options?: SvnCleanupOptions) => Promise<{ success: boolean }>;
    cleanupPreview: (path: string) => Promise<SvnCleanupPreview>;
    lock: (path: string, message?: string) => Promise<{ success: boolean; output?: string }>;
    unlock: (path: string, force?: boolean) => Promise<{ success: boolean; output?: string }>;
    lockInfo: (path: string) => Promise<SvnLockInfoResult>;
    lockForce: (path: string, message?: string) => Promise<SvnLockResult>;
    unlockForce: (path: string) => Promise<SvnUnlockResult>;
    lockList: (path: string) => Promise<SvnLockListResult>;
    checkout: (
      url: string,
      path: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; output?: string }>;
    checkoutWithProgress: (
      url: string,
      path: string,
      onProgress: (progress: CheckoutProgress) => void,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; output?: string }>;
    cancelCheckout: (operationId?: string) => Promise<{ success: boolean; error?: string }>;
    export: (
      url: string,
      path: string,
      revision?: string
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; output?: string }>;
    exportWithProgress: (
      url: string,
      path: string,
      onProgress: (progress: SvnOperationProgress) => void,
      revision?: string
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      error?: string;
      output?: string;
    }>;
    import: (
      path: string,
      url: string,
      message: string
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; output?: string }>;
    importWithProgress: (
      path: string,
      url: string,
      message: string,
      onProgress: (progress: SvnOperationProgress) => void
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      error?: string;
      output?: string;
    }>;
    resolve: (
      path: string,
      resolution:
        | 'base'
        | 'mine-full'
        | 'theirs-full'
        | 'mine-conflict'
        | 'theirs-conflict'
        | 'working'
    ) => Promise<{ success: boolean }>;
    switch: (
      path: string,
      url: string,
      revision?: string
    ) => Promise<{ success: boolean; revision: SvnOperationRevision; output?: string }>;
    copy: (
      src: string,
      dst: string,
      message: string,
      authSessionId?: string
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      output?: string;
      error?: string;
    }>;
    remoteCreateFolder: (
      parentUrl: string,
      folderName: string,
      message: string,
      authSessionId?: string
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      output?: string;
      error?: string;
    }>;
    remoteDelete: (
      url: string,
      message: string,
      authSessionId?: string
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      output?: string;
      error?: string;
    }>;
    remoteMove: (
      srcUrl: string,
      dstUrl: string,
      message: string,
      authSessionId?: string
    ) => Promise<{
      success: boolean;
      revision: SvnOperationRevision;
      output?: string;
      error?: string;
    }>;
    merge: (
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
      options?: SvnMergeOptions
    ) => Promise<{ success: boolean; output?: string }>;
    mergeWithProgress: (
      source: string,
      target: string,
      onProgress: (progress: SvnOperationProgress) => void,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
      options?: SvnMergeOptions
    ) => Promise<{ success: boolean; error?: string; output?: string }>;
    relocate: (
      from: string,
      to: string,
      path: string
    ) => Promise<{ success: boolean; output?: string }>;
    changelist: {
      add: (paths: string[], changelist: string) => Promise<SvnMutationResult>;
      remove: (paths: string[]) => Promise<SvnMutationResult>;
      list: (path: string) => Promise<SvnChangelistResult>;
      delete: (name: string, path: string) => Promise<SvnMutationResult>;
    };
    move: (src: string, dst: string) => Promise<{ success: boolean; output?: string }>;
    copyLocal: (src: string, dst: string) => Promise<{ success: boolean; output?: string }>;
    shelve: {
      list: (path: string) => Promise<SvnShelveListResult>;
      save: (name: string, path: string, message?: string) => Promise<SvnMutationResult>;
      apply: (name: string, path: string) => Promise<SvnMutationResult>;
      delete: (name: string, path: string) => Promise<SvnMutationResult>;
    };
    proplist: (path: string, options?: SvnPropertyGetOptions) => Promise<SvnPropertyListResult>;
    propget: (
      target: string,
      name: string,
      options?: SvnPropertyGetOptions
    ) => Promise<SvnPropertyValueResult>;
    propset: (path: string, name: string, value: string) => Promise<SvnMutationResult>;
    propdel: (path: string, name: string) => Promise<SvnMutationResult>;
    propsetRemote: (
      url: string,
      name: string,
      value: string,
      message: string
    ) => Promise<SvnMutationResult>;
    propdelRemote: (url: string, name: string, message: string) => Promise<SvnMutationResult>;
    revpropget: (target: string, name: string, revision: string) => Promise<SvnPropertyValueResult>;
    revpropset: (
      target: string,
      name: string,
      value: string,
      revision: string
    ) => Promise<SvnMutationResult>;
    revpropdel: (target: string, name: string, revision: string) => Promise<SvnMutationResult>;
    blame: (
      path: string,
      startRevision?: number,
      endRevision?: number,
      options?: CancellableRequestOptions
    ) => Promise<SvnBlameResult>;
    list: (
      url: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      authSessionId?: string
    ) => Promise<SvnListResult>;
    patch: {
      create: (
        paths: string[],
        outputPath: string
      ) => Promise<{ success: boolean; output: string }>;
      apply: (
        patchPath: string,
        targetPath: string,
        dryRun?: boolean,
        options?: SvnPatchApplyOptions
      ) => Promise<SvnPatchResult>;
    };
    externals: {
      list: (path: string) => Promise<SvnExternalsResult>;
      add: (
        workingCopyPath: string,
        external: Omit<SvnExternal, 'name'> & { name?: string }
      ) => Promise<SvnMutationResult>;
      edit: (
        workingCopyPath: string,
        externalPath: string,
        external: Omit<SvnExternal, 'name'> & { name?: string }
      ) => Promise<SvnMutationResult>;
      remove: (workingCopyPath: string, externalPath: string) => Promise<SvnMutationResult>;
      update: (workingCopyPath: string, externalPath?: string) => Promise<SvnMutationResult>;
    };
    diagnostics: (workingCopyPath: string) => Promise<RepoDiagnostics>;
    trustServerCertificate: (
      url: string,
      errorText: string
    ) => Promise<{ success: boolean; error?: string }>;
  };
  external: {
    openDiffTool: (
      tool: string,
      left: string,
      right: string
    ) => Promise<{ success: boolean; error?: string }>;
    openWorkingCopyDiff: (input: {
      toolId: string;
      workingPath: string;
    }) => Promise<{ success: boolean; error?: string }>;
    openMergeTool: (
      tool: string,
      base: string,
      mine: string,
      theirs: string,
      merged: string
    ) => Promise<{ success: boolean; error?: string }>;
    openFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
    openFile: (path: string) => Promise<{ success: boolean; error?: string }>;
    /** Editors found on `PATH`, for the "Open in…" menu. */
    listEditors: (refresh?: boolean) => Promise<CodeEditorInfo[]>;
    openInEditor: (editorId: string, path: string) => Promise<{ success: boolean; error?: string }>;
    revealPath: (path: string) => Promise<{ success: boolean; error?: string }>;
  };
  externalTools: {
    list: () => Promise<ExternalToolSummary[]>;
    register: (role: ExternalToolRole) => Promise<ExternalToolSummary | null>;
    update: (
      id: string,
      update: Partial<Pick<ExternalToolSummary, 'name' | 'roles' | 'argumentTemplate'>>
    ) => Promise<ExternalToolSummary>;
    remove: (id: string) => Promise<void>;
  };
  monitor: {
    getWorkingCopies: () => Promise<WorkingCopyInfo[]>;
    addWorkingCopy: (path: string) => Promise<{ success: boolean; error?: string }>;
    removeWorkingCopy: (path: string) => Promise<{ success: boolean; removed: boolean }>;
    refreshStatus: (path: string) => Promise<WorkingCopyInfo | null>;
    startMonitoring: () => Promise<OperationResult>;
    stopMonitoring: () => Promise<OperationResult>;
  };
  fs: {
    listDirectory: (path: string) => Promise<FileInfo[]>;
    listDrives: () => Promise<FileInfo[]>;
    getDirectoryMetadata: (path: string, hasFiles?: boolean) => Promise<DirectoryMetadataResult>;
    getParent: (path: string) => Promise<string | null>;
    getStatus: (path: string) => Promise<FsStatusResult>;
    getDeepStatus: (path: string) => Promise<FsStatusResult>;
    onDeepStatusProgress: (callback: (progress: DeepStatusProgress) => void) => () => void;
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
    writeFileBase64: (
      path: string,
      contentBase64: string
    ) => Promise<{ success: boolean; error?: string }>;
    watch: (
      path: string,
      callback: (event: { path: string; eventType: string; changedPath: string }) => void,
      options?: { watchSvnOnly?: boolean }
    ) => (() => void) | undefined;
    unwatch: (path: string) => Promise<{ success: boolean }>;
    exists: (path: string) => Promise<boolean>;
  };
  dialog: {
    getPathForFile: (file: File) => string;
    openDirectory: () => Promise<string | null>;
    openFile: (filters?: FileFilter[]) => Promise<string | null>;
    saveFile: (defaultName?: string) => Promise<string | null>;
    showMessage: (options: {
      type?: 'info' | 'warning' | 'error';
      title?: string;
      message: string;
      detail?: string;
    }) => Promise<void>;
    confirm: (options: {
      type?: 'info' | 'warning' | 'error';
      title?: string;
      message: string;
      detail?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }) => Promise<boolean>;
  };
  app: {
    getVersion: () => Promise<string>;
    getPlatform: () => Promise<'win32' | 'darwin' | 'linux'>;
    openExternal: (url: string) => Promise<void>;
    clearCache: () => Promise<{ success: boolean; error?: string }>;
    getCacheSize: () => Promise<{ size: number; files: number }>;
    getCacheBreakdown: () => Promise<AppCacheBreakdown>;
    clearCacheTypes: (
      types: Array<'electron' | 'logs' | 'offline' | 'auth'>
    ) => Promise<{ success: boolean; error?: string }>;
    window: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
    };
  };
  updater: {
    getState: () => Promise<AppUpdateState>;
    check: () => Promise<AppUpdateState>;
    download: () => Promise<AppUpdateState>;
    cancelDownload: () => Promise<AppUpdateState>;
    restartAndInstall: () => Promise<RestartAndInstallResult>;
    onStateChanged: (callback: (state: AppUpdateState) => void) => () => void;
  };
  store: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: <T>(key: string, value: T) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  svnCache: {
    get: <T>(namespace: SvnCacheNamespace, key: string) => Promise<SvnCacheEntry<T> | null>;
    list: <T>(namespace: SvnCacheNamespace) => Promise<Array<SvnCacheEntry<T>>>;
    set: <T>(
      namespace: SvnCacheNamespace,
      key: string,
      path: string,
      data: T,
      ttlMs: number,
      operationStartedAt?: number
    ) => Promise<{ success: boolean; error?: string; stale?: boolean }>;
    delete: (namespace: SvnCacheNamespace, key: string) => Promise<void>;
    clearNamespace: (namespace: SvnCacheNamespace, clearedAt?: number) => Promise<void>;
    clearPath: (path: string, clearedAt?: number) => Promise<void>;
    clearAll: (clearedAt?: number) => Promise<void>;
    stats: () => Promise<SvnCacheStats>;
  };
  auth: {
    getStatus: (realm: string) => Promise<AuthStatus>;
    beginSession: (request: AuthSessionRequest) => Promise<AuthSession>;
    resumeSession: (realm: string) => Promise<AuthSession | null>;
    delete: (realm: string) => Promise<{ success: boolean }>;
    list: () => Promise<AuthListEntry[]>;
    clear: () => Promise<{ success: boolean }>;
    isEncryptionAvailable: () => Promise<boolean>;
  };
  webhook: {
    deliver: (request: WebhookDeliverRequest) => Promise<WebhookDeliverResult>;
    setSecret: (webhookId: string, secret: string) => Promise<void>;
    hasSecret: (webhookId: string) => Promise<boolean>;
    deleteSecret: (webhookId: string) => Promise<void>;
  };
  shell: {
    register: () => Promise<{ success: boolean; error?: string }>;
    unregister: () => Promise<{ success: boolean }>;
    isRegistered: () => Promise<{ registered: boolean }>;
    getStatus: () => Promise<ShellIntegrationStatus>;
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
        requiresConfirmation?: boolean;
      }) => void
    ) => () => void;
  };
  notification: {
    show: (options: NotificationOptions) => Promise<boolean>;
  };
}

// ============================================
// Repository Diagnostics Types
// ============================================

export interface DiagnosticResourceStatus {
  name: string;
  path: string;
  source: 'configured-client' | 'packaged-resource' | 'workspace-resource';
  exists: boolean;
  isFile: boolean;
  sizeBytes?: number;
  error?: string;
}

export interface RepoDiagnostics {
  // App/runtime info
  svnClientPath: string;
  svnVersion: string | null;
  svnVersionError?: string;
  minimumSvnVersion: string;
  svnVersionSupported: boolean | null;
  svnVersionWarning?: string;
  encryptionAvailable: boolean;
  isPackaged: boolean;
  resourcesPath: string | null;
  resourceStatus: DiagnosticResourceStatus[];

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
    electron: {
      process: {
        platform: NodeJS.Platform;
      };
    };
    api: ElectronAPI;
  }
}
