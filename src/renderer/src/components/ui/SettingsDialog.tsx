import { useState, useEffect } from 'react'
import {
  X,
  Settings,
  GitBranch,
  Palette,
  Key,
  Wrench,
  Sun,
  Moon,
  Monitor,
  FolderOpen,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Check,
  ChevronDown,
  FileDiff,
  MessageSquare,
  Bell,
  Puzzle,
  Shield,
  Clock,
  Volume2,
  Loader2
} from 'lucide-react'
import { useSettings } from '@renderer/hooks/useSettings'
import type { 
  AppSettings, 
  LogLevel, 
  FontSize, 
  StartupAction, 
  WorkingCopyFormat
} from '@shared/types'

type SettingsTab = 'general' | 'svn' | 'diffmerge' | 'dialogs' | 'notifications' | 'integration' | 'appearance' | 'auth' | 'advanced'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: SettingsTab
}

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
  { id: 'svn', label: 'SVN', icon: <GitBranch className="w-4 h-4" /> },
  { id: 'diffmerge', label: 'Diff & Merge', icon: <FileDiff className="w-4 h-4" /> },
  { id: 'dialogs', label: 'Dialogs', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
  { id: 'integration', label: 'Integration', icon: <Puzzle className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'auth', label: 'Authentication', icon: <Key className="w-4 h-4" /> },
  { id: 'advanced', label: 'Advanced', icon: <Wrench className="w-4 h-4" /> },
]

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'en',
  checkUpdatesOnStartup: true,
  confirmDestructiveOps: true,
  singleInstanceMode: false,
  defaultCheckoutDirectory: '',
  startupAction: 'welcome',
  recentRepositories: [],
  showIgnoredFiles: false,
  showUnversionedFiles: true,
  sidebarWidth: 250,
  defaultCommitMessage: '',
  autoRefreshInterval: 0,
  svnClientPath: '',
  workingCopyFormat: '1.14',
  globalIgnorePatterns: [],
  proxySettings: {
    enabled: false,
    host: '',
    port: 8080,
    username: '',
    password: '',
    bypassForLocal: true
  },
  connectionTimeout: 30,
  sslVerify: true,
  clientCertificatePath: '',
  diffMerge: {
    externalDiffTool: '',
    externalMergeTool: '',
    diffOnDoubleClick: true,
    ignoreWhitespace: false,
    ignoreEol: false,
    contextLines: 3
  },
  dialogs: {
    rememberPositions: true,
    rememberSizes: true,
    commitDialogColumns: ['status', 'path', 'extension'],
    logMessagesPerPage: 100,
    maxCachedMessages: 1000
  },
  notifications: {
    enableSounds: true,
    enableSystemNotifications: true,
    showHookOutput: true,
    monitorPollInterval: 60
  },
  integration: {
    shellExtensionEnabled: false,
    contextMenuItems: ['update', 'commit', 'revert', 'log', 'diff', 'checkout', 'export'],
    iconOverlaysEnabled: true
  },
  fontSize: 'medium',
  showStatusBar: true,
  fileListHeight: 'fill',
  accentColor: '#6366f1',
  compactFileRows: false,
  animationSpeed: 'normal',
  showThumbnails: false,
  showFolderSizes: false,
  bookmarks: [],
  recentPaths: [],
  savedCredentials: [],
  logLevel: 'info',
  svnConfigPath: '',
  logCachePath: '',
  maxLogCacheSize: 100
}

