import type {
  AiCommitMessageRequest,
  AiCommitMessageResult,
  AiCommitPlanResult,
  AiCommitReviewResult,
  AiConflictProposalRequest,
  AiConflictProposalResult,
  AiDiffExplanationRequest,
  AiDiffExplanationResult,
  AiReleaseNotesRequest,
  AiReleaseNotesResult,
  AiSelectedPathsRequest,
  AiCommitProviderStatus,
  AuthSession,
  AuthSessionRequest,
  AuthStatus,
  AppCacheBreakdown,
  AppUpdateState,
  AuthListEntry,
  CheckoutOptions,
  CheckoutProgress,
  CodeEditorInfo,
  ConfirmDialogOptions,
  DeepStatusProgress,
  DirectoryMetadataResult,
  FileFilter,
  FileInfo,
  ExternalToolRole,
  ExternalToolSummary,
  FsStatusResult,
  MessageDialogOptions,
  NotificationOptions,
  RepoDiagnostics,
  BranchComparisonResult,
  MergeReadinessReport,
  RevisionImpactReport,
  SvnCommandTimelineEntry,
  RestartAndInstallResult,
  ShellIntegrationStatus,
  SvnBlameResult,
  SvnCatResult,
  SvnCacheEntry,
  SvnCacheNamespace,
  SvnCacheStats,
  SvnChangelistResult,
  SvnChildCommitInfo,
  SvnCleanupOptions,
  SvnCleanupPreview,
  SvnDiffResult,
  SvnExternal,
  SvnExternalsResult,
  SvnInfoResult,
  SvnListResult,
  SvnLockInfoResult,
  SvnLockListResult,
  SvnLockResult,
  SvnMergeInfoKind,
  SvnMergeInfoResult,
  SvnMutationNotification,
  SvnMutationFailureNotification,
  SvnNativeAuthEntry,
  SvnOperationRevision,
  SvnOperationProgress,
  SvnPatchApplyOptions,
  SvnPatchResult,
  SvnPropertyGetOptions,
  SvnPropertyListResult,
  SvnPropertyValueResult,
  SvnRevertDepth,
  SvnRevertPreview,
  SvnShelveListResult,
  SvnUnlockResult,
  SvnUpdateDepth,
  SvnWorkingCopyContext,
  UpdateOptions,
  WebhookDeliverRequest,
  WebhookDeliverResult,
  LocalStatusServerInfo,
  WorkingCopyInfo,
  WorkingCopyHealthReport,
  InterruptedMutationRecord,
  AuthRevealResult,
  InterruptedMutationRecoveryPlan,
  InterruptedMutationRecoveryStepResult,
  StaleWorkingCopyLockInfo,
  ApplyRelinkResult,
  LockForceConfirmation,
  PristineAnalysisOptions,
  PristineAnalysisResult,
  RelinkProposal,
  RevpropConfirmation,
  RevpropEditResult,
  RevpropValueResult,
  SecretScanOptions,
  SecretScanResult,
  SslFailureKind,
  SvnDiskFullErrorDetails,
  SvnLockForceResult,
  SvnLockRecordResult,
  SvnRepoLayout,
  SvnWorkingCopyRepairPlan,
  SvnWorkingCopyRepairResult,
  SwitchRelocateInput,
  SwitchRelocateValidationResult,
  WcRelinkDetectionResult,
} from './types';

type IpcCall<Args extends unknown[], Result> = {
  args: Args;
  result: Result;
};

type OperationResult = { success: boolean; error?: string };
type RevisionResult = {
  success: boolean;
  revision: SvnOperationRevision;
  error?: string;
  output?: string;
  /** Typed ENOSPC details present when the operation failed for lack of disk space. */
  diskFull?: SvnDiskFullErrorDetails;
};

