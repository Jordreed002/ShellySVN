import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  FolderOpen,
  FolderSync,
  Key,
  Loader2,
  Monitor,
  Moon,
  Pencil,
  Play,
  RotateCcw,
  Shield,
  Sun,
  Terminal,
  Trash2,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';

import type {
  AppSettings,
  AuthListEntry,
  FontSize,
  LogLevel,
  StartupAction,
  WorkingCopyFormat,
} from '@shared/types';
import { formatBytes } from '@shared/utils/formatBytes';

import { promptAppInput } from '../../utils/dialogs';
// ============================================
// General Settings Tab
// ============================================

interface SettingsSectionProps {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

interface NestedSettingsProps {
  settings: AppSettings;
  onChangeNested: <K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => void;
}

export function GeneralSettings({ settings, onChange }: SettingsSectionProps) {
  const handleBrowseCheckoutDir = async () => {
    const path = await window.api.dialog.openDirectory();
    if (path) {
      onChange('defaultCheckoutDirectory', path);
    }
  };

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
                ${
                  settings.theme === option.value
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
      <SettingsGroup
        title="Default Checkout Directory"
        description="Where new checkouts are saved by default"
      >
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

      {/* Tutorial */}
      <SettingsGroup title="Tutorial" description="Onboarding and help">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Learn how to use ShellySVN effectively with our interactive tutorial.
          </p>
          <button
            onClick={() => {
              // This will be handled by parent component
              window.dispatchEvent(new CustomEvent('tutorial:restart'));
            }}
            className="btn btn-secondary gap-2"
          >
            <Play className="w-4 h-4" />
            Restart Tutorial
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}

// ============================================
// SVN Settings Tab
// ============================================

interface SvnSettingsProps extends SettingsSectionProps {
  onChangeNested: <K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => void;
}

export function SvnSettings({ settings, onChange, onChangeNested }: SvnSettingsProps) {
  const handleBrowseSvnPath = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Executables', extensions: ['exe', 'app', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (path) {
      onChange('svnClientPath', path);
    }
  };

  const handleBrowseCertPath = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Certificates', extensions: ['p12', 'pem', 'crt', 'cer'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (path) {
      onChange('clientCertificatePath', path);
    }
  };

  const handleAddIgnorePattern = async () => {
    const pattern = await promptAppInput({
      title: 'Add ignore pattern',
      message: 'Enter ignore pattern',
      placeholder: '*.log, node_modules/',
      confirmLabel: 'Add',
    });
    if (pattern && pattern.trim()) {
      onChange('globalIgnorePatterns', [...settings.globalIgnorePatterns, pattern.trim()]);
    }
  };

  const handleRemoveIgnorePattern = (index: number) => {
    const newPatterns = settings.globalIgnorePatterns.filter((_, i) => i !== index);
    onChange('globalIgnorePatterns', newPatterns);
  };

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
          <label
            className="flex items-center gap-3 cursor-pointer group"
            aria-label="Show in Explorer context menu"
          >
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
          <label
            className="flex items-center gap-3 cursor-pointer group"
            aria-label="Show in Explorer context menu"
          >
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
                <label htmlFor="settings-proxy-host" className="text-xs text-text-muted">Host</label>
                <input
                  id="settings-proxy-host"
                  type="text"
                  value={settings.proxySettings.host}
                  onChange={(e) => onChangeNested('proxySettings', 'host', e.target.value)}
                  placeholder="proxy.example.com"
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="settings-proxy-port" className="text-xs text-text-muted">Port</label>
                <input
                  id="settings-proxy-port"
                  type="number"
                  value={settings.proxySettings.port}
                  onChange={(e) =>
                    onChangeNested('proxySettings', 'port', parseInt(e.target.value) || 8080)
                  }
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="settings-proxy-username" className="text-xs text-text-muted">
                  Username (optional)
                </label>
                <input
                  id="settings-proxy-username"
                  type="text"
                  value={settings.proxySettings.username}
                  onChange={(e) => onChangeNested('proxySettings', 'username', e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="settings-proxy-password" className="text-xs text-text-muted">
                  Password (optional)
                </label>
                <input
                  id="settings-proxy-password"
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
                    onChange={(e) =>
                      onChangeNested('proxySettings', 'bypassForLocal', e.target.checked)
                    }
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
            <label htmlFor="settings-client-certificate" className="text-xs text-text-muted">
              Client Certificate (optional)
            </label>
            <div className="flex gap-2 mt-1">
              <input
                id="settings-client-certificate"
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
  );
}

// ============================================
// Diff & Merge Settings Tab
// ============================================

