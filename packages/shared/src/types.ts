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
  /**
   * Unicode path problems (NFC/NFD mismatches, case collisions) detected during
   * the scan. Detection and reporting only — nothing is renamed. Absent when
   * there is nothing to report.
   */
  unicodeWarnings?: UnicodePathWarnings;
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
  /**
   * Youngest revision known without an extra round-trip: 0 for repositories
   * with no commits (r0), otherwise the highest returned entry revision.
   * Undefined when nothing can be derived (e.g. filtered empty ranges).
   */
  youngestRevision?: number;
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

interface MergeReadinessFinding {
  kind: string;
  severity: 'blocker' | 'warning' | 'info';
  detail: string;
  paths: string[];
  revisions: number[];
}
export interface MergeReadinessReport {
  sourceUrl: string;
  targetPath: string;
  targetUrl: string;
  repositoryUuid: string;
  ready: boolean;
  eligibleRevisions: number[];
  mergedRevisions: number[];
  findings: MergeReadinessFinding[];
  truncated: boolean;
}

type RevisionImpactCategory =
  | 'source'
  | 'test'
  | 'documentation'
  | 'configuration'
  | 'branch-or-tag';
interface RevisionImpactEvidence {
  revision: number;
  path: string;
  action: SvnLogPath['action'];
}
interface RevisionImpactGroup {
  category: RevisionImpactCategory;
  evidence: RevisionImpactEvidence[];
}
export interface RevisionImpactReport {
  target: string;
  revisions: number[];
  authors: string[];
  changedPathCount: number;
  truncated: boolean;
  groups: RevisionImpactGroup[];
}

export interface BranchComparisonReport {
  leftUrl: string;
  rightUrl: string;
  hasDifferences: boolean;
  changedFiles: Array<Pick<SvnDiffFile, 'oldPath' | 'newPath' | 'isBinary'>>;
  leftOnlyRevisions: number[];
  rightOnlyRevisions: number[];
  impactGroups: RevisionImpactGroup[];
  truncated: boolean;
}
export interface BranchComparisonResult {
  summary: BranchComparisonReport;
  diff: SvnDiffResult;
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
  'dialog:openDirectory': (defaultPath?: string) => string | null;
  'dialog:openFile': (filters?: FileFilter[]) => string | null;
  'dialog:saveFile': (defaultName?: string) => string | null;
};