export interface IpcInvokeContract {
  'ai:providers': IpcCall<[], AiCommitProviderStatus[]>;
  'ai:preparePrompt': IpcCall<
    [request: import('./types').AiPromptPreviewRequest],
    import('./types').AiPromptPreviewResult
  >;
  'ai:usageHistory': IpcCall<[], import('./types').AiUsageEntry[]>;
  'ai:clearUsageHistory': IpcCall<[], { success: boolean }>;
  'ai:repositoryProfile:get': IpcCall<
    [workingCopyPath: string],
    import('./types').RepositoryAiPromptProfile | null
  >;
  'ai:repositoryProfile:previewImport': IpcCall<
    [json: string],
    import('./types').RepositoryAiProfileImportPreview
  >;
  'ai:repositoryProfile:save': IpcCall<
    [workingCopyPath: string, profile: import('./types').RepositoryAiPromptProfile],
    { success: boolean }
  >;
  'ai:repositoryProfile:remove': IpcCall<[workingCopyPath: string], { success: boolean }>;
  'ai:generateCommitMessage': IpcCall<[request: AiCommitMessageRequest], AiCommitMessageResult>;
  'ai:transformDraft': IpcCall<
    [request: import('./types').AiTransformDraftRequest],
    import('./types').AiTransformDraftResult
  >;
  'ai:reviewCommit': IpcCall<[request: AiSelectedPathsRequest], AiCommitReviewResult>;
  'ai:planCommit': IpcCall<[request: AiSelectedPathsRequest], AiCommitPlanResult>;
  'ai:explainDiff': IpcCall<[request: AiDiffExplanationRequest], AiDiffExplanationResult>;
  'ai:generateReleaseNotes': IpcCall<[request: AiReleaseNotesRequest], AiReleaseNotesResult>;
  'ai:proposeConflictResolution': IpcCall<
    [request: AiConflictProposalRequest],
    AiConflictProposalResult
  >;
  'ai:cancel': IpcCall<[operationId: string], OperationResult>;
  'ai:credentials:summary': IpcCall<[], import('./types').AiCredentialsSummary>;
  'ai:credentials:save': IpcCall<
    [input: import('./types').AiProviderCredentialInput],
    OperationResult
  >;
  'ai:credentials:remove': IpcCall<
    [provider: import('./types').AiProviderId],
    { success: boolean }
  >;
  'ai:custom-providers:upsert': IpcCall<
    [input: import('./types').AiCustomProviderUpsertInput],
    { success: boolean; id?: string; error?: string }
  >;
  'ai:estimateCost': IpcCall<
    [request: import('./types').AiCostEstimateRequest],
    import('./types').AiCostEstimate
  >;
  'ai:listModels': IpcCall<
    [provider: import('./types').AiProviderId],
    import('./types').AiModelInfo[]
  >;
  'ai:consent:get': IpcCall<
    [workingCopyPath: string],
    import('./types').AiWorkingCopyConsent | null
  >;
  'ai:consent:set': IpcCall<[workingCopyPath: string, aiEnabled: boolean], { success: boolean }>;
  'svn:capabilities': IpcCall<
    [],
    { shelving: boolean; nativeShelving: boolean; remoteProperties: boolean }
  >;
  'svn:getActiveWorkingCopyMutations': IpcCall<[], string[]>;
  'svn:nativeAuth:list': IpcCall<[patterns?: string[]], SvnNativeAuthEntry[]>;
  'svn:nativeAuth:remove': IpcCall<[patterns: string[]], { success: boolean; output?: string }>;
  'svn:verifyCredentials': IpcCall<
    [url: string, username: string, password: string],
    import('./types').SvnCredentialVerifyResult
  >;
  'svn:cat': IpcCall<[target: string, revision?: string, workerJobId?: string], SvnCatResult>;
  'svn:status': IpcCall<[path: string, workerJobId?: string], import('./types').SvnStatusResult>;
  'svn:statusRemote': IpcCall<
    [path: string, workerJobId?: string],
    import('./types').SvnStatusResult
  >;
  'svn:workingCopyUpgradeStatus': IpcCall<
    [path: string],
    import('./types').WorkingCopyUpgradeStatus
  >;
  'svn:upgradeWorkingCopy': IpcCall<
    [path: string],
    { success: boolean; output?: string; error?: string }
  >;
  'svn:log': IpcCall<
    [
      path: string,
      limit?: number,
      startRev?: number,
      endRev?: number,
      useMergeHistory?: boolean,
      workerJobId?: string,
      options?: Omit<import('./types').SvnLogRequestOptions, 'signal'>,
    ],
    import('./types').SvnLogResult
  >;
  'svn:mergeInfo': IpcCall<
    [source: string, target: string, kind: SvnMergeInfoKind],
    SvnMergeInfoResult
  >;
  'svn:mergeReadiness': IpcCall<[sourceUrl: string, targetPath: string], MergeReadinessReport>;
  'svn:revisionImpact': IpcCall<
    [target: string, limit?: number, revision?: number],
    RevisionImpactReport
  >;
  'svn:compareBranches': IpcCall<[leftUrl: string, rightUrl: string], BranchComparisonResult>;
  'svn:info': IpcCall<[path: string], SvnInfoResult>;
  'svn:infoUrl': IpcCall<[url: string], SvnInfoResult>;
  'svn:getWorkingCopyContext': IpcCall<[path: string], SvnWorkingCopyContext | null>;
  'svn:diff': IpcCall<[path: string, revision?: string, workerJobId?: string], SvnDiffResult>;
  'svn:diffUrls': IpcCall<[leftUrl: string, rightUrl: string, workerJobId?: string], SvnDiffResult>;
  'svn:diffStreaming': IpcCall<
    [path: string, revision?: string, workerJobId?: string],
    SvnDiffResult
  >;
  'svn:update': IpcCall<
    [path: string, depth?: 'empty' | 'files' | 'immediates' | 'infinity', options?: UpdateOptions],
    RevisionResult
  >;
  'svn:updateWithProgress': IpcCall<
    [
      updateId: string,
      path: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: UpdateOptions,
    ],
    RevisionResult
  >;
  'svn:cancelUpdate': IpcCall<[updateId: string], OperationResult>;
  'svn:cancelWorkerJob': IpcCall<[workerJobId: string], OperationResult>;
  'svn:updateItem': IpcCall<[path: string], RevisionResult>;
  'svn:updateToRevision': IpcCall<
    [
      workingCopyRoot: string,
      url: string,
      localPath: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      setDepthSticky?: boolean,
    ],
    RevisionResult
  >;
  'svn:commit': IpcCall<[paths: string[], message: string], RevisionResult>;
  'svn:commitWithProgress': IpcCall<
    [operationId: string, paths: string[], message: string],
    RevisionResult
  >;
  'svn:cancelOperation': IpcCall<[operationId: string], OperationResult>;
  'svn:revert': IpcCall<[paths: string[], depth?: SvnRevertDepth], OperationResult>;
  'svn:revertPreview': IpcCall<[paths: string[], depth?: SvnRevertDepth], SvnRevertPreview>;
  'svn:unversion': IpcCall<[paths: string[]], OperationResult>;
  'svn:exclude': IpcCall<[paths: string | string[]], OperationResult>;
  'svn:childCommits': IpcCall<[path: string], Record<string, SvnChildCommitInfo>>;
  'svn:add': IpcCall<[paths: string[]], OperationResult>;
  'svn:delete': IpcCall<[paths: string[]], OperationResult>;
  'svn:cleanup': IpcCall<[path: string, options?: SvnCleanupOptions], OperationResult>;
  'svn:cleanupPreview': IpcCall<[path: string], SvnCleanupPreview>;
  'svn:repairWorkingCopy': IpcCall<[plan: SvnWorkingCopyRepairPlan], SvnWorkingCopyRepairResult>;
  'svn:lock': IpcCall<[path: string, message?: string], OperationResult>;
  'svn:unlock': IpcCall<[path: string, force?: boolean], OperationResult>;
  'svn:lockInfo': IpcCall<[path: string], SvnLockInfoResult>;
  'svn:lockForce': IpcCall<[path: string, message?: string], SvnLockResult>;
  'svn:unlockForce': IpcCall<[path: string], SvnUnlockResult>;
  'svn:lockList': IpcCall<[path: string], SvnLockListResult>;
  'svn:lockRecord': IpcCall<[path: string], SvnLockRecordResult>;
  'svn:stealLock': IpcCall<
    [path: string, comment?: string, confirmation?: LockForceConfirmation],
    SvnLockForceResult
  >;
  'svn:breakLock': IpcCall<
    [path: string, confirmation?: LockForceConfirmation],
    SvnLockForceResult
  >;
  'svn:setLockComment': IpcCall<
    [path: string, comment: string, confirmation?: LockForceConfirmation],
    SvnLockForceResult
  >;
  'svn:checkout': IpcCall<
    [
      url: string,
      path: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions,
    ],
    RevisionResult
  >;
  'svn:checkoutWithProgress': IpcCall<
    [
      checkoutId: string,
      url: string,
      path: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      options?: CheckoutOptions,
    ],
    RevisionResult
  >;
  'svn:cancelCheckout': IpcCall<[checkoutId: string], OperationResult>;
  'svn:export': IpcCall<[url: string, path: string, revision?: string], RevisionResult>;
  'svn:exportWithProgress': IpcCall<
    [operationId: string, url: string, path: string, revision?: string],
    RevisionResult
  >;
  'svn:import': IpcCall<[path: string, url: string, message: string], RevisionResult>;
  'svn:importWithProgress': IpcCall<
    [operationId: string, path: string, url: string, message: string],
    RevisionResult
  >;
  'svn:resolve': IpcCall<
    [path: string, resolution: string, depth?: SvnUpdateDepth],
    OperationResult
  >;
  'svn:switch': IpcCall<[path: string, url: string, revision?: string], RevisionResult>;
  'svn:validateSwitchOrRelocate': IpcCall<
    [input: SwitchRelocateInput],
    SwitchRelocateValidationResult
  >;
  'svn:copy': IpcCall<
    [src: string, dst: string, message: string, authSessionId?: string],
    RevisionResult
  >;
  'svn:remoteCreateFolder': IpcCall<
    [parentUrl: string, folderName: string, message: string, authSessionId?: string],
    RevisionResult
  >;
  'svn:remoteDelete': IpcCall<
    [url: string, message: string, authSessionId?: string],
    RevisionResult
  >;
  'svn:remoteMove': IpcCall<
    [srcUrl: string, dstUrl: string, message: string, authSessionId?: string],
    RevisionResult
  >;
  'svn:merge': IpcCall<
    [
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
      options?: import('./types').SvnMergeOptions,
    ],
    OperationResult
  >;
  'svn:mergeWithProgress': IpcCall<
    [
      operationId: string,
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
      options?: import('./types').SvnMergeOptions,
    ],
    OperationResult
  >;
  'svn:relocate': IpcCall<[from: string, to: string, path: string], OperationResult>;
  'svn:move': IpcCall<[src: string, dst: string], OperationResult>;
  'svn:copyLocal': IpcCall<[src: string, dst: string], OperationResult>;
  'svn:changelist:add': IpcCall<[paths: string[], changelist: string], OperationResult>;
  'svn:changelist:remove': IpcCall<[paths: string[]], OperationResult>;
  'svn:changelist:list': IpcCall<[path: string], SvnChangelistResult>;
  'svn:changelist:delete': IpcCall<[name: string, path: string], OperationResult>;
  'svn:shelve:list': IpcCall<[path: string], SvnShelveListResult>;
  'svn:shelve:save': IpcCall<[name: string, path: string, message?: string], OperationResult>;
  'svn:shelve:apply': IpcCall<[name: string, path: string], OperationResult>;
  'svn:shelve:delete': IpcCall<[name: string, path: string], OperationResult>;
  'svn:proplist': IpcCall<[path: string, options?: SvnPropertyGetOptions], SvnPropertyListResult>;
  'svn:propget': IpcCall<
    [target: string, name: string, options?: SvnPropertyGetOptions],
    SvnPropertyValueResult
  >;
  'svn:propset': IpcCall<[path: string, name: string, value: string], OperationResult>;
  'svn:propdel': IpcCall<[path: string, name: string], OperationResult>;
  'svn:propsetRemote': IpcCall<
    [url: string, name: string, value: string, message: string],
    OperationResult
  >;
  'svn:propdelRemote': IpcCall<[url: string, name: string, message: string], OperationResult>;
  'svn:revpropget': IpcCall<
    [target: string, name: string, revision: string],
    SvnPropertyValueResult
  >;
  'svn:revpropset': IpcCall<
    [target: string, name: string, value: string, revision: string],
    OperationResult
  >;
  'svn:revpropdel': IpcCall<[target: string, name: string, revision: string], OperationResult>;
  'svn:getRevprop': IpcCall<[url: string, revision: string, propName: string], RevpropValueResult>;
  'svn:editRevprop': IpcCall<
    [
      url: string,
      revision: string,
      propName: string,
      newValue: string,
      confirmation?: RevpropConfirmation,
    ],
    RevpropEditResult
  >;
  'svn:blame': IpcCall<
    [path: string, startRevision?: number, endRevision?: number, workerJobId?: string],
    SvnBlameResult
  >;
  'svn:list': IpcCall<
    [
      url: string,
      revision?: string,
      depth?: 'empty' | 'files' | 'immediates' | 'infinity',
      authSessionId?: string,
    ],
    SvnListResult
  >;
  'svn:patch:create': IpcCall<
    [paths: string[], outputPath: string],
    { success: boolean; output: string }
  >;
  'svn:patch:apply': IpcCall<
    [patchPath: string, targetPath: string, dryRun?: boolean, options?: SvnPatchApplyOptions],
    SvnPatchResult
  >;
  'svn:externals:list': IpcCall<[path: string], SvnExternalsResult>;
  'svn:externals:add': IpcCall<
    [workingCopyPath: string, external: Omit<SvnExternal, 'name'> & { name?: string }],
    OperationResult
  >;
  'svn:externals:remove': IpcCall<[workingCopyPath: string, externalPath: string], OperationResult>;
  'svn:externals:edit': IpcCall<
    [
      workingCopyPath: string,
      externalPath: string,
      external: Omit<SvnExternal, 'name'> & { name?: string },
    ],
    OperationResult
  >;
  'svn:externals:update': IpcCall<
    [workingCopyPath: string, externalPath?: string],
    OperationResult
  >;
  'svn:diagnostics': IpcCall<[workingCopyPath: string], RepoDiagnostics>;
  'svn:getRepositoryLayout': IpcCall<[url: string, authSessionId?: string], SvnRepoLayout>;
  'svn:analyzePristine': IpcCall<
    [workingCopyPath: string, options?: Omit<PristineAnalysisOptions, 'signal'>],
    PristineAnalysisResult
  >;
  'svn:scanSecrets': IpcCall<
    [paths: string[], options?: Omit<SecretScanOptions, 'signal'>],
    SecretScanResult
  >;
  'svn:detectWcRelinks': IpcCall<[], WcRelinkDetectionResult>;
  'svn:applyWcRelink': IpcCall<[proposal: RelinkProposal], ApplyRelinkResult>;
  'svn:workingCopyHealth': IpcCall<[workingCopyPath: string], WorkingCopyHealthReport>;
  'svn:commandTimeline': IpcCall<[], SvnCommandTimelineEntry[]>;
  'svn:commandTimeline:clear': IpcCall<[], OperationResult>;
  'svn:trustServerCertificate': IpcCall<
    [url: string, errorText: string],
    { success: boolean; error?: string }
  >;
  'svn:rejectServerCertificate': IpcCall<
    [url: string, errorText: string],
    { success: boolean; error?: string; failureKind?: SslFailureKind }
  >;