export function SettingsDialog({ isOpen, onClose, initialTab = 'general' }: SettingsDialogProps) {
  const { settings: savedSettings, updateSettings, isUpdating } = useSettings()
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [localSettings, setLocalSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [hasChanges, setHasChanges] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Load settings when dialog opens
  useEffect(() => {
    if (isOpen && savedSettings) {
      setLocalSettings({ ...DEFAULT_SETTINGS, ...savedSettings })
      setHasChanges(false)
      setShowResetConfirm(false)
      // Set initial tab when dialog opens
      if (initialTab) {
        setActiveTab(initialTab)
      }
    }
  }, [isOpen, savedSettings, initialTab])

  // Track changes
  useEffect(() => {
    if (savedSettings) {
      const changed = JSON.stringify(localSettings) !== JSON.stringify({ ...DEFAULT_SETTINGS, ...savedSettings })
      setHasChanges(changed)
    }
  }, [localSettings, savedSettings])

  const updateLocalSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }))
  }

  const updateNestedSetting = <K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => {
    setLocalSettings(prev => {
      const nestedValue = prev[key] as unknown as Record<string, unknown>
      return {
        ...prev,
        [key]: {
          ...nestedValue,
          [subKey]: value
        }
      }
    })
  }

  const handleSave = async () => {
    await updateSettings(localSettings)
    setHasChanges(false)
    onClose()
  }

  const handleReset = async () => {
    setLocalSettings(DEFAULT_SETTINGS)
    await updateSettings(DEFAULT_SETTINGS)
    setShowResetConfirm(false)
    setHasChanges(false)
  }

  const handleClearCredentials = async () => {
    updateLocalSetting('savedCredentials', [])
  }

  const handleRemoveCredential = (index: number) => {
    const newCredentials = localSettings.savedCredentials.filter((_, i) => i !== index)
    updateLocalSetting('savedCredentials', newCredentials)
  }

  const handleClose = () => {
    if (hasChanges) {
      onClose()
    } else {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal w-[820px] h-[680px] flex"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar Navigation */}
        <div className="w-[180px] flex-shrink-0 bg-bg-tertiary border-r border-border flex flex-col">
          <div className="px-4 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text flex items-center gap-2">
              <Settings className="w-5 h-5 text-accent" />
              Settings
            </h2>
          </div>
          
          <nav className="flex-1 py-2 overflow-y-auto scrollbar-overlay">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  w-full flex items-center gap-3 px-4 py-2 text-sm font-medium
                  transition-all duration-150 text-left
                  ${activeTab === tab.id
                    ? 'bg-accent/10 text-accent border-r-2 border-accent'
                    : 'text-text-secondary hover:text-text hover:bg-bg-elevated/50'
                  }
                `}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          
          {/* Version info */}
          <div className="px-4 py-3 border-t border-border">
            <p className="text-xs text-text-faint">ShellySVN v0.1.0</p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="text-base font-medium text-text">
              {TABS.find(t => t.id === activeTab)?.label}
            </h3>
            <button onClick={handleClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-overlay">
            {activeTab === 'general' && (
              <GeneralSettings
                settings={localSettings}
                onChange={updateLocalSetting}
              />
            )}
            {activeTab === 'svn' && (
              <SvnSettings
                settings={localSettings}
                onChange={updateLocalSetting}
                onChangeNested={updateNestedSetting}
              />
            )}
            {activeTab === 'diffmerge' && (
              <DiffMergeSettingsTab
                settings={localSettings}
                onChangeNested={updateNestedSetting}
              />
            )}
            {activeTab === 'dialogs' && (
              <DialogsSettingsTab
                settings={localSettings}
                onChangeNested={updateNestedSetting}
              />
            )}
            {activeTab === 'notifications' && (
              <NotificationsSettingsTab
                settings={localSettings}
                onChangeNested={updateNestedSetting}
              />
            )}
            {activeTab === 'integration' && (
              <IntegrationSettingsTab
                settings={localSettings}
                onChangeNested={updateNestedSetting}
              />
            )}
            {activeTab === 'appearance' && (
              <AppearanceSettings
                settings={localSettings}
                onChange={updateLocalSetting}
              />
            )}
            {activeTab === 'auth' && (
              <AuthSettings
                settings={localSettings}
                onRemoveCredential={handleRemoveCredential}
                onClearAll={handleClearCredentials}
              />
            )}
            {activeTab === 'advanced' && (
              <AdvancedSettings
                settings={localSettings}
                onChange={updateLocalSetting}
                onReset={handleReset}
                showResetConfirm={showResetConfirm}
                setShowResetConfirm={setShowResetConfirm}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-tertiary/30">
            <div className="flex items-center gap-2">
              {hasChanges && (
                <span className="text-xs text-warning flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleClose} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges || isUpdating}
                className="btn btn-primary"
              >
                {isUpdating ? (
                  <>
                    <span className="animate-spin">...</span>
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// General Settings Tab
// ============================================

interface SettingsSectionProps {
  settings: AppSettings
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

interface NestedSettingsProps {
  settings: AppSettings
  onChangeNested: <K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => void
}

function GeneralSettings({ settings, onChange }: SettingsSectionProps) {
  const handleBrowseCheckoutDir = async () => {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      onChange('defaultCheckoutDirectory', path)
    }
  }

  return (
    <div className="space-y-6">
      {/* Theme Selection */}
      <SettingsGroup title="Theme" description="Choose your preferred color scheme">
        <div className="flex gap-3">
          {[
            { value: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
            { value: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
            { value: 'system', label: 'System', icon: <Monitor className="w-4 h-4" /> },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => onChange('theme', option.value as AppSettings['theme'])}
              className={`
                flex-1 flex flex-col items-center gap-2 px-4 py-3 rounded-lg border
                transition-all duration-150
                ${settings.theme === option.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-bg-tertiary text-text-secondary hover:border-border-focus hover:text-text'
                }
              `}
            >
              {option.icon}
              <span className="text-sm font-medium">{option.label}</span>
            </button>
          ))}
        </div>
      </SettingsGroup>

      {/* Language */}
      <SettingsGroup title="Language" description="Application display language">
        <div className="relative">
          <select
            value={settings.language}
            onChange={(e) => onChange('language', e.target.value)}
            className="input appearance-none pr-10 cursor-pointer"
          >
            <option value="en">English</option>
            <option value="de">German (Deutsch)</option>
            <option value="fr">French (Francais)</option>
            <option value="es">Spanish (Espanol)</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese (Simplified)</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </SettingsGroup>

      {/* Startup Action */}
      <SettingsGroup title="Startup" description="What to do when the application starts">
        <div className="relative">
          <select
            value={settings.startupAction}
            onChange={(e) => onChange('startupAction', e.target.value as StartupAction)}
            className="input appearance-none pr-10 cursor-pointer"
          >
            <option value="welcome">Show welcome screen</option>
            <option value="lastRepo">Open last repository</option>
            <option value="empty">Show empty state</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </SettingsGroup>

      {/* Default Checkout Directory */}
      <SettingsGroup title="Default Checkout Directory" description="Where new checkouts are saved by default">
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.defaultCheckoutDirectory}
            onChange={(e) => onChange('defaultCheckoutDirectory', e.target.value)}
            placeholder="Leave empty to prompt each time"
            className="input flex-1"
          />
          <button onClick={handleBrowseCheckoutDir} className="btn btn-secondary">
            <FolderOpen className="w-4 h-4" />
            Browse
          </button>
        </div>
      </SettingsGroup>

      {/* Check for updates */}
      <SettingsGroup title="Updates" description="Startup behavior">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.checkUpdatesOnStartup}
            onChange={(e) => onChange('checkUpdatesOnStartup', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Check for updates on startup
          </span>
        </label>
      </SettingsGroup>

      {/* Single Instance Mode */}
      <SettingsGroup title="Instance Management" description="Application behavior">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.singleInstanceMode}
            onChange={(e) => onChange('singleInstanceMode', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Allow only one instance (open files in existing window)
          </span>
        </label>
      </SettingsGroup>

      {/* Confirm destructive operations */}
      <SettingsGroup title="Safety" description="Operation confirmations">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.confirmDestructiveOps}
            onChange={(e) => onChange('confirmDestructiveOps', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Confirm on destructive operations (revert, delete, etc.)
          </span>
        </label>
      </SettingsGroup>
    </div>
  )
}

// ============================================
// SVN Settings Tab
// ============================================

interface SvnSettingsProps extends SettingsSectionProps {
  onChangeNested: <K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => void
}

function SvnSettings({ settings, onChange, onChangeNested }: SvnSettingsProps) {
  const handleBrowseSvnPath = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Executables', extensions: ['exe', 'app', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (path) {
      onChange('svnClientPath', path)
    }
  }

  const handleBrowseCertPath = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Certificates', extensions: ['p12', 'pem', 'crt', 'cer'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (path) {
      onChange('clientCertificatePath', path)
    }
  }

  const handleAddIgnorePattern = () => {
    const pattern = prompt('Enter ignore pattern (e.g., *.log, node_modules/):')
    if (pattern && pattern.trim()) {
      onChange('globalIgnorePatterns', [...settings.globalIgnorePatterns, pattern.trim()])
    }
  }

  const handleRemoveIgnorePattern = (index: number) => {
    const newPatterns = settings.globalIgnorePatterns.filter((_, i) => i !== index)
    onChange('globalIgnorePatterns', newPatterns)
  }

  return (
    <div className="space-y-6">
      {/* SVN Client */}
      <SettingsGroup title="SVN Client" description="SVN executable configuration">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.svnClientPath}
              onChange={(e) => onChange('svnClientPath', e.target.value)}
              placeholder="Leave empty to use bundled SVN"
              className="input flex-1"
            />
            <button onClick={handleBrowseSvnPath} className="btn btn-secondary">
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Leave empty to use the bundled SVN 1.14.x client
          </p>
        </div>
      </SettingsGroup>

      {/* Working Copy Format */}
      <SettingsGroup title="Working Copy Format" description="Format for new working copies">
        <div className="relative">
          <select
            value={settings.workingCopyFormat}
            onChange={(e) => onChange('workingCopyFormat', e.target.value as WorkingCopyFormat)}
            className="input appearance-none pr-10 cursor-pointer"
          >
            <option value="1.8">1.8 (compatible with SVN 1.8+)</option>
            <option value="1.9">1.9 (compatible with SVN 1.9+)</option>
            <option value="1.10">1.10 (compatible with SVN 1.10+)</option>
            <option value="1.11">1.11 (compatible with SVN 1.11+)</option>
            <option value="1.12">1.12 (compatible with SVN 1.12+)</option>
            <option value="1.13">1.13 (compatible with SVN 1.13+)</option>
            <option value="1.14">1.14 (latest, SVN 1.14+)</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </SettingsGroup>

      {/* Default Commit Message */}
      <SettingsGroup title="Default Commit Message" description="Pre-filled text for new commits">
        <textarea
          value={settings.defaultCommitMessage}
          onChange={(e) => onChange('defaultCommitMessage', e.target.value)}
          placeholder="Enter default commit message..."
          className="input h-24 resize-none font-mono text-sm"
        />
      </SettingsGroup>

      {/* File Visibility */}
      <SettingsGroup title="File Visibility" description="Control which files are shown">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showIgnoredFiles}
              onChange={(e) => onChange('showIgnoredFiles', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Show ignored files
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showUnversionedFiles}
              onChange={(e) => onChange('showUnversionedFiles', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Show unversioned files
            </span>
          </label>
        </div>
      </SettingsGroup>

      {/* Auto Refresh */}
      <SettingsGroup title="Auto Refresh" description="Automatically refresh file status">
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            max="3600"
            value={settings.autoRefreshInterval}
            onChange={(e) => onChange('autoRefreshInterval', parseInt(e.target.value) || 0)}
            className="input w-24 text-center"
          />
          <span className="text-sm text-text-secondary">seconds</span>
          <span className="text-xs text-text-muted">(0 = disabled)</span>
        </div>
      </SettingsGroup>

      {/* Global Ignore Patterns */}
      <SettingsGroup title="Global Ignore Patterns" description="Files/folders to ignore globally">
        <div className="space-y-2">
          {settings.globalIgnorePatterns.length === 0 ? (
            <p className="text-sm text-text-muted py-2">No custom ignore patterns</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {settings.globalIgnorePatterns.map((pattern, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-bg-tertiary rounded text-sm"
                >
                  {pattern}
                  <button
                    onClick={() => handleRemoveIgnorePattern(index)}
                    className="text-text-muted hover:text-error"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <button onClick={handleAddIgnorePattern} className="btn btn-secondary text-sm">
            Add Pattern
          </button>
        </div>
      </SettingsGroup>

      {/* Proxy Settings */}
      <SettingsGroup title="Proxy Settings" description="HTTP proxy for SVN connections">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.proxySettings.enabled}
              onChange={(e) => onChangeNested('proxySettings', 'enabled', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Enable proxy
            </span>
          </label>
          
          {settings.proxySettings.enabled && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <div>
                <label className="text-xs text-text-muted">Host</label>
                <input
                  type="text"
                  value={settings.proxySettings.host}
                  onChange={(e) => onChangeNested('proxySettings', 'host', e.target.value)}
                  placeholder="proxy.example.com"
                  className="input"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted">Port</label>
                <input
                  type="number"
                  value={settings.proxySettings.port}
                  onChange={(e) => onChangeNested('proxySettings', 'port', parseInt(e.target.value) || 8080)}
                  className="input"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted">Username (optional)</label>
                <input
                  type="text"
                  value={settings.proxySettings.username}
                  onChange={(e) => onChangeNested('proxySettings', 'username', e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted">Password (optional)</label>
                <input
                  type="password"
                  value={settings.proxySettings.password}
                  onChange={(e) => onChangeNested('proxySettings', 'password', e.target.value)}
                  className="input"
                />
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={settings.proxySettings.bypassForLocal}
                    onChange={(e) => onChangeNested('proxySettings', 'bypassForLocal', e.target.checked)}
                    className="checkbox"
                  />
                  <span className="text-sm text-text-secondary">Bypass for local addresses</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </SettingsGroup>

      {/* Connection Settings */}
      <SettingsGroup title="Connection" description="Network timeout settings">
        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-text-muted" />
          <span className="text-sm text-text-secondary">Timeout:</span>
          <input
            type="number"
            min="5"
            max="300"
            value={settings.connectionTimeout}
            onChange={(e) => onChange('connectionTimeout', parseInt(e.target.value) || 30)}
            className="input w-20 text-center"
          />
          <span className="text-sm text-text-muted">seconds</span>
        </div>
      </SettingsGroup>

      {/* SSL Settings */}
      <SettingsGroup title="SSL/TLS" description="Certificate verification">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.sslVerify}
              onChange={(e) => onChange('sslVerify', e.target.checked)}
              className="checkbox"
            />
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-text-muted" />
              <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
                Verify SSL certificates
              </span>
            </div>
          </label>
          
          <div>
            <label className="text-xs text-text-muted">Client Certificate (optional)</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={settings.clientCertificatePath}
                onChange={(e) => onChange('clientCertificatePath', e.target.value)}
                placeholder="Path to client certificate file"
                className="input flex-1"
              />
              <button onClick={handleBrowseCertPath} className="btn btn-secondary">
                Browse
              </button>
            </div>
          </div>
        </div>
      </SettingsGroup>
    </div>
  )
}

// ============================================
// Diff & Merge Settings Tab
// ============================================

function DiffMergeSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
  const handleBrowseDiffTool = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Executables', extensions: ['exe', 'app', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (path) {
      onChangeNested('diffMerge', 'externalDiffTool', path)
    }
  }

  const handleBrowseMergeTool = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Executables', extensions: ['exe', 'app', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (path) {
      onChangeNested('diffMerge', 'externalMergeTool', path)
    }
  }

  return (
    <div className="space-y-6">
      {/* External Diff Tool */}
      <SettingsGroup title="External Diff Tool" description="Application for viewing differences">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.diffMerge.externalDiffTool}
              onChange={(e) => onChangeNested('diffMerge', 'externalDiffTool', e.target.value)}
              placeholder="Leave empty for built-in diff viewer"
              className="input flex-1"
            />
            <button onClick={handleBrowseDiffTool} className="btn btn-secondary">
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Popular options: Beyond Compare, KDiff3, P4Merge, WinMerge, TortoiseMerge
          </p>
        </div>
      </SettingsGroup>

      {/* External Merge Tool */}
      <SettingsGroup title="External Merge Tool" description="Application for resolving conflicts">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.diffMerge.externalMergeTool}
              onChange={(e) => onChangeNested('diffMerge', 'externalMergeTool', e.target.value)}
              placeholder="Leave empty for built-in merge tool"
              className="input flex-1"
            />
            <button onClick={handleBrowseMergeTool} className="btn btn-secondary">
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Used for three-way merging during conflict resolution
          </p>
        </div>
      </SettingsGroup>

      {/* Diff Behavior */}
      <SettingsGroup title="Diff Behavior" description="Default diff viewing options">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.diffMerge.diffOnDoubleClick}
              onChange={(e) => onChangeNested('diffMerge', 'diffOnDoubleClick', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Show diff on double-click
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.diffMerge.ignoreWhitespace}
              onChange={(e) => onChangeNested('diffMerge', 'ignoreWhitespace', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Ignore whitespace changes by default
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.diffMerge.ignoreEol}
              onChange={(e) => onChangeNested('diffMerge', 'ignoreEol', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Ignore end-of-line differences
            </span>
          </label>
        </div>
      </SettingsGroup>

      {/* Context Lines */}
      <SettingsGroup title="Unified Diff" description="Context lines in unified diff output">
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">Context lines:</span>
          <input
            type="number"
            min="0"
            max="20"
            value={settings.diffMerge.contextLines}
            onChange={(e) => onChangeNested('diffMerge', 'contextLines', parseInt(e.target.value) || 3)}
            className="input w-20 text-center"
          />
          <span className="text-xs text-text-muted">lines of context around changes</span>
        </div>
      </SettingsGroup>
    </div>
  )
}

// ============================================
// Dialogs Settings Tab
// ============================================

function DialogsSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
  return (
    <div className="space-y-6">
      {/* Window Behavior */}
      <SettingsGroup title="Window Behavior" description="Dialog window management">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.dialogs.rememberPositions}
              onChange={(e) => onChangeNested('dialogs', 'rememberPositions', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Remember dialog positions
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.dialogs.rememberSizes}
              onChange={(e) => onChangeNested('dialogs', 'rememberSizes', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Remember dialog sizes
            </span>
          </label>
        </div>
      </SettingsGroup>

      {/* Commit Dialog */}
      <SettingsGroup title="Commit Dialog" description="Customize commit dialog behavior">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted">Visible Columns</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {['status', 'path', 'extension', 'size', 'modified'].map((col) => (
                <label key={col} className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.dialogs.commitDialogColumns.includes(col)}
                    onChange={(e) => {
                      const cols = settings.dialogs.commitDialogColumns
                      if (e.target.checked) {
                        onChangeNested('dialogs', 'commitDialogColumns', [...cols, col])
                      } else {
                        onChangeNested('dialogs', 'commitDialogColumns', cols.filter(c => c !== col))
                      }
                    }}
                    className="checkbox"
                  />
                  <span className="text-sm text-text-secondary capitalize">{col}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </SettingsGroup>

      {/* Log Dialog */}
      <SettingsGroup title="Log Dialog" description="Revision log settings">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-secondary">Messages per page:</span>
            <input
              type="number"
              min="10"
              max="500"
              value={settings.dialogs.logMessagesPerPage}
              onChange={(e) => onChangeNested('dialogs', 'logMessagesPerPage', parseInt(e.target.value) || 100)}
              className="input w-24 text-center"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-secondary">Max cached messages:</span>
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={settings.dialogs.maxCachedMessages}
              onChange={(e) => onChangeNested('dialogs', 'maxCachedMessages', parseInt(e.target.value) || 1000)}
              className="input w-24 text-center"
            />
          </div>
          <p className="text-xs text-text-muted">
            Cached log messages allow offline viewing of history
          </p>
        </div>
      </SettingsGroup>
    </div>
  )
}

// ============================================
// Notifications Settings Tab
// ============================================

function NotificationsSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
  return (
    <div className="space-y-6">
      {/* Sounds */}
      <SettingsGroup title="Sounds" description="Audio feedback">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.notifications.enableSounds}
            onChange={(e) => onChangeNested('notifications', 'enableSounds', e.target.checked)}
            className="checkbox"
          />
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-text-muted" />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Play sounds on operation completion/errors
            </span>
          </div>
        </label>
      </SettingsGroup>

      {/* System Notifications */}
      <SettingsGroup title="System Notifications" description="Desktop notifications">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.notifications.enableSystemNotifications}
            onChange={(e) => onChangeNested('notifications', 'enableSystemNotifications', e.target.checked)}
            className="checkbox"
          />
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-text-muted" />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Show system notifications for completed operations
            </span>
          </div>
        </label>
      </SettingsGroup>

      {/* Hook Output */}
      <SettingsGroup title="Hook Scripts" description="Client-side hook behavior">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.notifications.showHookOutput}
            onChange={(e) => onChangeNested('notifications', 'showHookOutput', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Show output from hook scripts
          </span>
        </label>
      </SettingsGroup>

      {/* Monitor Poll Interval */}
      <SettingsGroup title="Working Copy Monitor" description="Background status checking">
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">Poll interval:</span>
          <input
            type="number"
            min="10"
            max="600"
            value={settings.notifications.monitorPollInterval}
            onChange={(e) => onChangeNested('notifications', 'monitorPollInterval', parseInt(e.target.value) || 60)}
            className="input w-24 text-center"
          />
          <span className="text-sm text-text-muted">seconds</span>
        </div>
        <p className="text-xs text-text-muted mt-2">
          How often to check monitored working copies for changes
        </p>
      </SettingsGroup>
    </div>
  )
}

// ============================================
// Integration Settings Tab
// ============================================

function IntegrationSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
  const contextMenuOptions = [
    { id: 'update', label: 'Update' },
    { id: 'commit', label: 'Commit' },
    { id: 'revert', label: 'Revert' },
    { id: 'log', label: 'Show Log' },
    { id: 'diff', label: 'Diff' },
    { id: 'checkout', label: 'Checkout' },
    { id: 'export', label: 'Export' },
    { id: 'add', label: 'Add' },
    { id: 'delete', label: 'Delete' },
    { id: 'lock', label: 'Lock/Unlock' },
    { id: 'branch', label: 'Branch/Tag' },
    { id: 'switch', label: 'Switch' },
    { id: 'merge', label: 'Merge' },
    { id: 'relocate', label: 'Relocate' },
    { id: 'cleanup', label: 'Cleanup' },
    { id: 'resolve', label: 'Resolve' },
    { id: 'blame', label: 'Blame' },
    { id: 'properties', label: 'Properties' },
  ]

  return (
    <div className="space-y-6">
      {/* Shell Extension */}
      <SettingsGroup title="Shell Extension" description="System integration (requires setup)">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.integration.shellExtensionEnabled}
              onChange={(e) => onChangeNested('integration', 'shellExtensionEnabled', e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
              Enable shell extension (Explorer context menu)
            </span>
          </label>
          
          <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />
              <div className="text-sm text-warning">
                <p className="font-medium mb-1">Shell extension requires native build</p>
                <p className="text-xs text-warning/80">
                  Windows: Build shell extension DLL and register with administrator rights.
                  macOS: Build Finder Sync extension.
                </p>
              </div>
            </div>
          </div>
        </div>
      </SettingsGroup>

      {/* Icon Overlays */}
      <SettingsGroup title="Icon Overlays" description="Status icons in Explorer/Finder">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.integration.iconOverlaysEnabled}
            onChange={(e) => onChangeNested('integration', 'iconOverlaysEnabled', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Show status icon overlays
          </span>
        </label>
      </SettingsGroup>

      {/* Context Menu Items */}
      <SettingsGroup title="Context Menu Items" description="Which items to show in context menu">
        <div className="grid grid-cols-3 gap-2">
          {contextMenuOptions.map((opt) => (
            <label key={opt.id} className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.integration.contextMenuItems.includes(opt.id)}
                onChange={(e) => {
                  const items = settings.integration.contextMenuItems
                  if (e.target.checked) {
                    onChangeNested('integration', 'contextMenuItems', [...items, opt.id])
                  } else {
                    onChangeNested('integration', 'contextMenuItems', items.filter(i => i !== opt.id))
                  }
                }}
                className="checkbox"
              />
              <span className="text-sm text-text-secondary">{opt.label}</span>
            </label>
          ))}
        </div>
      </SettingsGroup>
    </div>
  )
}

// ============================================
// Appearance Settings Tab
// ============================================

function AppearanceSettings({ settings, onChange }: SettingsSectionProps) {
  const fontSizeOptions: { value: FontSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ]

  const accentColors = [
    { value: '#6366f1', label: 'Indigo' },
    { value: '#8b5cf6', label: 'Purple' },
    { value: '#ec4899', label: 'Pink' },
    { value: '#ef4444', label: 'Red' },
    { value: '#f97316', label: 'Orange' },
    { value: '#eab308', label: 'Yellow' },
    { value: '#22c55e', label: 'Green' },
    { value: '#14b8a6', label: 'Teal' },
    { value: '#0ea5e9', label: 'Sky' },
    { value: '#64748b', label: 'Slate' },
  ]

  return (
    <div className="space-y-6">
      {/* Sidebar Width */}
      <SettingsGroup title="Sidebar Width" description="Width of the navigation sidebar">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">{settings.sidebarWidth}px</span>
            <span className="text-xs text-text-muted">200 - 400</span>
          </div>
          <input
            type="range"
            min="200"
            max="400"
            step="10"
            value={settings.sidebarWidth}
            onChange={(e) => onChange('sidebarWidth', parseInt(e.target.value))}
            className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
          />
          <div className="flex justify-between text-xs text-text-muted">
            <span>Narrow</span>
            <span>Wide</span>
          </div>
        </div>
      </SettingsGroup>

      {/* Accent Color */}
      <SettingsGroup title="Accent Color" description="Primary color for highlights and actions">
        <div className="flex flex-wrap gap-2">
          {accentColors.map((color) => (
            <button
              key={color.value}
              onClick={() => onChange('accentColor', color.value)}
              className={`
                w-8 h-8 rounded-full border-2 transition-all
                ${settings.accentColor === color.value
                  ? 'border-white scale-110'
                  : 'border-transparent hover:scale-105'
                }
              `}
              style={{ backgroundColor: color.value }}
              title={color.label}
            />
          ))}
        </div>
      </SettingsGroup>

      {/* Font Size */}
      <SettingsGroup title="Font Size" description="Base font size for the interface">
        <div className="relative">
          <select
            value={settings.fontSize}
            onChange={(e) => onChange('fontSize', e.target.value as FontSize)}
            className="input appearance-none pr-10 cursor-pointer"
          >
            {fontSizeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </SettingsGroup>

      {/* Animation Speed */}
      <SettingsGroup title="Animation Speed" description="UI transition animations">
        <div className="flex gap-2">
          {[
            { value: 'none', label: 'None' },
            { value: 'fast', label: 'Fast' },
            { value: 'normal', label: 'Normal' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange('animationSpeed', opt.value as AppSettings['animationSpeed'])}
              className={`
                flex-1 px-3 py-2 text-sm rounded-md border transition-fast
                ${settings.animationSpeed === opt.value
                  ? 'bg-accent/10 border-accent text-accent'
                  : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </SettingsGroup>

      {/* Status Bar */}
      <SettingsGroup title="Status Bar" description="Bottom status bar visibility">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.showStatusBar}
            onChange={(e) => onChange('showStatusBar', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Show status bar
          </span>
        </label>
      </SettingsGroup>

      {/* File List Height */}
      <SettingsGroup title="File List Height" description="How file list fills available space">
        <div className="flex gap-2">
          <button
            onClick={() => onChange('fileListHeight', 'fill')}
            className={`flex-1 px-3 py-2 text-sm rounded-md border transition-fast ${
              settings.fileListHeight === 'fill'
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
            }`}
          >
            Fill Space
          </button>
          <button
            onClick={() => onChange('fileListHeight', 'auto')}
            className={`flex-1 px-3 py-2 text-sm rounded-md border transition-fast ${
              settings.fileListHeight === 'auto'
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
            }`}
          >
            Compact
          </button>
        </div>
        <p className="text-xs text-text-muted mt-2">
          {settings.fileListHeight === 'fill' 
            ? 'File list fills all available vertical space'
            : 'File list only takes space needed for content'}
        </p>
      </SettingsGroup>

      {/* Compact Mode */}
      <SettingsGroup title="Compact Mode" description="Reduce file row height">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.compactFileRows}
            onChange={(e) => onChange('compactFileRows', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Use compact file rows
          </span>
        </label>
      </SettingsGroup>

      {/* File Thumbnails */}
      <SettingsGroup title="File Thumbnails" description="Show image previews in file list">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.showThumbnails}
            onChange={(e) => onChange('showThumbnails', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Show image thumbnails
          </span>
        </label>
        <p className="text-xs text-text-muted mt-2">
          Display actual image previews for image files (may slightly affect performance)
        </p>
      </SettingsGroup>

      {/* Folder Sizes */}
      <SettingsGroup title="Folder Sizes" description="Calculate folder sizes in file list">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.showFolderSizes}
            onChange={(e) => onChange('showFolderSizes', e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Show folder sizes
          </span>
        </label>
        <p className="text-xs text-text-muted mt-2">
          Calculate total size of folders (can be slow for large directories)
        </p>
      </SettingsGroup>

      {/* Preview */}
      <div className="mt-6 p-4 rounded-lg border border-border bg-bg-tertiary">
        <p className="text-xs text-text-muted mb-3">Preview</p>
        <div 
          className={`
            ${settings.fontSize === 'small' ? 'text-xs' : ''}
            ${settings.fontSize === 'medium' ? 'text-sm' : ''}
            ${settings.fontSize === 'large' ? 'text-base' : ''}
          `}
        >
          <p className="text-text mb-1">Sample text at {settings.fontSize} size</p>
          <p className="text-text-secondary">Secondary text color</p>
          <button 
            className="mt-2 px-3 py-1 rounded text-white text-sm"
            style={{ backgroundColor: settings.accentColor }}
          >
            Accent Button
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Authentication Settings Tab
// ============================================

interface AuthSettingsProps {
  settings: AppSettings
  onRemoveCredential: (index: number) => void
  onClearAll: () => void
}

function AuthSettings({ settings, onRemoveCredential, onClearAll }: AuthSettingsProps) {
  const credentials = settings.savedCredentials || []

  return (
    <div className="space-y-6">
      {/* Info */}
      <div className="p-4 rounded-lg bg-info/10 border border-info/20">
        <p className="text-sm text-info">
          Saved credentials are stored securely in your system's keychain.
        </p>
      </div>

      {/* Credentials List */}
      <SettingsGroup title="Saved Credentials" description="Authentication data stored for SVN repositories">
        {credentials.length === 0 ? (
          <div className="py-8 text-center">
            <Key className="w-10 h-10 text-text-faint mx-auto mb-3" />
            <p className="text-sm text-text-muted">No saved credentials</p>
            <p className="text-xs text-text-faint mt-1">
              Credentials are saved automatically when you authenticate
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {credentials.map((cred, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg bg-bg-tertiary border border-border group"
              >
                <div className="flex-1 min-w-0 mr-4">
                  <p className="text-sm font-medium text-text truncate">{cred.username}</p>
                  <p className="text-xs text-text-muted truncate">{cred.realm}</p>
                </div>
                <button
                  onClick={() => onRemoveCredential(index)}
                  className="btn-icon-sm opacity-0 group-hover:opacity-100 text-error hover:bg-error/10 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>

      {/* Clear All */}
      {credentials.length > 0 && (
        <div className="pt-4 border-t border-border">
          <button
            onClick={onClearAll}
            className="btn btn-danger"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Credentials
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Advanced Settings Tab
// ============================================

interface AdvancedSettingsProps {
  settings: AppSettings
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  onReset: () => void
  showResetConfirm: boolean
  setShowResetConfirm: (show: boolean) => void
}

function AdvancedSettings({ 
  settings, 
  onChange, 
  onReset, 
  showResetConfirm, 
  setShowResetConfirm 
}: AdvancedSettingsProps) {
  const [cacheSize, setCacheSize] = useState<{ size: number; files: number }>({ size: 0, files: 0 })
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)
  const [cacheError, setCacheError] = useState<string | null>(null)
  
  const logLevels: { value: LogLevel; label: string; description: string }[] = [
    { value: 'error', label: 'Error', description: 'Only errors' },
    { value: 'warn', label: 'Warning', description: 'Errors and warnings' },
    { value: 'info', label: 'Info', description: 'General information' },
    { value: 'debug', label: 'Debug', description: 'Verbose debugging' },
  ]

  // Load cache size on mount
  useEffect(() => {
    loadCacheSize()
  }, [])

  const loadCacheSize = async () => {
    try {
      const result = await window.api.app.getCacheSize()
      setCacheSize(result)
    } catch {
      setCacheSize({ size: 0, files: 0 })
    }
  }

  const handleBrowseSvnConfig = async () => {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      onChange('svnConfigPath', path)
    }
  }

  const handleBrowseLogCache = async () => {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      onChange('logCachePath', path)
    }
  }

  const handleClearCache = async () => {
    setIsClearingCache(true)
    setCacheCleared(false)
    setCacheError(null)
    
    try {
      const result = await window.api.app.clearCache()
      if (result.success) {
        setCacheCleared(true)
        setCacheSize({ size: 0, files: 0 })
        setTimeout(() => setCacheCleared(false), 3000)
      } else {
        setCacheError(result.error || 'Unknown error')
      }
    } catch (err) {
      setCacheError((err as Error).message)
    } finally {
      setIsClearingCache(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
  }

  return (
    <div className="space-y-6">
      {/* Log Level */}
      <SettingsGroup title="Log Level" description="Diagnostic output verbosity">
        <div className="relative">
          <select
            value={settings.logLevel}
            onChange={(e) => onChange('logLevel', e.target.value as LogLevel)}
            className="input appearance-none pr-10 cursor-pointer"
          >
            {logLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label} - {level.description}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </SettingsGroup>

      {/* Paths */}
      <SettingsGroup title="Custom Paths" description="Override default locations">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted">SVN Config Directory</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={settings.svnConfigPath}
                onChange={(e) => onChange('svnConfigPath', e.target.value)}
                placeholder="Default: ~/.subversion"
                className="input flex-1"
              />
              <button onClick={handleBrowseSvnConfig} className="btn btn-secondary">
                Browse
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-muted">Log Cache Directory</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={settings.logCachePath}
                onChange={(e) => onChange('logCachePath', e.target.value)}
                placeholder="Default: Application data"
                className="input flex-1"
              />
              <button onClick={handleBrowseLogCache} className="btn btn-secondary">
                Browse
              </button>
            </div>
          </div>
        </div>
      </SettingsGroup>

      {/* Cache Size */}
      <SettingsGroup title="Log Cache" description="Cached revision history">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-text-secondary">Current cache:</span>
              <span className="text-sm text-text font-mono">
                {formatBytes(cacheSize.size)} ({cacheSize.files} files)
              </span>
            </div>
            <button 
              onClick={loadCacheSize}
              className="btn-icon-sm"
              title="Refresh"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-secondary">Max cache size:</span>
            <input
              type="number"
              min="10"
              max="1000"
              step="10"
              value={settings.maxLogCacheSize}
              onChange={(e) => onChange('maxLogCacheSize', parseInt(e.target.value) || 100)}
              className="input w-24 text-center"
            />
            <span className="text-sm text-text-muted">MB</span>
          </div>
          
          {cacheCleared && (
            <div className="flex items-center gap-2 text-sm text-success">
              <Check className="w-4 h-4" />
              Cache cleared successfully
            </div>
          )}
          
          {cacheError && (
            <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Failed to clear cache: {cacheError}</span>
            </div>
          )}
          
          <button 
            onClick={handleClearCache} 
            disabled={isClearingCache}
            className="btn btn-secondary"
          >
            {isClearingCache ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Clearing...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Clear Cache
              </>
            )}
          </button>
          <p className="text-xs text-text-muted">
            Clears temporary files, cached repository data, and application cache
          </p>
        </div>
      </SettingsGroup>

      {/* Reset to Defaults */}
      <SettingsGroup title="Reset" description="Restore default settings">
        {showResetConfirm ? (
          <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
            <p className="text-sm text-warning mb-3">
              Are you sure you want to reset all settings to defaults?
            </p>
            <div className="flex gap-3">
              <button
                onClick={onReset}
                className="btn btn-danger"
              >
                Yes, Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="btn btn-secondary"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Defaults
            </button>
            <p className="text-xs text-text-muted mt-2">
              This will restore all settings to their default values
            </p>
          </div>
        )}
      </SettingsGroup>

      {/* Danger Zone */}
      <div className="pt-4 border-t border-border">
        <div className="p-4 rounded-lg border border-error/20 bg-error/5">
          <h4 className="text-sm font-medium text-error mb-2">Danger Zone</h4>
          <p className="text-xs text-text-muted mb-3">
            These actions cannot be undone. Be careful.
          </p>
          <button
            onClick={() => setShowResetConfirm(true)}
            className="btn btn-danger"
          >
            <AlertTriangle className="w-4 h-4" />
            Factory Reset
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Helper Components
// ============================================

interface SettingsGroupProps {
  title: string
  description?: string
  children: React.ReactNode
}

function SettingsGroup({ title, description, children }: SettingsGroupProps) {
  return (
    <div>
      <div className="mb-3">
        <h4 className="text-sm font-medium text-text">{title}</h4>
        {description && (
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

// ============================================
// Convenience Components
// ============================================

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-icon"
      title="Settings"
    >
      <Settings className="w-5 h-5" />
    </button>
  )
}

export function SettingsMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-secondary hover:text-text hover:bg-bg-tertiary rounded-md transition-fast"
    >
      <Settings className="w-4 h-4" />
      Settings
    </button>
  )
}
