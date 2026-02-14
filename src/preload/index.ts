import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { 
  ElectronAPI, FileFilter, FileInfo, FsStatusResult, SvnDiffResult, 
  AuthCredential, AuthListEntry, SvnChangelistResult, SvnShelveListResult, 
  WorkingCopyInfo, SvnBlameResult, SvnListResult, SvnPatchResult, SvnExternal 
} from '@shared/types'

const api: ElectronAPI = {
  svn: {
    status: (path) => ipcRenderer.invoke('svn:status', path),
    log: (path, limit?, startRev?, endRev?) => 
      ipcRenderer.invoke('svn:log', path, limit, startRev, endRev),
    info: (path) => ipcRenderer.invoke('svn:info', path),
    diff: (path, revision?) => ipcRenderer.invoke('svn:diff', path, revision) as Promise<SvnDiffResult>,
    update: (path) => ipcRenderer.invoke('svn:update', path),
    commit: (paths, message) => ipcRenderer.invoke('svn:commit', paths, message),
    revert: (paths) => ipcRenderer.invoke('svn:revert', paths),
    add: (paths) => ipcRenderer.invoke('svn:add', paths),
    delete: (paths) => ipcRenderer.invoke('svn:delete', paths),
    cleanup: (path) => ipcRenderer.invoke('svn:cleanup', path),
    lock: (path, message?) => ipcRenderer.invoke('svn:lock', path, message),
    unlock: (path, force?) => ipcRenderer.invoke('svn:unlock', path, force),
    checkout: (url, path, revision?, depth?, options?) => ipcRenderer.invoke('svn:checkout', url, path, revision, depth, options),
    export: (url, path, revision?) => ipcRenderer.invoke('svn:export', url, path, revision),
    import: (path, url, message) => ipcRenderer.invoke('svn:import', path, url, message),
    resolve: (path, resolution) => ipcRenderer.invoke('svn:resolve', path, resolution),
    switch: (path, url, revision?) => ipcRenderer.invoke('svn:switch', path, url, revision),
    copy: (src, dst, message) => ipcRenderer.invoke('svn:copy', src, dst, message),
    merge: (source, target, revisions?, ranges?) => ipcRenderer.invoke('svn:merge', source, target, revisions, ranges),
    relocate: (from, to, path) => ipcRenderer.invoke('svn:relocate', from, to, path),
    changelist: {
      add: (paths, changelist) => ipcRenderer.invoke('svn:changelist:add', paths, changelist),
      remove: (paths) => ipcRenderer.invoke('svn:changelist:remove', paths),
      list: (path) => ipcRenderer.invoke('svn:changelist:list', path) as Promise<SvnChangelistResult>,
      create: (name, comment?) => ipcRenderer.invoke('svn:changelist:create', name, comment),
      delete: (name, path) => ipcRenderer.invoke('svn:changelist:delete', name, path)
    },
    move: (src, dst) => ipcRenderer.invoke('svn:move', src, dst),
    rename: (src, dst) => ipcRenderer.invoke('svn:rename', src, dst),
    shelve: {
      list: (path) => ipcRenderer.invoke('svn:shelve:list', path) as Promise<SvnShelveListResult>,
      save: (name, path, message?) => ipcRenderer.invoke('svn:shelve:save', name, path, message),
      apply: (name, path) => ipcRenderer.invoke('svn:shelve:apply', name, path),
      delete: (name, path) => ipcRenderer.invoke('svn:shelve:delete', name, path)
    },
    proplist: (path) => ipcRenderer.invoke('svn:proplist', path),
    propset: (path, name, value) => ipcRenderer.invoke('svn:propset', path, name, value),
    propdel: (path, name) => ipcRenderer.invoke('svn:propdel', path, name),
    // Blame (Annotate)
    blame: (path, startRevision?, endRevision?) => 
      ipcRenderer.invoke('svn:blame', path, startRevision, endRevision) as Promise<SvnBlameResult>,
    // Repository Browser
    list: (url, revision?, depth?) => 
      ipcRenderer.invoke('svn:list', url, revision, depth) as Promise<SvnListResult>,
    // Patch Operations
    patch: {
      create: (paths, outputPath) => 
        ipcRenderer.invoke('svn:patch:create', paths, outputPath) as Promise<{ success: boolean; output: string }>,
      apply: (patchPath, targetPath, dryRun?) => 
        ipcRenderer.invoke('svn:patch:apply', patchPath, targetPath, dryRun) as Promise<SvnPatchResult>
    },
    // Externals Management
    externals: {
      list: (path) => ipcRenderer.invoke('svn:externals:list', path) as Promise<SvnExternal[]>,
      add: (workingCopyPath, external) => 
        ipcRenderer.invoke('svn:externals:add', workingCopyPath, external) as Promise<{ success: boolean }>,
      remove: (workingCopyPath, externalPath) => 
        ipcRenderer.invoke('svn:externals:remove', workingCopyPath, externalPath) as Promise<{ success: boolean }>
    }
  },
  external: {
    openDiffTool: (tool, left, right) => ipcRenderer.invoke('external:openDiffTool', tool, left, right),
    openMergeTool: (tool, base, mine, theirs, merged) => ipcRenderer.invoke('external:openMergeTool', tool, base, mine, theirs, merged),
    openFolder: (path) => ipcRenderer.invoke('external:openFolder', path),
    openFile: (path) => ipcRenderer.invoke('external:openFile', path)
  },
  monitor: {
    getWorkingCopies: () => ipcRenderer.invoke('monitor:getWorkingCopies') as Promise<WorkingCopyInfo[]>,
    addWorkingCopy: (path) => ipcRenderer.invoke('monitor:addWorkingCopy', path),
    removeWorkingCopy: (path) => ipcRenderer.invoke('monitor:removeWorkingCopy', path),
    refreshStatus: (path) => ipcRenderer.invoke('monitor:refreshStatus', path) as Promise<WorkingCopyInfo | null>,
    startMonitoring: () => ipcRenderer.invoke('monitor:startMonitoring'),
    stopMonitoring: () => ipcRenderer.invoke('monitor:stopMonitoring')
  },
  fs: {
    // Fast file listing (filesystem only, no SVN)
    listDirectory: (path) => ipcRenderer.invoke('fs:listDirectory', path) as Promise<FileInfo[]>,
    // List available drives (Windows) or mount points (Unix)
    listDrives: () => ipcRenderer.invoke('fs:listDrives') as Promise<FileInfo[]>,
    // Get parent directory path
    getParent: (path) => ipcRenderer.invoke('fs:getParent', path) as Promise<string | null>,
    // Shallow SVN status (fast, --depth=immediates)
    getStatus: (path) => ipcRenderer.invoke('fs:getStatus', path) as Promise<FsStatusResult>,
    // Deep SVN status (slower, --depth=infinity) for folder aggregation
    getDeepStatus: (path) => ipcRenderer.invoke('fs:getDeepStatus', path) as Promise<FsStatusResult>,
    // Apply status to files
    applyStatus: (files, directStatus, allEntries) => 
      ipcRenderer.invoke('fs:applyStatus', files, directStatus, allEntries) as Promise<FileInfo[]>,
    // Cancel active deep scan
    cancelScan: (path) => ipcRenderer.invoke('fs:cancelScan', path),
    // Check if versioned
    isVersioned: (path) => ipcRenderer.invoke('fs:isVersioned', path) as Promise<boolean>,
    // Read file content for preview
    readFile: (path) => ipcRenderer.invoke('fs:readFile', path) as Promise<{ success: boolean; content?: string; error?: string }>,
    // Calculate folder sizes
    getFolderSizes: (folderPaths) => ipcRenderer.invoke('fs:getFolderSizes', folderPaths) as Promise<Record<string, number>>,
    // Copy file (for non-versioned files)
    copyFile: (source, target) => ipcRenderer.invoke('fs:copyFile', source, target) as Promise<{ success: boolean; error?: string }>
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFile: (filters?: FileFilter[]) => ipcRenderer.invoke('dialog:openFile', filters),
    saveFile: (defaultName?: string) => ipcRenderer.invoke('dialog:saveFile', defaultName)
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPath: (name) => ipcRenderer.invoke('app:getPath', name),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    clearCache: () => ipcRenderer.invoke('app:clearCache') as Promise<{ success: boolean; error?: string }>,
    getCacheSize: () => ipcRenderer.invoke('app:getCacheSize') as Promise<{ size: number; files: number }>
  },
  store: {
    get: <T>(key: string) => ipcRenderer.invoke('store:get', key) as Promise<T | undefined>,
    set: <T>(key: string, value: T) => ipcRenderer.invoke('store:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('store:delete', key)
  },
  auth: {
    get: (realm: string) => ipcRenderer.invoke('auth:get', realm) as Promise<AuthCredential | null>,
    set: (realm: string, username: string, password: string) => 
      ipcRenderer.invoke('auth:set', realm, username, password) as Promise<{ success: boolean }>,
    delete: (realm: string) => ipcRenderer.invoke('auth:delete', realm) as Promise<{ success: boolean }>,
    list: () => ipcRenderer.invoke('auth:list') as Promise<AuthListEntry[]>,
    has: (realm: string) => ipcRenderer.invoke('auth:has', realm) as Promise<boolean>,
    clear: () => ipcRenderer.invoke('auth:clear') as Promise<{ success: boolean }>,
    isEncryptionAvailable: () => ipcRenderer.invoke('auth:isEncryptionAvailable') as Promise<boolean>
  }
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
// only if context isolation is enabled
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose API:', error)
  }
} else {
  // @ts-ignore (for non-context-isolated environments)
  window.api = api
}
