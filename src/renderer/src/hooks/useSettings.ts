import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AppSettings, ProxySettings, DiffMergeSettings, DialogSettings, NotificationSettings, IntegrationSettings } from '@shared/types'

/**
 * Return type for useSettings hook
 * Provides explicit typing for the hook's public API
 */
export interface UseSettingsReturn {
  settings: AppSettings
  isLoading: boolean
  error: Error | null
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>
  addRecentRepo: (repoPath: string) => Promise<void>
  removeRecentRepo: (repoPath: string) => Promise<void>
  addRecentPath: (path: string) => Promise<void>
  addBookmark: (path: string, name: string) => Promise<void>
  removeBookmark: (path: string) => Promise<void>
  isUpdating: boolean
}

const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: false,
  host: '',
  port: 8080,
  username: '',
  password: '',
  bypassForLocal: true
}

const DEFAULT_DIFF_MERGE_SETTINGS: DiffMergeSettings = {
  externalDiffTool: '',
  externalMergeTool: '',
  diffOnDoubleClick: true,
  ignoreWhitespace: false,
  ignoreEol: false,
  contextLines: 3
}

const DEFAULT_DIALOG_SETTINGS: DialogSettings = {
  rememberPositions: true,
  rememberSizes: true,
  commitDialogColumns: ['status', 'path', 'extension'],
  logMessagesPerPage: 100,
  maxCachedMessages: 1000
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enableSounds: true,
  enableSystemNotifications: true,
  showHookOutput: true,
  monitorPollInterval: 60
}

const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  shellExtensionEnabled: false,
  contextMenuItems: ['update', 'commit', 'revert', 'log', 'diff', 'checkout', 'export'],
  iconOverlaysEnabled: true
}

const DEFAULT_SETTINGS: AppSettings = {
  // General
  theme: 'system',
  language: 'en',
  checkUpdatesOnStartup: true,
  confirmDestructiveOps: true,
  singleInstanceMode: false,
  defaultCheckoutDirectory: '',
  startupAction: 'welcome',
  
  // SVN
  recentRepositories: [],
  showIgnoredFiles: false,
  showUnversionedFiles: true,
  sidebarWidth: 250,
  defaultCommitMessage: '',
  autoRefreshInterval: 0,
  svnClientPath: '', // empty = bundled
  workingCopyFormat: '1.14',
  globalIgnorePatterns: [],
  proxySettings: DEFAULT_PROXY_SETTINGS,
  connectionTimeout: 30,
  sslVerify: true,
  clientCertificatePath: '',
  
  // Diff & Merge
  diffMerge: DEFAULT_DIFF_MERGE_SETTINGS,
  
  // Dialogs
  dialogs: DEFAULT_DIALOG_SETTINGS,
  
  // Notifications
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
  
  // Integration
  integration: DEFAULT_INTEGRATION_SETTINGS,
  
  // Appearance
  fontSize: 'medium',
  showStatusBar: true,
  fileListHeight: 'fill',
  accentColor: '#6366f1', // Indigo
  compactFileRows: false,
  animationSpeed: 'normal',
  showThumbnails: false,
  showFolderSizes: false,
  
  // Navigation
  bookmarks: [],
  recentPaths: [],
  
  // Authentication
  savedCredentials: [],
  
  // Advanced
  logLevel: 'info',
  svnConfigPath: '',
  logCachePath: '',
  maxLogCacheSize: 100
}

const MAX_RECENT_REPOS = 10
const MAX_RECENT_PATHS = 20
const MAX_BOOKMARKS = 50

export function useSettings(): UseSettingsReturn {
  const queryClient = useQueryClient()
  
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const stored = await window.api.store.get<AppSettings>('settings')
      return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
    },
    staleTime: Infinity // Settings don't change often
  })
  
  // Mutation for updating settings
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<AppSettings>) => {
      // Read the LATEST cached value directly from queryClient to avoid stale closures
      const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS
      const updated = { ...current, ...updates }
      await window.api.store.set('settings', updated)
      return updated
    },
    onSuccess: (updated) => {
      // Update the cache immediately
      queryClient.setQueryData(['settings'], updated)
    }
  })
  
  // Add a repository to recent list
  const addRecentRepo = async (repoPath: string) => {
    // Read the latest cached value to avoid race conditions
    const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS
    const currentRecents = current.recentRepositories || []
    
    // Remove if already exists (to move to top)
    const filtered = currentRecents.filter(p => p !== repoPath)
    
    // Add to beginning, limit to max
    const updated = [repoPath, ...filtered].slice(0, MAX_RECENT_REPOS)
    
    await updateMutation.mutateAsync({ recentRepositories: updated })
  }
  
  // Remove a repository from recent list
  const removeRecentRepo = async (repoPath: string) => {
    // Read the latest cached value to avoid race conditions
    const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS
    const updated = (current.recentRepositories || []).filter(p => p !== repoPath)
    await updateMutation.mutateAsync({ recentRepositories: updated })
  }
  
  // Add a path to recent paths
  const addRecentPath = async (path: string) => {
    const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS
    const currentPaths = current.recentPaths || []
    const filtered = currentPaths.filter(p => p !== path)
    const updated = [path, ...filtered].slice(0, MAX_RECENT_PATHS)
    await updateMutation.mutateAsync({ recentPaths: updated })
  }
  
  // Add a bookmark
  const addBookmark = async (path: string, name: string) => {
    const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS
    const currentBookmarks = current.bookmarks || []
    // Check if already bookmarked
    if (currentBookmarks.some(b => b.path === path)) return
    const newBookmark = { path, name, addedAt: Date.now() }
    const updated = [newBookmark, ...currentBookmarks].slice(0, MAX_BOOKMARKS)
    await updateMutation.mutateAsync({ bookmarks: updated })
  }
  
  // Remove a bookmark
  const removeBookmark = async (path: string) => {
    const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS
    const updated = (current.bookmarks || []).filter(b => b.path !== path)
    await updateMutation.mutateAsync({ bookmarks: updated })
  }
  
  // Update any setting
  const updateSettings = async (updates: Partial<AppSettings>) => {
    return updateMutation.mutateAsync(updates)
  }
  
  return {
    settings: settings || DEFAULT_SETTINGS,
    isLoading,
    error,
    updateSettings,
    addRecentRepo,
    removeRecentRepo,
    addRecentPath,
    addBookmark,
    removeBookmark,
    isUpdating: updateMutation.isPending
  }
}