  'fs:listDirectory': IpcCall<[path: string], FileInfo[]>;
  'fs:listDrives': IpcCall<[], FileInfo[]>;
  'fs:getDirectoryMetadata': IpcCall<[path: string, hasFiles?: boolean], DirectoryMetadataResult>;
  'fs:getParent': IpcCall<[path: string], string | null>;
  'fs:getStatus': IpcCall<[path: string], FsStatusResult>;
  'fs:getDeepStatus': IpcCall<[path: string], FsStatusResult>;
  'fs:applyStatus': IpcCall<
    [
      files: FileInfo[],
      directStatus: FsStatusResult['directStatus'],
      allEntries: FsStatusResult['allEntries'],
    ],
    FileInfo[]
  >;
  'fs:cancelScan': IpcCall<[path: string], OperationResult>;
  'fs:isVersioned': IpcCall<[path: string], boolean>;
  'fs:readFile': IpcCall<[path: string], { success: boolean; content?: string; error?: string }>;
  'fs:readImageAsBase64': IpcCall<
    [path: string],
    { success: boolean; data?: string; error?: string }
  >;
  'fs:getFolderSizes': IpcCall<[folderPaths: string[]], Record<string, number>>;
  'fs:copyFile': IpcCall<[source: string, target: string], OperationResult>;
  'fs:writeFile': IpcCall<[path: string, content: string], OperationResult>;
  'fs:writeFileBase64': IpcCall<[path: string, contentBase64: string], OperationResult>;
  'fs:watch': IpcCall<[path: string, options?: { watchSvnOnly?: boolean }], OperationResult>;
  'fs:unwatch': IpcCall<[path: string], OperationResult>;
  'fs:exists': IpcCall<[path: string], boolean>;