export type AppChannels = {
  'app:getVersion': () => string;
  'app:getPlatform': () => 'win32' | 'darwin' | 'linux';
  'app:getHomePath': () => string;
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
/** Row density: 'compact' shrinks row heights/paddings app-wide. */
export type AppDensity = 'compact' | 'comfortable';
/**
 * High-contrast mode. `true`/`false` force the contrast-boosted token set on
 * or off; `'system'` (the default) follows the OS `prefers-contrast: more`
 * preference.
 */
export type HighContrastSetting = boolean | 'system';

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

// ============================================
// AI commit message types
// ============================================

export type AiCommitProvider =
  | 'codex'
  | 'claude'
  | 'anthropic'
  | 'azure-openai'
  | 'openai-compatible'
  | 'ollama';
export type AiCodexModel = 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol';
export type AiTaskKind =
  | 'commit-message'
  | 'draft-transformation'
  | 'pre-commit-review'
  | 'commit-plan'
  | 'diff-explanation'
  | 'release-notes'
  | 'conflict-resolution';
export type AiErrorCode =
  | 'cli_not_found'
  | 'authentication_required'
  | 'unsupported_model'
  | 'quota_exceeded'
  | 'timeout'
  | 'cancelled'
  | 'invalid_output'
  | 'input_too_large'
  | 'provider_unavailable'
  | 'consent_required'
  | 'secret_detected'
  | 'storage_unavailable'
  | 'unknown';
type AiCommitProviderPreference = 'auto' | AiCommitProvider;
type AiCommitMessageStyle = 'concise' | 'conventional';

interface AiCommitSettings {
  enabled: boolean;
  provider: AiCommitProviderPreference;
  codexModel: AiCodexModel;
  style: AiCommitMessageStyle;
  includeRecentHistory: boolean;
  historyLimit: number;
  maxDiffBytes: number;
  confirmBeforeSending: boolean;
  providerTimeoutMs: number;
  maxSessionInvocations: number;
  usageRetentionDays: number;
  usageMaxEntries: number;
}

export interface AiUsageEntry {
  id: string;
  task: AiTaskKind;
  provider: AiCommitProvider;
  model?: string;
  startedAt: string;
  durationMs: number;
  status: 'success' | 'error' | 'cancelled';
  errorCode?: AiErrorCode;
  inputBytes: number;
  truncated: boolean;
  redacted: boolean;
}

export interface AiPromptPreviewRequest {
  task: AiTaskKind;
  request:
    | AiCommitMessageRequest
    | AiTransformDraftRequest
    | AiSelectedPathsRequest
    | AiDiffExplanationRequest
    | AiReleaseNotesRequest
    | AiConflictProposalRequest;
}

export interface AiPromptPreviewResult {
  task: AiTaskKind;
  provider: AiCommitProvider;
  model?: string;
  prompt: string;
  inputBytes: number;
  truncated: boolean;
  redacted: boolean;
  omittedBinaryFiles: string[];
  includedHistoryMessages: number;
  /** Heuristic pre-send cost estimate for the resolved provider/model. */
  estimate?: AiCostEstimate;
  /** Outbound privacy scan applied to the previewed prompt. */
  privacy?: AiPromptPrivacyReport;
}

export type AiDraftTransformation =
  | 'shorter'
  | 'add-body'
  | 'remove-body'
  | 'imperative'
  | 'match-style'
  | 'include-issues'
  | 'explain-motivation'
  | 'regenerate';

export interface AiTransformDraftRequest {
  operationId: string;
  workingCopyPath: string;
  paths: string[];
  currentDraft: string;
  transformation: AiDraftTransformation;
}

export interface AiTransformDraftResult extends AiTaskMetadata {
  transformation: AiDraftTransformation;
  message: string;
  omittedBinaryFiles: string[];
}

export interface RepositoryAiPromptProfile {
  version: 1;
  commitPrefixes: string[];
  issueIdPattern: string;
  subjectMaxLength: number;
  bodyStyle: string;
  terminology: Record<string, string>;
  testPaths: string[];
  generatedPaths: string[];
  documentationPaths: string[];
  excludedPaths: string[];
  requiredReviewQuestions: string[];
  enabledDraftTransformations: AiDraftTransformation[];
  styleHints?: RepositoryAiStyleHints;
  updatedAt: string;
}

export interface RepositoryAiStyleHints {
  sampledCommits: number;
  averageSubjectLength: number;
  maxSubjectLength: number;
  imperativeMoodRatio: number;
  prefixCounts: Record<string, number>;
  dominantPrefix?: string;
  includesBodyRatio: number;
  bodyBulletStyle?: 'dash' | 'asterisk' | 'none';
  issueIdRatio: number;
  learnedAt?: string;
}

export interface AiWorkingCopyConsent {
  aiEnabled: boolean;
  updatedAt: string;
}

export interface RepositoryAiProfileImportPreview {
  valid: boolean;
  profile?: RepositoryAiPromptProfile;
  warnings: string[];
}

export interface AiCommitProviderStatus {
  provider: AiCommitProvider;
  available: boolean;
  version?: string;
  authenticated?: boolean;
  cliLoggedIn?: boolean;
  authMethod?: string;
  reason?: string;
  /** 'cli' providers execute a local CLI; 'http' providers call a remote or local HTTP endpoint. */
  kind?: 'cli' | 'http';
}

export interface AiCommitMessageRequest {
  operationId: string;
  workingCopyPath: string;
  paths: string[];
  existingMessage?: string;
}

export interface AiCommitMessageResult {
  message: string;
  provider: AiCommitProvider;
  model?: string;
  diffTruncated: boolean;
  omittedBinaryFiles: string[];
  redacted: boolean;
}

export type AiReviewSeverity = 'info' | 'warning' | 'danger';
export type AiDiffExplanationMode = 'summary' | 'why' | 'risks' | 'questions';

export interface AiTaskMetadata {
  provider: AiCommitProvider;
  model?: string;
  durationMs: number;
  truncated: boolean;
  redacted: boolean;
}

export interface AiReviewEvidence {
  filePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
}

export interface AiCommitReviewFinding {
  id: string;
  severity: AiReviewSeverity;
  category: string;
  title: string;
  detail: string;
  filePath: string;
  line: number;
  confidence: number;
  evidence: AiReviewEvidence[];
}

export interface AiCommitReviewResult extends AiTaskMetadata {
  summary: string;
  findings: AiCommitReviewFinding[];
}

interface AiLogicalCommitGroup {
  id: string;
  title: string;
  description: string;
  paths: string[];
  suggestedMessage: string;
}

export interface AiCommitPlanResult extends AiTaskMetadata {
  summary: string;
  groups: AiLogicalCommitGroup[];
}

export interface AiDiffExplanationResult extends AiTaskMetadata {
  mode: AiDiffExplanationMode;
  summary: string;
  rationale: string;
  risks: string[];
  reviewQuestions: string[];
  cached: boolean;
}

export interface AiReleaseNotesResult extends AiTaskMetadata {
  startRevision: number;
  endRevision: number;
  title: string;
  userFacing: string[];
  technical: string[];
  breakingChanges: string[];
  upgradeNotes: string[];
  references: string[];
}

export interface AiConflictProposalResult extends AiTaskMetadata {
  explanation: string;
  likelyIntent: string;
  confidence: number;
  unresolvedQuestions: string[];
  proposedMergedText: string;
}

export interface AiSelectedPathsRequest {
  operationId: string;
  workingCopyPath: string;
  paths: string[];
}

export interface AiDiffExplanationRequest {
  operationId: string;
  workingCopyPath: string;
  path: string;
  mode: AiDiffExplanationMode;
}

export interface AiReleaseNotesRequest {
  operationId: string;
  path: string;
  startRevision: number;
  endRevision: number;
}

export interface AiConflictProposalRequest {
  operationId: string;
  filePath: string;
  baseContent: string;
  mineContent: string;
  theirsContent: string;
}

// ============================================
// HTTP AI providers, credentials, streaming,
// cost estimates, and privacy gating (additive)
// ============================================

/** Providers executed over HTTP instead of a local CLI. */
export type AiHttpProvider = Extract<
  AiCommitProvider,
  'anthropic' | 'azure-openai' | 'openai-compatible' | 'ollama'
>;

export interface AiModelInfo {
  id: string;
  label: string;
  provider: AiCommitProvider;
  local: boolean;
  contextTokens?: number;
  defaultForProvider?: boolean;
  /** True when the entry was discovered live from the endpoint (e.g. Ollama /api/tags). */
  dynamic?: boolean;
}

export interface AiCostEstimate {
  provider: AiCommitProvider;
  model: string;
  inputChars: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  /** USD per one million input tokens; 0 when pricing is unknown. */
  inputUsdPerMillion: number;
  /** USD per one million output tokens; 0 when pricing is unknown. */
  outputUsdPerMillion: number;
  estimatedCostUsd: number;
  /** False when the model has no known pricing entry (estimate is then 0). */
  pricingKnown: boolean;
}

export interface AiCostEstimateRequest {
  provider: AiCommitProvider;
  model?: string;
  inputChars: number;
}

export interface AiProviderCredentialStatus {
  provider: AiCommitProvider;
  hasApiKey: boolean;
  hasBaseUrl: boolean;
  baseUrl?: string;
  modelOverride?: string;
  updatedAt?: string;
}

export interface AiCredentialsSummary {
  encryptionAvailable: boolean;
  storageUnavailableReason?: string;
  providers: AiProviderCredentialStatus[];
}

export interface AiProviderCredentialInput {
  provider: AiCommitProvider;
  apiKey?: string;
  baseUrl?: string;
  modelOverride?: string;
}

/** Push stream event for a running AI operation, sent on the `ai:stream` channel. */
export interface AiStreamEvent {
  operationId: string;
  /** Incremental assistant text produced by a streaming provider. */
  delta?: string;
  /** Terminal event: exactly one per finished operation attempt. */
  done?: boolean;
  /** Safe (redacted) error message for failed operations. */
  error?: string;
  errorCode?: AiErrorCode;
}

export type AiPrivacyFindingKind =
  | 'aws-access-key'
  | 'github-token'
  | 'private-key'
  | 'jwt'
  | 'secret-assignment'
  | 'high-entropy-assignment';

export interface AiPromptPrivacyReport {
  /** True when the outbound prompt was refused instead of sent. */
  blocked: boolean;
  /** True when at least one finding was redacted instead of blocked. */
  redacted: boolean;
  findingKinds: AiPrivacyFindingKind[];
}

/** Per-working-copy consent map persisted under `shellysvn:ai-consent:v1`. */
export type AiConsentMap = Record<string, AiWorkingCopyConsent>;

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

  // AI-assisted commit messages
  aiCommit: AiCommitSettings;

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
  /**
   * Contrast-boosted token overrides (stronger borders, brighter text,
   * distinct status colors) applied as a `.high-contrast` class on the app
   * root. Optional so existing stored settings merge cleanly; defaults to
   * 'system'. See `HighContrastSetting`.
   */
  highContrast?: HighContrastSetting;
  /** Row density driving `--row-height` / `--row-pad-y` app-wide. Optional; defaults to 'comfortable'. */
  density?: AppDensity;
  /** Root font scale multiplier (0.85 / 1 / 1.1 / 1.25) applied as font-size on the app root. Optional; defaults to 1. */
  fontScale?: number;

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
  /**
   * Unicode path problems (NFC/NFD mismatches, case collisions) detected during
   * the scan. Detection and reporting only — nothing is renamed. Absent when
   * there is nothing to report.
   */
  unicodeWarnings?: UnicodePathWarnings;
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

/**
 * Discovery payload for the app's loopback (127.0.0.1) status HTTP server:
 * the port it bound to this session and the per-session bearer token required
 * as `Authorization: Bearer <token>` on every request.
 */
export interface LocalStatusServerInfo {
  port: number;
  token: string;
}

export interface CancellableRequestOptions {
  signal?: AbortSignal;
}

interface SvnUpdateResult {
  success: boolean;
  revision: SvnOperationRevision;
  error?: string;
  output?: string;
}

/** An await-compatible update operation whose cancellation ID is available immediately. */
type SvnUpdateOperation = Promise<SvnUpdateResult> & {
  readonly operationId: string;
};

export interface SvnLogRequestOptions extends CancellableRequestOptions {
  stopOnCopy?: boolean;
  strictNodeHistory?: boolean;
  includeAllRevisionProperties?: boolean;
  revisionProperties?: string[];
}

export interface ElectronAPI {
  ai: {
    providers: () => Promise<AiCommitProviderStatus[]>;
    preparePrompt: (request: AiPromptPreviewRequest) => Promise<AiPromptPreviewResult>;
    usageHistory: () => Promise<AiUsageEntry[]>;
    clearUsageHistory: () => Promise<{ success: boolean }>;
    repositoryProfile: {
      get: (workingCopyPath: string) => Promise<RepositoryAiPromptProfile | null>;
      previewImport: (json: string) => Promise<RepositoryAiProfileImportPreview>;
      save: (
        workingCopyPath: string,
        profile: RepositoryAiPromptProfile
      ) => Promise<{ success: boolean }>;
      remove: (workingCopyPath: string) => Promise<{ success: boolean }>;
    };
    generateCommitMessage: (
      request: AiCommitMessageRequest,
      options?: CancellableRequestOptions
    ) => Promise<AiCommitMessageResult>;
    transformDraft: (
      request: AiTransformDraftRequest,
      options?: CancellableRequestOptions
    ) => Promise<AiTransformDraftResult>;
    reviewCommit: (
      request: AiSelectedPathsRequest,
      options?: CancellableRequestOptions
    ) => Promise<AiCommitReviewResult>;
    planCommit: (
      request: AiSelectedPathsRequest,
      options?: CancellableRequestOptions
    ) => Promise<AiCommitPlanResult>;
    explainDiff: (
      request: AiDiffExplanationRequest,
      options?: CancellableRequestOptions
    ) => Promise<AiDiffExplanationResult>;
    generateReleaseNotes: (
      request: AiReleaseNotesRequest,
      options?: CancellableRequestOptions
    ) => Promise<AiReleaseNotesResult>;
    proposeConflictResolution: (
      request: AiConflictProposalRequest,
      options?: CancellableRequestOptions
    ) => Promise<AiConflictProposalResult>;
    cancel: (operationId: string) => Promise<{ success: boolean; error?: string }>;
    /** Subscribe to streaming deltas for AI operations. Returns an unsubscribe function. */
    onAiStream: (callback: (event: AiStreamEvent) => void) => () => void;
    credentials: {
      summary: () => Promise<AiCredentialsSummary>;
      save: (input: AiProviderCredentialInput) => Promise<{ success: boolean; error?: string }>;
      remove: (provider: AiCommitProvider) => Promise<{ success: boolean }>;
    };
    estimateCost: (request: AiCostEstimateRequest) => Promise<AiCostEstimate>;
    listModels: (provider: AiCommitProvider) => Promise<AiModelInfo[]>;
    consent: {
      get: (workingCopyPath: string) => Promise<AiWorkingCopyConsent | null>;
      set: (workingCopyPath: string, aiEnabled: boolean) => Promise<{ success: boolean }>;
    };
  };
  svn: {
    capabilities: () => Promise<{
      shelving: boolean;
      nativeShelving: boolean;
      remoteProperties: boolean;
    }>;
    onMutation: (callback: (notification: SvnMutationNotification) => void) => () => void;
    getActiveWorkingCopyMutations: () => Promise<string[]>;
    onWorkingCopyMutationStateChanged: (callback: (paths: string[]) => void) => () => void;
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
    mergeReadiness: (sourceUrl: string, targetPath: string) => Promise<MergeReadinessReport>;
    revisionImpact: (
      target: string,
      limit?: number,
      revision?: number
    ) => Promise<RevisionImpactReport>;
    compareBranches: (leftUrl: string, rightUrl: string) => Promise<BranchComparisonResult>;
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
    ) => SvnUpdateOperation;
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
    /** Full lock record (owner, comment, created, expiry) for steal/break warning dialogs. */
    lockRecord: (path: string) => Promise<SvnLockRecordResult>;
    /** Steal a foreign lock after the user confirmed the shown owner. */
    stealLock: (
      path: string,
      comment?: string,
      confirmation?: LockForceConfirmation
    ) => Promise<SvnLockForceResult>;
    /** Break a foreign lock after the user confirmed the shown owner. */
    breakLock: (path: string, confirmation?: LockForceConfirmation) => Promise<SvnLockForceResult>;
    /** Set or replace the comment on an existing lock. */
    setLockComment: (
      path: string,
      comment: string,
      confirmation?: LockForceConfirmation
    ) => Promise<SvnLockForceResult>;
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
    /** Pre-flight validation (dry run) for `svn switch` / `svn relocate`. */
    validateSwitchOrRelocate: (
      input: SwitchRelocateInput
    ) => Promise<SwitchRelocateValidationResult>;
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
    /** Read one revision property by absolute repository URL. */
    getRevprop: (url: string, revision: string, propName: string) => Promise<RevpropValueResult>;
    /** Edit one revision property; requires the explicit confirmation payload. */
    editRevprop: (
      url: string,
      revision: string,
      propName: string,
      newValue: string,
      confirmation?: RevpropConfirmation
    ) => Promise<RevpropEditResult>;
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
    workingCopyHealth: (workingCopyPath: string) => Promise<WorkingCopyHealthReport>;
    /** Detect the trunk/branches/tags layout of a repository root URL. */
    getRepositoryLayout: (
      url: string,
      authSessionId?: string
    ) => Promise<SvnRepoLayout>;
    /** Analyze a working copy's pristine store (sizes, orphans, vacuum advice). */
    analyzePristine: (
      workingCopyPath: string,
      options?: Omit<PristineAnalysisOptions, 'signal'>
    ) => Promise<PristineAnalysisResult>;
    /** Scan the contents of changed files for likely secrets (redacted results). */
    scanSecrets: (
      paths: string[],
      options?: Omit<SecretScanOptions, 'signal'>
    ) => Promise<SecretScanResult>;
    /** Detect registered working copies whose folder moved/renamed on disk. */
    detectWcRelinks: () => Promise<WcRelinkDetectionResult>;
    /** Explicitly apply a relink proposal (registry + settings rewrite). */
    applyWcRelink: (proposal: RelinkProposal) => Promise<ApplyRelinkResult>;
    commandTimeline: () => Promise<SvnCommandTimelineEntry[]>;
    clearCommandTimeline: () => Promise<OperationResult>;
    trustServerCertificate: (
      url: string,
      errorText: string
    ) => Promise<{ success: boolean; error?: string }>;
    /** Record an explicit user rejection of a server certificate. */
    rejectServerCertificate: (
      url: string,
      errorText: string
    ) => Promise<{ success: boolean; error?: string; failureKind?: SslFailureKind }>;
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
    openDirectory: (defaultPath?: string) => Promise<string | null>;
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
    getHomePath: () => Promise<string>;
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
  lifecycle: {
    /** Stale `.svn/lock` leftovers detected at startup (one event per working copy). */
    onStaleWorkingCopyLock: (
      callback: (info: StaleWorkingCopyLockInfo) => void
    ) => () => void;
    getStaleWorkingCopyLocks: () => Promise<StaleWorkingCopyLockInfo[]>;
    /** Explicitly confirmed removal of a stale `.svn/lock` file. */
    removeStaleWorkingCopyLock: (
      workingCopyPath: string
    ) => Promise<{ success: boolean; error?: string }>;
    /** Mutations interrupted by the previous session's shutdown. */
    onInterruptedWorkingCopyMutations: (
      callback: (records: InterruptedMutationRecord[]) => void
    ) => () => void;
    getInterruptedWorkingCopyMutations: () => Promise<InterruptedMutationRecord[]>;
    /** Acknowledge recovery; clears the persisted interruption journal. */
    clearInterruptedWorkingCopyMutations: () => Promise<{ success: boolean; error?: string }>;
    /** Corroborated recovery proposals, one event per plan at startup. */
    onInterruptedMutationRecoveryPlan: (
      callback: (plan: InterruptedMutationRecoveryPlan) => void
    ) => () => void;
    getInterruptedMutationRecoveryPlans: () => Promise<InterruptedMutationRecoveryPlan[]>;
    /** Explicitly invoked recovery execution for one working copy's plan. */
    executeInterruptedMutationRecoveryPlan: (
      workingCopyPath: string
    ) => Promise<{
      success: boolean;
      error?: string;
      workingCopyPath?: string;
      steps?: InterruptedMutationRecoveryStepResult[];
    }>;
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

  /**
   * Redacted view of the active proxy / client-certificate / SSL trust state.
   * Optional for compatibility with older callers; produced by `svn:diagnostics`.
   */
  networkSecurity?: NetworkSecurityDiagnostics;
}

export type WorkingCopyHealthSeverity = 'info' | 'warning' | 'danger';

/**
 * A leftover `.svn/lock` file (backlog item #23): the working-copy admin area
 * is locked, most likely by a crashed or force-quit SVN command, and every
 * subsequent SVN command fails with "working copy locked" until it is removed.
 */
export interface StaleWorkingCopyLockInfo {
  workingCopyPath: string;
  lockPath: string;
  detectedAt: string;
}

/**
 * A working-copy mutation cancelled mid-flight by app shutdown (backlog item
 * #24), persisted across launches so the next session can offer recovery.
 */
export interface InterruptedMutationRecord {
  workingCopyPath: string;
  interruptedAt: string;
  reason: string;
}

// ============================================
// Unicode Path Warning Types (Phase 2)
// ============================================

/** Normalization form of a string, as classified by unicode-path detection. */
export type UnicodeForm = 'NFC' | 'NFD' | 'mixed';

/** Two canonically equivalent names that are not byte-identical. */
export interface NormalizationMismatch {
  /** Path/name exactly as the caller recorded it (e.g. as SVN reported it). */
  expected: string;
  /** Path/name exactly as it exists on disk. */
  onDisk: string;
  expectedForm: UnicodeForm;
  onDiskForm: UnicodeForm;
}

/** Two scanned paths that differ exactly but collide under case-insensitive comparison. */
export interface CaseCollisionPair {
  pathA: string;
  pathB: string;
}

/**
 * Unicode path problems attached (additively, only when non-empty) to status
 * results. Detection and reporting only — nothing is renamed.
 */
export interface UnicodePathWarnings {
  /** SVN-recorded path vs the path as it exists on disk — same text, different normalization form. */
  normalizationMismatches: NormalizationMismatch[];
  caseCollisions: CaseCollisionPair[];
}

// ============================================
// Disk-Full (ENOSPC) Types (Phase 2, item #30)
// ============================================

/** The long-running, disk-hungry operations disk-full recovery messaging targets. */
export type SvnDiskFullOperationKind = 'checkout' | 'export' | 'update';

/** Typed, actionable disk-full details attached to failed operation results. */
export interface SvnDiskFullErrorDetails {
  operationKind: SvnDiskFullOperationKind | null;
  targetPath: string | null;
  recoveryHint: string;
}

// ============================================
// Interrupted-Mutation Recovery Types (Phase 2, item #31)
// ============================================

/** Filesystem/CLI signals that a working-copy mutation was cut short. */
export type PartialMutationEvidenceKind =
  | 'stale-admin-lock'
  | 'missing-versioned-paths'
  | 'incomplete-tree';

export interface PartialMutationEvidence {
  kind: PartialMutationEvidenceKind;
  detail: string;
  paths: string[];
}

export interface PartialMutationDetection {
  workingCopyPath: string;
  detectedAt: string;
  hasEvidence: boolean;
  evidence: PartialMutationEvidence[];
  /** Non-fatal probe failures (e.g. the path is no longer a working copy). */
  notes: string[];
}

/** Remediation steps proposed for an interrupted mutation. Data only — nothing runs automatically. */
export type InterruptedMutationRecoveryStepKind =
  | 'svn-cleanup'
  | 'retry-update'
  | 'retry-commit'
  | 'verify-status';

export interface InterruptedMutationRecoveryStep {
  kind: InterruptedMutationRecoveryStepKind;
  /** SVN argv *without* the working-copy target; the executor appends it after `--`. */
  command: string[];
  description: string;
}

export interface InterruptedMutationRecoveryPlan {
  workingCopyPath: string;
  createdAt: string;
  /** Which signals contributed: the interruption journal, current-state detection, or both. */
  source: 'journal' | 'detection' | 'journal+detection';
  rationale: string;
  evidence: PartialMutationEvidence[];
  steps: InterruptedMutationRecoveryStep[];
}

export interface InterruptedMutationRecoveryStepResult {
  kind: InterruptedMutationRecoveryStepKind;
  /** The full argv that was executed. */
  command: string[];
  success: boolean;
  skipped: boolean;
  output: string;
  error?: string;
}

export interface BuildInterruptedMutationRecoveryPlanOptions {
  /**
   * When the caller knows which mutation was interrupted (e.g. an enriched
   * journal entry), the retry step matches it; otherwise it is inferred from
   * the evidence (missing/incomplete trees suggest an interrupted update).
   */
  interruptedOperation?: 'update' | 'commit';
}

// ============================================
// Repository Layout Detection Types (Phase 2)
// ============================================

export type SvnRepoLayoutKind = 'standard' | 'trunk-only' | 'custom' | 'empty';

export interface SvnRepoLayoutDir {
  /** Decoded entry name from `svn list`. */
  name: string;
  /** Canonical encoded repository URL. */
  url: string;
  kind: 'file' | 'dir';
}

export interface SvnRepoLayout {
  /** Layout classification summary; individual members below carry the details. */
  kind: SvnRepoLayoutKind;
  /** Canonical root URL the layout was detected from. */
  rootUrl: string;
  /** Canonical URLs when the conventional directories exist (case-insensitive detection). */
  trunk?: string;
  branches?: string;
  tags?: string;
  /** Root entries that are not part of the conventional trunk/branches/tags layout. */
  customDirs: SvnRepoLayoutDir[];
  /** True only for repositories with no commits (r0): nothing exists at the root. */
  empty: boolean;
  /** Youngest repository revision reported by `svn info` on the root (0 for r0). */
  youngestRevision: number;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  partial?: boolean;
  commandError?: SvnCommandErrorDetails;
}

// ============================================
// Network Security Diagnostics Types (Phase 2, items #37/#38)
// ============================================

/** Classified kind of an SVN server-certificate verification failure. */
export type SslFailureKind = 'unknown-ca' | 'cn-mismatch' | 'expired' | 'not-yet-valid' | 'other';

/**
 * Structured certificate failure behind an `ssl-error` connection status.
 * Everything here is safe to show in the renderer: kinds, host, fingerprint,
 * validity and trust state — never credentials.
 */
export interface NetworkSecuritySslFailure {
  failureKind: SslFailureKind;
  failureKinds: SslFailureKind[];
  fingerprint?: string;
  host: string;
  validUntil?: string;
  rawMessage: string;
  trustState: 'accepted' | 'rejected' | 'untrusted';
  /**
   * False once this (host, fingerprint, failureKind) has been prompted this
   * session or the certificate was rejected — the renderer must not offer the
   * trust prompt again, only the typed failure.
   */
  promptEligible: boolean;
}

/**
 * Redacted view of which proxy / auth / client-certificate settings are
 * ACTIVE: booleans, hostnames, ports and file paths only. Proxy and
 * client-certificate passwords must never appear here.
 */
export interface NetworkSecurityDiagnostics {
  proxy: {
    active: boolean;
    host: string | null;
    port: number | null;
    /** Username AND password configured — the values themselves are secret. */
    authenticated: boolean;
    bypassesLocalAddresses: boolean;
  };
  clientCertificate: {
    configured: boolean;
    path: string | null;
  };
  ssl: {
    verificationEnabled: boolean;
    /** Origins with an accepted cached trust — scheme://host only. */
    trustedOrigins: string[];
    failure?: NetworkSecuritySslFailure;
  };
  authSessions: {
    active: number;
    persistent: number;
  };
}

// ============================================
// Switch / Relocate Validation Types (Phase 2, item #50)
// ============================================

export type SwitchRelocateKind = 'switch' | 'relocate';

export type SwitchRelocateIssueCode =
  | 'INVALID_TARGET_URL'
  | 'MISSING_WORKING_COPY'
  | 'WORKING_COPY_INFO_UNAVAILABLE'
  | 'ALREADY_ON_TARGET'
  | 'RELOCATE_TARGET_UNCHANGED'
  | 'NO_COMMON_ROOT'
  | 'SHALLOW_COMMON_ROOT'
  | 'RELOCATE_WITHIN_REPOSITORY'
  | 'REPOSITORY_UUID_MISMATCH'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_INFO_UNAVAILABLE';

export interface SwitchRelocateIssue {
  code: SwitchRelocateIssueCode;
  message: string;
  severity: 'error' | 'warning';
}

export interface SwitchRelocateSummary {
  kind: SwitchRelocateKind;
  workingCopyPath: string;
  targetUrl: string;
  /** Current (possibly switched) URL of the working copy, when svn info answered. */
  currentUrl?: string;
  repositoryRoot?: string;
  repositoryUuid?: string;
  /** Repository root/uuid reported by the target URL (switch dry-run only). */
  targetRepositoryRoot?: string;
  targetRepositoryUuid?: string;
  /** Longest shared URL path-segment prefix between current and target (relocate). */
  commonRootPath?: string;
  /** HEAD revision of the target URL (switch dry-run), when reachable. */
  targetHeadRevision?: number;
  /** True when the target HEAD lookup failed but validation otherwise passed. */
  targetHeadUnavailable?: boolean;
}

export interface SwitchRelocateValidationResult {
  ok: boolean;
  issues: SwitchRelocateIssue[];
  summary?: SwitchRelocateSummary;
}

export interface SwitchRelocateInput {
  workingCopyPath: string;
  targetUrl: string;
  kind: SwitchRelocateKind;
  /**
   * Switch only: probe the target URL with `svn info` so the dialog can show
   * the head revision it would switch to. Defaults to true.
   */
  includeTargetRevision?: boolean;
}

// ============================================
// Lock Record / Steal / Break Types (Phase 2, item #57)
// ============================================

/**
 * Lock record including repository-reported expiry. Structurally compatible
 * with SvnLockInfo, which has no expiry fields.
 */
export interface SvnLockRecord extends SvnLockInfo {
  /** ISO 8601 timestamp when the repository auto-releases the lock, when reported. */
  expires?: string;
  /** True when `expires` lies in the past. */
  expired?: boolean;
}

export interface SvnLockRecordResult {
  lock?: SvnLockRecord;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  commandError?: SvnCommandErrorDetails;
}

/**
 * Explicit user-confirmation token required by stealLock/breakLock (and by
 * setLockComment when it would affect someone else's lock). The IPC layer
 * obtains this after showing the current owner via getLockRecord.
 */
export interface LockForceConfirmation {
  /** Literal true — only set after the user confirmed the owner warning. */
  confirmed: true;
  /** Lock owner that was displayed to the user when they confirmed. */
  confirmedOwner: string;
}

export type SvnLockForceFailureReason =
  | 'CONFIRMATION_REQUIRED'
  | 'OWNER_CHANGED'
  | 'NOT_LOCKED'
  | 'FOREIGN_LOCK'
  | 'HOOK_BLOCKED'
  | 'SVN_ERROR';

export interface SvnLockForceResult {
  success: boolean;
  reason?: SvnLockForceFailureReason;
  /** Fresh pre-op record (on refusal) or the resulting lock (on success). */
  lock?: SvnLockRecord;
  /** Owner of the lock that was stolen or broken. */
  previousOwner?: string;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  commandError?: SvnCommandErrorDetails;
}

export interface SvnLockListRecordResult extends SvnLockListResult {
  locks: SvnLockRecord[];
}

// ============================================
// Revision-Property Editing Types (Phase 2, item #70)
// ============================================

export interface RevpropConfirmation {
  /** Literal true — the user explicitly confirmed the revision-property edit. */
  confirmed: true;
  /** Literal true — the user acknowledged the server logs every revprop change. */
  acknowledgedServerLogging: true;
}

export type RevpropRejectionReason =
  | 'CONFIRMATION_REQUIRED'
  | 'SERVER_LOGGING_NOT_ACKNOWLEDGED'
  | 'INVALID_URL'
  | 'INVALID_REVISION'
  | 'INVALID_PROPERTY_NAME'
  | 'INVALID_VALUE'
  | 'SVN_ERROR';

export interface RevpropEditResult {
  success: boolean;
  reason?: RevpropRejectionReason;
  url?: string;
  revision?: string;
  propName?: string;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  commandError?: SvnCommandErrorDetails;
}

export interface RevpropValueResult {
  value?: string;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  commandError?: SvnCommandErrorDetails;
}

// ============================================
// Pristine Store Analysis Types (Phase 2, item #61)
// ============================================

export interface PristineSizeBucket {
  /** Human label, e.g. "64 KiB – 512 KiB". */
  label: string;
  /** Inclusive lower bound. */
  minBytes: number;
  /** Exclusive upper bound; null = unbounded. */
  maxBytes: number | null;
  fileCount: number;
  totalBytes: number;
}

export interface PristineLargestFile {
  /** Path relative to the pristine root, e.g. `ab/abcd1234….svn-base`. */
  name: string;
  bytes: number;
}

export interface PristineOrphanEstimate {
  /**
   * True when the wc.db that references the pristine store is missing — every
   * byte in the store is then unreferenced and safe to reclaim.
   */
  storeOrphaned: boolean;
  /** Files violating the `<sha1>.svn-base` shard layout; definitely orphaned. */
  malformedFileCount: number;
  malformedBytes: number;
  /** Full unreferenced-checksum detection requires wc.db SQLite access. */
  limitationNote: string;
}

export type PristineVacuumReason =
  | 'PRISTINE_ABSOLUTE_SIZE'
  | 'PRISTINE_TO_WC_RATIO'
  | 'ORPHANED_STORE';

export interface PristineVacuumRecommendation {
  recommended: boolean;
  reasons: PristineVacuumReason[];
  confidence: 'high' | 'medium' | 'low';
}

export interface PristineAnalysisResult {
  /** False when the path is not a working copy or has no pristine store. */
  available: boolean;
  unavailableReason?: 'not_a_working_copy' | 'pristine_store_missing';
  workingCopyPath: string;
  pristineRoot: string;
  totalBytes: number;
  fileCount: number;
  largestFileBytes: number;
  largestFiles: PristineLargestFile[];
  histogram: PristineSizeBucket[];
  orphanEstimate: PristineOrphanEstimate;
  /** Working-copy payload size (excluding .svn); null when not computed. */
  workingCopySize: { bytes: number; truncated: boolean } | null;
  vacuumRecommendation: PristineVacuumRecommendation;
  /** True when the walk stopped mid-scan (aggregates are partial). */
  cancelled: boolean;
  /** Walk errors (permission denials etc.), capped. */
  errors: string[];
  durationMs: number;
  scannedAt: string;
}

export interface PristineAnalysisOptions {
  signal?: AbortSignal;
  /**
   * Force or skip the working-copy size walk backing the ratio heuristic.
   * Default "auto": only walked when the pristine store is large enough for
   * the ratio heuristic to trigger.
   */
  computeWorkingCopySize?: boolean;
}

// ============================================
// Pre-Commit Secret Scan Types (Phase 2, item #76)
// ============================================

export type SecretSeverity = 'critical' | 'high' | 'medium' | 'low';

export type SecretPatternId =
  | 'aws-access-key'
  | 'github-token'
  | 'gitlab-token'
  | 'private-key-header'
  | 'slack-token'
  | 'google-api-key'
  | 'jwt'
  | 'secret-assignment'
  | 'high-entropy-string';

export interface SecretFinding {
  /** Path exactly as passed to the scan. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the match. */
  column: number;
  patternId: SecretPatternId;
  severity: SecretSeverity;
  /** Redacted preview; at most the first 4 characters of the secret. */
  redactedPreview: string;
}

export interface SecretScanOptions {
  signal?: AbortSignal;
  /** Files above this size are skipped (counted as oversize). Default 2 MiB. */
  maxFileBytes?: number;
  /** Per-file finding cap to bound result size. Default 50. */
  maxFindingsPerFile?: number;
}

export interface SecretFileError {
  path: string;
  error: string;
}

export interface SecretScanResult {
  findings: SecretFinding[];
  scannedFileCount: number;
  skippedBinaryCount: number;
  skippedOversizeCount: number;
  /** Lines longer than the scanned-line cap were truncated for scanning. */
  truncatedLineCount: number;
  errorFiles: SecretFileError[];
  /** True when the scan stopped mid-set (findings are partial). */
  cancelled: boolean;
  durationMs: number;
}

// ============================================
// Working-Copy Relink Types (Phase 2, item #60)
// ============================================

/** A working copy as recorded by the app's registry (monitor map and/or settings). */
export interface KnownWorkingCopyEntry {
  /** Registered on-disk path; may no longer exist. */
  path: string;
  /** Recorded repository URL, when the registry captured one. */
  url?: string;
  /** Recorded repository UUID, when the registry captured one. */
  repositoryUuid?: string;
}

export type RelinkMatchBasis = 'uuid' | 'url' | 'basename';
export type RelinkConfidence = 'high' | 'medium' | 'low';

export interface RelinkProposal {
  oldPath: string;
  newPath: string;
  matchedOn: RelinkMatchBasis;
  confidence: RelinkConfidence;
  /** Identity observed at newPath via `svn info` (never a secret). */
  url?: string;
  repositoryUuid?: string;
}

export interface WcRelinkDetectionResult {
  /** At most one proposal per registered working copy. */
  proposals: RelinkProposal[];
  /** Missing registered paths with no candidate match (user action needed). */
  unmatchedMissingPaths: string[];
  /** Registered paths still present on disk — nothing to do. */
  presentPaths: string[];
  /** How many candidate directories were verified with `svn info`. */
  checkedCandidateCount: number;
  /** True when detection stopped mid-set. */
  cancelled: boolean;
  errors: string[];
}

export interface ApplyRelinkResult {
  success: boolean;
  error?: string;
}


export interface WorkingCopyHealthIssue {
  id: string;
  kind:
    | 'conflict'
    | 'missing'
    | 'obstructed'
    | 'switched'
    | 'external'
    | 'mixed-revisions'
    | 'local-lock'
    | 'large-unversioned'
    | 'large-ignored'
    | 'nested-working-copy';
  severity: WorkingCopyHealthSeverity;
  title: string;
  detail: string;
  paths: string[];
}

export interface WorkingCopyHealthReport {
  workingCopyPath: string;
  scannedAt: string;
  minimumRevision: number | null;
  maximumRevision: number | null;
  counts: {
    changes: number;
    conflicts: number;
    switched: number;
    externals: number;
    unversioned: number;
    ignored: number;
  };
  issues: WorkingCopyHealthIssue[];
}

export interface SvnCommandTimelineEntry {
  id: string;
  operation: string;
  startedAt: string;
  durationMs: number;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  exitCode?: number;
  affectedPathCount: number;
  safeDiagnostic?: string;
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
