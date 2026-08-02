import type {
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
  SvnWorkingCopyContext,
  UpdateOptions,
  WebhookDeliverRequest,
  WebhookDeliverResult,
  WorkingCopyInfo,
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
};

export interface IpcInvokeContract {
  'svn:capabilities': IpcCall<
    [],
    { shelving: boolean; nativeShelving: boolean; remoteProperties: boolean }
  >;
  'svn:getActiveWorkingCopyMutations': IpcCall<[], string[]>;
  'svn:nativeAuth:list': IpcCall<[patterns?: string[]], SvnNativeAuthEntry[]>;
  'svn:nativeAuth:remove': IpcCall<[patterns: string[]], { success: boolean; output?: string }>;
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
  'svn:lock': IpcCall<[path: string, message?: string], OperationResult>;
  'svn:unlock': IpcCall<[path: string, force?: boolean], OperationResult>;
  'svn:lockInfo': IpcCall<[path: string], SvnLockInfoResult>;
  'svn:lockForce': IpcCall<[path: string, message?: string], SvnLockResult>;
  'svn:unlockForce': IpcCall<[path: string], SvnUnlockResult>;
  'svn:lockList': IpcCall<[path: string], SvnLockListResult>;
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
  'svn:resolve': IpcCall<[path: string, resolution: string], OperationResult>;
  'svn:switch': IpcCall<[path: string, url: string, revision?: string], RevisionResult>;
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
  'svn:trustServerCertificate': IpcCall<
    [url: string, errorText: string],
    { success: boolean; error?: string }
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
}

export type IpcInvokeChannel = keyof IpcInvokeContract;
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args'];
export type IpcInvokeResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result'];

export type IpcEventContract = {
  'svn:mutation': SvnMutationNotification;
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
};

export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C];