  'dialog:openDirectory': IpcCall<[defaultPath?: string], string | null>;
  'dialog:openFile': IpcCall<[filters?: FileFilter[]], string | null>;
  'dialog:saveFile': IpcCall<[defaultName?: string], string | null>;
  'dialog:showMessage': IpcCall<[options: MessageDialogOptions], void>;
  'dialog:confirm': IpcCall<[options: ConfirmDialogOptions], boolean>;

  'app:getVersion': IpcCall<[], string>;
  'app:getPlatform': IpcCall<[], 'win32' | 'darwin' | 'linux'>;
  'app:getHomePath': IpcCall<[], string>;
  'app:openExternal': IpcCall<[url: string], OperationResult>;
  'app:clearCache': IpcCall<[], OperationResult>;
  'app:getCacheSize': IpcCall<[], { size: number; files: number }>;
  'app:getCacheBreakdown': IpcCall<[], AppCacheBreakdown>;
  'app:clearCacheTypes': IpcCall<
    [types: Array<'electron' | 'logs' | 'offline' | 'auth'>],
    OperationResult
  >;
  'app:window:minimize': IpcCall<[], void>;
  'app:window:maximize': IpcCall<[], void>;
  'app:window:close': IpcCall<[], void>;
  'app:window:isMaximized': IpcCall<[], boolean>;

