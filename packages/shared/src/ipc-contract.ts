import type {
  AuthCredential,
  AuthListEntry,
  CheckoutOptions,
  CheckoutProgress,
  ConfirmDialogOptions,
  FileFilter,
  FileInfo,
  FsStatusResult,
  MessageDialogOptions,
  NotificationOptions,
  RepoDiagnostics,
  ShellIntegrationStatus,
  SvnBlameResult,
  SvnChangelistResult,
  SvnDiffResult,
  SvnExternal,
  SvnInfoResult,
  SvnListResult,
  SvnLockInfo,
  SvnLockResult,
  SvnOperationProgress,
  SvnPatchResult,
  SvnShelveListResult,
  SvnUnlockResult,
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
type RevisionResult = { success: boolean; revision: number; error?: string; output?: string };

export interface IpcInvokeContract {
  'svn:status': IpcCall<[path: string], import('./types').SvnStatusResult>;
  'svn:statusRemote': IpcCall<[path: string], import('./types').SvnStatusResult>;
  'svn:workingCopyUpgradeStatus': IpcCall<
    [path: string],
    import('./types').WorkingCopyUpgradeStatus
  >;
  'svn:upgradeWorkingCopy': IpcCall<
    [path: string],
    { success: boolean; output?: string; error?: string }
  >;
  'svn:log': IpcCall<
    [path: string, limit?: number, startRev?: number, endRev?: number],
    import('./types').SvnLogResult
  >;
  'svn:info': IpcCall<[path: string], SvnInfoResult>;
  'svn:infoUrl': IpcCall<[url: string], SvnInfoResult>;
  'svn:getWorkingCopyContext': IpcCall<
    [path: string],
    { workingCopyRoot: string; repositoryRoot: string; url: string } | null
  >;
  'svn:diff': IpcCall<[path: string, revision?: string], SvnDiffResult>;
  'svn:diffStreaming': IpcCall<[path: string, revision?: string], SvnDiffResult>;
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
  'svn:revert': IpcCall<[paths: string[]], OperationResult>;
  'svn:add': IpcCall<[paths: string[]], OperationResult>;
  'svn:delete': IpcCall<[paths: string[]], OperationResult>;
  'svn:cleanup': IpcCall<[path: string], OperationResult>;
  'svn:lock': IpcCall<[path: string, message?: string], OperationResult>;
  'svn:unlock': IpcCall<[path: string, force?: boolean], OperationResult>;
  'svn:lockInfo': IpcCall<[path: string], SvnLockInfo | null>;
  'svn:lockForce': IpcCall<[path: string, message?: string], SvnLockResult>;
  'svn:unlockForce': IpcCall<[path: string], SvnUnlockResult>;
  'svn:lockList': IpcCall<[path: string], SvnLockInfo[]>;
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
    { success: boolean; revision: number; output?: string }
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
  'svn:copy': IpcCall<[src: string, dst: string, message: string], RevisionResult>;
  'svn:merge': IpcCall<
    [source: string, target: string, revisions?: string[], ranges?: string[]],
    OperationResult
  >;
  'svn:mergeWithProgress': IpcCall<
    [
      operationId: string,
      source: string,
      target: string,
      revisions?: string[],
      ranges?: Array<{ start: number; end: number }>,
    ],
    OperationResult
  >;
  'svn:relocate': IpcCall<[from: string, to: string, path: string], OperationResult>;
  'svn:move': IpcCall<[src: string, dst: string], OperationResult>;
  'svn:rename': IpcCall<[src: string, dst: string], OperationResult>;
  'svn:changelist:add': IpcCall<[paths: string[], changelist: string], OperationResult>;
  'svn:changelist:remove': IpcCall<[paths: string[]], OperationResult>;
  'svn:changelist:list': IpcCall<[path: string], SvnChangelistResult>;
  'svn:changelist:create': IpcCall<[name: string, comment?: string], OperationResult>;
  'svn:changelist:delete': IpcCall<[name: string, path: string], OperationResult>;
  'svn:shelve:list': IpcCall<[path: string], SvnShelveListResult>;
  'svn:shelve:save': IpcCall<[name: string, path: string, message?: string], OperationResult>;
  'svn:shelve:apply': IpcCall<[name: string, path: string], OperationResult>;
  'svn:shelve:delete': IpcCall<[name: string, path: string], OperationResult>;
  'svn:proplist': IpcCall<[path: string], { name: string; value: string }[]>;
  'svn:propset': IpcCall<[path: string, name: string, value: string], OperationResult>;
  'svn:propdel': IpcCall<[path: string, name: string], OperationResult>;
  'svn:blame': IpcCall<
    [path: string, startRevision?: number, endRevision?: number],
    SvnBlameResult
  >;
  'svn:list': IpcCall<
    [
      url: string,
      revision?: string,
      depth?: 'empty' | 'immediates' | 'infinity',
      credentials?: AuthCredential,
    ],
    SvnListResult
  >;
  'svn:patch:create': IpcCall<
    [paths: string[], outputPath: string],
    { success: boolean; output: string }
  >;
  'svn:patch:apply': IpcCall<
    [patchPath: string, targetPath: string, dryRun?: boolean],
    SvnPatchResult
  >;
  'svn:externals:list': IpcCall<[path: string], SvnExternal[]>;
  'svn:externals:add': IpcCall<[workingCopyPath: string, external: SvnExternal], OperationResult>;
  'svn:externals:remove': IpcCall<[workingCopyPath: string, externalPath: string], OperationResult>;
  'svn:diagnostics': IpcCall<[workingCopyPath: string], RepoDiagnostics>;

  'fs:listDirectory': IpcCall<[path: string], FileInfo[]>;
  'fs:listDrives': IpcCall<[], FileInfo[]>;
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
  'fs:watch': IpcCall<[path: string, options?: { watchSvnOnly?: boolean }], OperationResult>;
  'fs:unwatch': IpcCall<[path: string], OperationResult>;
  'fs:exists': IpcCall<[path: string], boolean>;

  'dialog:openDirectory': IpcCall<[], string | null>;
  'dialog:openFile': IpcCall<[filters?: FileFilter[]], string | null>;
  'dialog:saveFile': IpcCall<[defaultName?: string], string | null>;
  'dialog:showMessage': IpcCall<[options: MessageDialogOptions], void>;
  'dialog:confirm': IpcCall<[options: ConfirmDialogOptions], boolean>;

  'app:getVersion': IpcCall<[], string>;
  'app:getPath': IpcCall<[name: string], string>;
  'app:openExternal': IpcCall<[url: string], OperationResult>;
  'app:clearCache': IpcCall<[], OperationResult>;
  'app:getCacheSize': IpcCall<[], { size: number; files: number }>;
  'app:window:minimize': IpcCall<[], void>;
  'app:window:maximize': IpcCall<[], void>;
  'app:window:close': IpcCall<[], void>;
  'app:window:isMaximized': IpcCall<[], boolean>;

  'store:get': IpcCall<[key: string], unknown>;
  'store:set': IpcCall<[key: string, value: unknown], void>;
  'store:delete': IpcCall<[key: string], void>;

  'auth:get': IpcCall<[realm: string], AuthCredential | null>;
  'auth:set': IpcCall<[realm: string, username: string, password: string], OperationResult>;
  'auth:delete': IpcCall<[realm: string], OperationResult>;
  'auth:list': IpcCall<[], AuthListEntry[]>;
  'auth:has': IpcCall<[realm: string], boolean>;
  'auth:clear': IpcCall<[], OperationResult>;
  'auth:isEncryptionAvailable': IpcCall<[], boolean>;

  'monitor:getWorkingCopies': IpcCall<[], WorkingCopyInfo[]>;
  'monitor:addWorkingCopy': IpcCall<[path: string], OperationResult>;
  'monitor:removeWorkingCopy': IpcCall<[path: string], OperationResult>;
  'monitor:refreshStatus': IpcCall<[path: string], WorkingCopyInfo | null>;
  'monitor:startMonitoring': IpcCall<[], OperationResult>;
  'monitor:stopMonitoring': IpcCall<[], OperationResult>;

  'external:openDiffTool': IpcCall<[tool: string, left: string, right: string], OperationResult>;
  'external:openMergeTool': IpcCall<
    [tool: string, base: string, mine: string, theirs: string, merged: string],
    OperationResult
  >;
  'external:openFolder': IpcCall<[path: string], OperationResult>;
  'external:openFile': IpcCall<[path: string], OperationResult>;

  'webhook:deliver': IpcCall<[request: WebhookDeliverRequest], WebhookDeliverResult>;
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
  'svn:checkout:progress': CheckoutProgress & { checkoutId?: string };
  'svn:update:progress': CheckoutProgress & { updateId?: string };
  'svn:operation:progress': SvnOperationProgress;
  'fs:watch:change': { path: string; eventType: string; changedPath: string };
  'deep-link': {
    action: string;
    params: Record<string, string>;
    path?: string;
    url?: string;
    requiresConfirmation?: boolean;
  };
};

export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C];