export function DiffMergeSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
  const toolOverrides = settings.diffMerge.externalToolOverrides ?? [];

  const handleBrowseDiffTool = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Executables', extensions: ['exe', 'app', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (path) {
      onChangeNested('diffMerge', 'externalDiffTool', path);
    }
  };

  const handleBrowseMergeTool = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'Executables', extensions: ['exe', 'app', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (path) {
      onChangeNested('diffMerge', 'externalMergeTool', path);
    }
  };

  const updateToolOverride = (
    index: number,
    key: 'extension' | 'diffTool' | 'mergeTool',
    value: string
  ) => {
    const next = toolOverrides.map((override, overrideIndex) =>
      overrideIndex === index ? { ...override, [key]: value } : override
    );
    onChangeNested('diffMerge', 'externalToolOverrides', next);
  };

  const addToolOverride = () => {
    onChangeNested('diffMerge', 'externalToolOverrides', [
      ...toolOverrides,
      { extension: '', diffTool: '', mergeTool: '' },
    ]);
  };

  const removeToolOverride = (index: number) => {
    onChangeNested(
      'diffMerge',
      'externalToolOverrides',
      toolOverrides.filter((_, overrideIndex) => overrideIndex !== index)
    );
  };

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

      <SettingsGroup
        title="Per-Extension Tools"
        description="Override diff or merge tools for specific file extensions"
      >
        <div className="space-y-3">
          {toolOverrides.map((override, index) => (
            <div key={index} className="grid grid-cols-[96px_1fr_1fr_auto] gap-2 items-center">
              <input
                type="text"
                value={override.extension}
                onChange={(e) => updateToolOverride(index, 'extension', e.target.value)}
                placeholder="ts"
                className="input"
                aria-label={`Extension override ${index + 1}`}
              />
              <input
                type="text"
                value={override.diffTool}
                onChange={(e) => updateToolOverride(index, 'diffTool', e.target.value)}
                placeholder="Diff tool override"
                className="input"
                aria-label={`Diff tool override ${index + 1}`}
              />
              <input
                type="text"
                value={override.mergeTool}
                onChange={(e) => updateToolOverride(index, 'mergeTool', e.target.value)}
                placeholder="Merge tool override"
                className="input"
                aria-label={`Merge tool override ${index + 1}`}
              />
              <button
                type="button"
                onClick={() => removeToolOverride(index)}
                className="btn-icon-sm text-error hover:bg-error/10"
                aria-label={`Remove tool override ${index + 1}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={addToolOverride} className="btn btn-secondary btn-sm">
            Add Extension Override
          </button>
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
            onChange={(e) =>
              onChangeNested('diffMerge', 'contextLines', parseInt(e.target.value) || 3)
            }
            className="input w-20 text-center"
          />
          <span className="text-xs text-text-muted">lines of context around changes</span>
        </div>
      </SettingsGroup>
    </div>
  );
}

// ============================================
// Dialogs Settings Tab
// ============================================

export function DialogsSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
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
            <div className="text-xs text-text-muted">Visible Columns</div>
            <div className="flex flex-wrap gap-2 mt-2">
              {['status', 'path', 'extension', 'size', 'modified'].map((col) => (
                <label key={col} className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.dialogs.commitDialogColumns.includes(col)}
                    onChange={(e) => {
                      const cols = settings.dialogs.commitDialogColumns;
                      if (e.target.checked) {
                        onChangeNested('dialogs', 'commitDialogColumns', [...cols, col]);
                      } else {
                        onChangeNested(
                          'dialogs',
                          'commitDialogColumns',
                          cols.filter((c) => c !== col)
                        );
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
              onChange={(e) =>
                onChangeNested('dialogs', 'logMessagesPerPage', parseInt(e.target.value) || 100)
              }
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
              onChange={(e) =>
                onChangeNested('dialogs', 'maxCachedMessages', parseInt(e.target.value) || 1000)
              }
              className="input w-24 text-center"
            />
          </div>
          <p className="text-xs text-text-muted">
            Cached log messages allow offline viewing of history
          </p>
        </div>
      </SettingsGroup>
    </div>
  );
}

// ============================================
// Notifications Settings Tab
// ============================================

export function NotificationsSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
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
            onChange={(e) =>
              onChangeNested('notifications', 'enableSystemNotifications', e.target.checked)
            }
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
            onChange={(e) =>
              onChangeNested('notifications', 'monitorPollInterval', parseInt(e.target.value) || 60)
            }
            className="input w-24 text-center"
          />
          <span className="text-sm text-text-muted">seconds</span>
        </div>
        <p className="text-xs text-text-muted mt-2">
          How often to check monitored working copies for changes
        </p>
      </SettingsGroup>
    </div>
  );
}

// ============================================
// Integration Settings Tab
// ============================================

interface IntegrationSettingsProps extends NestedSettingsProps {
  onOpenShellIntegration: () => void;
}

export function IntegrationSettingsTab({ settings, onChangeNested, onOpenShellIntegration }: IntegrationSettingsProps) {
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  ];

  // Check registration status on mount
  useEffect(() => {
    const checkStatus = async () => {
      setIsLoading(true);
      try {
        const result = await window.api.shell.isRegistered();
        setIsRegistered(result.registered);
      } catch {
        setIsRegistered(false);
      } finally {
        setIsLoading(false);
      }
    };
    checkStatus();
  }, []);

  const handleRegister = async () => {
    setIsRegistering(true);
    setError(null);
    try {
      const result = await window.api.shell.register();
      if (result.success) {
        setIsRegistered(true);
        onChangeNested('integration', 'shellExtensionEnabled', true);
      } else {
        setError('Failed to register shell integration');
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to register shell integration');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleUnregister = async () => {
    setIsRegistering(true);
    setError(null);
    try {
      const result = await window.api.shell.unregister();
      if (result.success) {
        setIsRegistered(false);
        onChangeNested('integration', 'shellExtensionEnabled', false);
      } else {
        setError('Failed to unregister shell integration');
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to unregister shell integration');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Shell Integration */}
      <SettingsGroup title="Shell Integration" description="Configure shell extension, icon overlays, and context menu integration">
        <div className="space-y-4">
          {/* Status indicator */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-bg-tertiary border border-border">
            <div className="flex items-center gap-3">
              {isLoading ? (
                <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
              ) : isRegistered ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : (
                <AlertCircle className="w-5 h-5 text-text-muted" />
              )}
              <div>
                <p className="text-sm font-medium text-text">
                  {isLoading ? 'Checking status...' : isRegistered ? 'Registered' : 'Not Registered'}
                </p>
                <p className="text-xs text-text-muted">
                  {isRegistered
                    ? 'Shell extension is active'
                    : 'Register to enable context menu integration'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={isRegistered ? handleUnregister : handleRegister}
              disabled={isRegistering || isLoading}
              className={isRegistered ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
            >
              {isRegistering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isRegistered ? (
                <FolderSync className="w-4 h-4" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              {isRegistering ? 'Please wait...' : isRegistered ? 'Unregister' : 'Register'}
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-sm text-error">
              {error}
            </div>
          )}

          {/* Toggle for context menu */}
          <label
            className="flex items-center gap-3 cursor-pointer group"
            aria-label="Show in Explorer context menu"
          >
            <input
              type="checkbox"
              checked={settings.integration.shellExtensionEnabled}
              onChange={(e) =>
                onChangeNested('integration', 'shellExtensionEnabled', e.target.checked)
              }
              className="checkbox"
            />
            <div className="flex-1">
              <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
                Show in Explorer context menu
              </span>
              <p className="text-xs text-text-faint">
                Add SVN options to right-click menu in Explorer/Finder
              </p>
            </div>
          </label>

          {/* Advanced setup button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={onOpenShellIntegration}
              className="btn btn-secondary btn-sm"
            >
              <Wrench className="w-4 h-4" />
              Advanced Setup...
            </button>
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
                  const items = settings.integration.contextMenuItems;
                  if (e.target.checked) {
                    onChangeNested('integration', 'contextMenuItems', [...items, opt.id]);
                  } else {
                    onChangeNested(
                      'integration',
                      'contextMenuItems',
                      items.filter((i) => i !== opt.id)
                    );
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
  );
}

// ============================================
// Appearance Settings Tab
// ============================================

export function AppearanceSettings({ settings, onChange }: SettingsSectionProps) {
  const fontSizeOptions: { value: FontSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ];

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
  ];

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
                ${
                  settings.accentColor === color.value
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
            { value: 'none', label: 'Minimal' },
            { value: 'fast', label: 'Fast' },
            { value: 'normal', label: 'Normal' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange('animationSpeed', opt.value as AppSettings['animationSpeed'])}
              className={`
                flex-1 px-3 py-2 text-sm rounded-md border transition-fast
                ${
                  settings.animationSpeed === opt.value
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
  );
}

// ============================================
// Authentication Settings Tab
// ============================================

interface AuthSettingsProps {
  isOpen: boolean;
}

export function getCredentialEncryptionStatusCopy(
  encryptionAvailable: boolean,
  platform: NodeJS.Platform | undefined
): string {
  const platformName =
    platform === 'win32'
      ? 'Windows'
      : platform === 'darwin'
        ? 'macOS'
        : platform === 'linux'
          ? 'Linux'
          : 'this platform';

  if (encryptionAvailable) {
    const secureStore =
      platform === 'win32'
        ? 'Windows secure storage'
        : platform === 'darwin'
          ? 'macOS Keychain'
          : platform === 'linux'
            ? 'Linux secret service'
            : 'the platform secure store';
    return `${secureStore} is available. Persistent SVN credentials are encrypted before they are saved.`;
  }

  return `Credential encryption is unavailable on ${platformName}. SVN credentials stay memory-only and are not saved persistently.`;
}

export function AuthSettings({ isOpen }: AuthSettingsProps) {
  const [credentials, setCredentials] = useState<AuthListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEncryptionAvailable, setIsEncryptionAvailable] = useState<boolean | null>(null);
  const [editingRealm, setEditingRealm] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const platform = window.electron?.process?.platform;

  useEffect(() => {
    if (!isOpen) return;

    const loadCredentials = async () => {
      setIsLoading(true);
      try {
        const [list, encryptionAvailable] = await Promise.all([
          window.api.auth.list(),
          window.api.auth.isEncryptionAvailable(),
        ]);
        setCredentials(list);
        setIsEncryptionAvailable(encryptionAvailable);
      } catch {
        setCredentials([]);
        setIsEncryptionAvailable(false);
      } finally {
        setIsLoading(false);
      }
    };
    loadCredentials();
  }, [isOpen]);

  const handleRemove = async (realm: string) => {
    try {
      await window.api.auth.delete(realm);
      const list = await window.api.auth.list();
      setCredentials(list);
      if (editingRealm === realm) {
        setEditingRealm(null);
        setEditUsername('');
        setEditPassword('');
      }
    } catch {
      setCredentials([]);
    }
  };

  const handleClearAll = async () => {
    try {
      await window.api.auth.clear();
      setCredentials([]);
    } catch {
      setCredentials([]);
    }
  };

  const handleStartEdit = (credential: AuthListEntry) => {
    setEditingRealm(credential.realm);
    setEditUsername(credential.username);
    setEditPassword('');
  };

  const handleCancelEdit = () => {
    setEditingRealm(null);
    setEditUsername('');
    setEditPassword('');
  };

  const handleSaveEdit = async () => {
    if (!editingRealm || !editUsername.trim() || !editPassword) return;

    setIsSavingEdit(true);
    try {
      await window.api.auth.set(editingRealm, editUsername.trim(), editPassword);
      const list = await window.api.auth.list();
      setCredentials(list);
      handleCancelEdit();
    } catch {
      setCredentials([]);
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      {isEncryptionAvailable === null ? (
        <div className="p-4 rounded-lg bg-bg-tertiary border border-border">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-text-muted animate-spin" />
            <p className="text-sm text-text-muted">Checking encryption status...</p>
          </div>
        </div>
      ) : isEncryptionAvailable ? (
        <div className="p-4 rounded-lg bg-success/10 border border-success/20">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-success" />
            <p className="text-sm text-success">
              {getCredentialEncryptionStatusCopy(true, platform)}
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <p className="text-sm text-warning">
              {getCredentialEncryptionStatusCopy(false, platform)}
            </p>
          </div>
        </div>
      )}

      <SettingsGroup
        title="Saved Credentials"
        description="Authentication data stored for SVN repositories"
      >
        {isLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-8 h-8 text-text-muted mx-auto mb-3 animate-spin" />
            <p className="text-sm text-text-muted">Loading credentials...</p>
          </div>
        ) : credentials.length === 0 ? (
          <div className="py-8 text-center">
            <Key className="w-10 h-10 text-text-faint mx-auto mb-3" />
            <p className="text-sm text-text-muted">No saved credentials</p>
            <p className="text-xs text-text-faint mt-1">
              Credentials are saved automatically when you authenticate
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {credentials.map((cred) => (
              <div
                key={cred.realm}
                className="p-3 rounded-lg bg-bg-tertiary border border-border group"
              >
                {editingRealm === cred.realm ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-text-muted truncate">{cred.realm}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className="input text-sm"
                        aria-label={`Username for ${cred.realm}`}
                      />
                      <input
                        type="password"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        className="input text-sm"
                        placeholder="New password"
                        aria-label={`New password for ${cred.realm}`}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="btn-icon-sm text-text-muted hover:bg-bg-secondary"
                        aria-label={`Cancel editing ${cred.realm}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={isSavingEdit || !editUsername.trim() || !editPassword}
                        className="btn-icon-sm text-success hover:bg-success/10 disabled:opacity-50"
                        aria-label={`Save credentials for ${cred.realm}`}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-4">
                      <p className="text-sm font-medium text-text truncate">{cred.username}</p>
                      <p className="text-xs text-text-muted truncate">{cred.realm}</p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(cred)}
                        className="btn-icon-sm text-text-muted hover:bg-bg-secondary"
                        aria-label={`Edit credentials for ${cred.realm}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(cred.realm)}
                        className="btn-icon-sm text-error hover:bg-error/10"
                        aria-label={`Delete credentials for ${cred.realm}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>

      {credentials.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClearAll}
            className="btn btn-ghost text-error hover:bg-error/10"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Credentials
          </button>
        </div>
      )}

      {/* SSL Certificates Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Key className="w-4 h-4" />
          SSL Certificates
        </h4>
        <p className="text-xs text-text-secondary">
          Client certificate management coming soon. For now, configure certificates in the SVN tab.
        </p>
        <div className="text-xs text-text-faint">
          Current certificate path: Not configured
        </div>
      </div>

      {/* SSH Keys Section */}
      <div className="space-y-4 mt-6">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          SSH Keys
        </h4>
        <p className="text-xs text-text-secondary">
          SSH key management coming soon. SVN+SSH connections will use your system's ssh-agent.
        </p>
      </div>
    </div>
  );
}

// ============================================
// Advanced Settings Tab
// ============================================

// ============================================
// Advanced Settings Tab
// ============================================

interface AdvancedSettingsProps {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
  showResetConfirm: boolean;
  setShowResetConfirm: (show: boolean) => void;
}

export function AdvancedSettings({
  settings,
  onChange,
  onReset,
  showResetConfirm,
  setShowResetConfirm,
}: AdvancedSettingsProps) {
  const [cacheSize, setCacheSize] = useState<{ size: number; files: number }>({
    size: 0,
    files: 0,
  });
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const logLevels: { value: LogLevel; label: string; description: string }[] = [
    { value: 'error', label: 'Error', description: 'Only errors' },
    { value: 'warn', label: 'Warning', description: 'Errors and warnings' },
    { value: 'info', label: 'Info', description: 'General information' },
    { value: 'debug', label: 'Debug', description: 'Verbose debugging' },
  ];

  // Load cache size on mount
  useEffect(() => {
    loadCacheSize();
  }, []);

  const loadCacheSize = async () => {
    try {
      const result = await window.api.app.getCacheSize();
      setCacheSize(result);
    } catch {
      setCacheSize({ size: 0, files: 0 });
    }
  };

  const handleBrowseSvnConfig = async () => {
    const path = await window.api.dialog.openDirectory();
    if (path) {
      onChange('svnConfigPath', path);
    }
  };

  const handleBrowseLogCache = async () => {
    const path = await window.api.dialog.openDirectory();
    if (path) {
      onChange('logCachePath', path);
    }
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    setCacheCleared(false);
    setCacheError(null);

    try {
      const result = await window.api.app.clearCache();
      if (result.success) {
        setCacheCleared(true);
        setCacheSize({ size: 0, files: 0 });
        setTimeout(() => setCacheCleared(false), 3000);
      } else {
        setCacheError(result.error || 'Unknown error');
      }
    } catch (err) {
      setCacheError((err as Error).message);
    } finally {
      setIsClearingCache(false);
    }
  };

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
            <label htmlFor="settings-svn-config-path" className="text-xs text-text-muted">
              SVN Config Directory
            </label>
            <div className="flex gap-2 mt-1">
              <input
                id="settings-svn-config-path"
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
            <label htmlFor="settings-log-cache-path" className="text-xs text-text-muted">
              Log Cache Directory
            </label>
            <div className="flex gap-2 mt-1">
              <input
                id="settings-log-cache-path"
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
            <button onClick={loadCacheSize} className="btn-icon-sm" title="Refresh">
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
              <button onClick={onReset} className="btn btn-danger">
                Yes, Reset
              </button>
              <button onClick={() => setShowResetConfirm(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button onClick={() => setShowResetConfirm(true)} className="btn btn-secondary">
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
          <button onClick={() => setShowResetConfirm(true)} className="btn btn-danger">
            <AlertTriangle className="w-4 h-4" />
            Factory Reset
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

interface SettingsGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, description, children }: SettingsGroupProps) {
  return (
    <div>
      <div className="mb-3">
        <h4 className="text-sm font-medium text-text">{title}</h4>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// ============================================
// Convenience Components
// ============================================