  'updater:getState': IpcCall<[], AppUpdateState>;
  'updater:check': IpcCall<[], AppUpdateState>;
  'updater:download': IpcCall<[], AppUpdateState>;
  'updater:cancelDownload': IpcCall<[], AppUpdateState>;
  'updater:restartAndInstall': IpcCall<[], RestartAndInstallResult>;

  'store:get': IpcCall<[key: string], unknown>;
  'store:set': IpcCall<[key: string, value: unknown], void>;
  'store:delete': IpcCall<[key: string], void>;

  'svnCache:get': IpcCall<[namespace: SvnCacheNamespace, key: string], SvnCacheEntry | null>;
  'svnCache:list': IpcCall<[namespace: SvnCacheNamespace], SvnCacheEntry[]>;
  'svnCache:set': IpcCall<
    [
      namespace: SvnCacheNamespace,
      key: string,
      path: string,
      data: unknown,
      ttlMs: number,
      operationStartedAt?: number,
    ],
    { success: boolean; error?: string; stale?: boolean }
  >;
  'svnCache:delete': IpcCall<[namespace: SvnCacheNamespace, key: string], void>;
  'svnCache:clearNamespace': IpcCall<[namespace: SvnCacheNamespace, clearedAt?: number], void>;
  'svnCache:clearPath': IpcCall<[path: string, clearedAt?: number], void>;
  'svnCache:clearAll': IpcCall<[clearedAt?: number], void>;
  'svnCache:stats': IpcCall<[], SvnCacheStats>;

  'auth:getStatus': IpcCall<[realm: string], AuthStatus>;
  'auth:beginSession': IpcCall<[request: AuthSessionRequest], AuthSession>;
  'auth:resumeSession': IpcCall<[realm: string], AuthSession | null>;
  'auth:delete': IpcCall<[realm: string], OperationResult>;
  'auth:list': IpcCall<[], AuthListEntry[]>;
  'auth:clear': IpcCall<[], OperationResult>;
  'auth:isEncryptionAvailable': IpcCall<[], boolean>;
  'auth:reveal': IpcCall<[realm: string], AuthRevealResult>;

  'monitor:getWorkingCopies': IpcCall<[], WorkingCopyInfo[]>;
  'monitor:addWorkingCopy': IpcCall<[path: string], OperationResult>;
  'monitor:removeWorkingCopy': IpcCall<
    [path: string],
    { success: boolean; removed: boolean; error?: string }
  >;
  'monitor:refreshStatus': IpcCall<[path: string], WorkingCopyInfo | null>;
  'monitor:startMonitoring': IpcCall<[], OperationResult>;
  'monitor:stopMonitoring': IpcCall<[], OperationResult>;

  'external:openDiffTool': IpcCall<[tool: string, left: string, right: string], OperationResult>;
  'external:openWorkingCopyDiff': IpcCall<
    [input: { toolId: string; workingPath: string }],
    OperationResult
  >;
  'external:openMergeTool': IpcCall<
    [tool: string, base: string, mine: string, theirs: string, merged: string],
    OperationResult
  >;
  'externalTools:list': IpcCall<[], ExternalToolSummary[]>;
  'externalTools:register': IpcCall<[role: ExternalToolRole], ExternalToolSummary | null>;
  'externalTools:update': IpcCall<
    [id: string, update: Partial<Pick<ExternalToolSummary, 'name' | 'roles' | 'argumentTemplate'>>],
    ExternalToolSummary
  >;
  'externalTools:remove': IpcCall<[id: string], void>;
  'external:openFolder': IpcCall<[path: string], OperationResult>;
  'external:openFile': IpcCall<[path: string], OperationResult>;
  'external:revealPath': IpcCall<[path: string], OperationResult>;
  'external:listEditors': IpcCall<[refresh?: boolean], CodeEditorInfo[]>;
  'external:openInEditor': IpcCall<[editorId: string, path: string], OperationResult>;

  'webhook:deliver': IpcCall<[request: WebhookDeliverRequest], WebhookDeliverResult>;
  'webhook:setSecret': IpcCall<[webhookId: string, secret: string], void>;
  'webhook:hasSecret': IpcCall<[webhookId: string], boolean>;
  'webhook:deleteSecret': IpcCall<[webhookId: string], void>;
  'notification:show': IpcCall<[options: NotificationOptions], boolean>;

  'shell:register': IpcCall<[], OperationResult>;
  'shell:unregister': IpcCall<[], OperationResult>;
  'shell:isRegistered': IpcCall<[], { registered: boolean }>;
  'shell:getStatus': IpcCall<[], ShellIntegrationStatus>;
  'shell:updateOverlay': IpcCall<[path: string, status: string], OperationResult>;
  'shell:clearOverlay': IpcCall<[path: string], OperationResult>;
  'shell:clearAllOverlays': IpcCall<[], OperationResult>;

  'lifecycle:getStaleWorkingCopyLocks': IpcCall<[], StaleWorkingCopyLockInfo[]>;
  'lifecycle:removeStaleWorkingCopyLock': IpcCall<[workingCopyPath: string], OperationResult>;
  'lifecycle:getInterruptedWorkingCopyMutations': IpcCall<[], InterruptedMutationRecord[]>;
  'lifecycle:clearInterruptedWorkingCopyMutations': IpcCall<[], OperationResult>;
  'lifecycle:getInterruptedMutationRecoveryPlans': IpcCall<[], InterruptedMutationRecoveryPlan[]>;
  'lifecycle:executeInterruptedMutationRecoveryPlan': IpcCall<
    [workingCopyPath: string],
    {
      success: boolean;
      error?: string;
      workingCopyPath?: string;
      steps?: InterruptedMutationRecoveryStepResult[];
    }
  >;

  'status:local-server-info': IpcCall<[], LocalStatusServerInfo | null>;
}

export type IpcInvokeChannel = keyof IpcInvokeContract;
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args'];
export type IpcInvokeResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result'];

export type IpcEventContract = {
  'svn:mutation': SvnMutationNotification;
  'svn:mutationFailed': SvnMutationFailureNotification;
  'svn:workingCopyMutationStateChanged': string[];
  'svn:checkout:progress': CheckoutProgress & { checkoutId?: string };
  'svn:update:progress': CheckoutProgress & { updateId?: string };
  'svn:operation:progress': SvnOperationProgress;
  'fs:watch:change': { path: string; eventType: string; changedPath: string };
  'fs:deepStatus:progress': DeepStatusProgress;
  'deep-link': {
    action: string;
    params: Record<string, string>;
    path?: string;
    url?: string;
    requiresConfirmation?: boolean;
  };
  'updater:state': AppUpdateState;
  'lifecycle:staleWorkingCopyLock': StaleWorkingCopyLockInfo;
  'lifecycle:interruptedWorkingCopyMutations': InterruptedMutationRecord[];
  'lifecycle:interruptedMutationRecoveryPlan': InterruptedMutationRecoveryPlan;
  'ai:stream': import('./types').AiStreamEvent;
};

export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C];
