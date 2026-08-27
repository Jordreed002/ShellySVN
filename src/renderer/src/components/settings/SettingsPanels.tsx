import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  FolderSync,
  Key,
  Loader2,
  Monitor,
  Moon,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
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
  SvnCredentialVerifyResult,
  SvnNativeAuthEntry,
  WorkingCopyFormat,
} from '@shared/types';
import { formatBytes } from '@shared/utils/formatBytes';

import { promptAppInput } from '../../utils/dialogs';
import { FONT_SCALE_STEPS, normalizeHexColor } from '../../lib/appearance';
import {
  exportSettingsToFile,
  parseSettingsImport,
  readSettingsImportFile,
} from '../../lib/settingsTransfer';
import { ExternalToolsSettings } from './ExternalToolsSettings';
import { OpenWithSettings } from './OpenWithSettings';
import { SettingsGroup } from './SettingsGroup';
import { useAppUpdater } from '../../hooks/useAppUpdater';

function clampedInteger(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}
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
      <SettingsGroup title="Theme" description="Choose your preferred color scheme" resetKeys={['theme']}>
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
      <SettingsGroup title="Language" description="Application display language" resetKeys={['language']}>
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
      <SettingsGroup title="Startup" description="What to do when the application starts" resetKeys={['startupAction']}>
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
        resetKeys={['defaultCheckoutDirectory']}
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

      <UpdatesSettings settings={settings} onChange={onChange} />

      {/* Single Instance Mode */}
      <SettingsGroup title="Instance Management" description="Application behavior" resetKeys={['singleInstanceMode']}>
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
      <SettingsGroup title="Safety" description="Operation confirmations" resetKeys={['confirmDestructiveOps']}>
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

function UpdatesSettings({ settings, onChange }: SettingsSectionProps) {
  const { state, check } = useAppUpdater();
  const [version, setVersion] = useState('…');

  useEffect(() => {
    let active = true;
    void window.api.app.getVersion().then((value) => {
      if (active) setVersion(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const statusText = (() => {
    if (!state) return 'Reading update status…';
    if (state.status === 'unsupported') return 'This installation is updated manually.';
    if (state.status === 'checking') return 'Checking for updates…';
    if (state.status === 'upToDate') return `ShellySVN ${version} is up to date.`;
    if (state.status === 'available') return `Version ${state.availableVersion} is available.`;
    if (state.status === 'downloading') return `Downloading ${Math.round(state.percent)}%`;
    if (state.status === 'downloaded')
      return `Version ${state.availableVersion} is ready to install.`;
    if (state.status === 'error') return state.message;
    return `ShellySVN ${version}`;
  })();

  return (
    <SettingsGroup
      title="Updates"
      description="Keep ShellySVN current without interrupting SVN work"
      resetKeys={['checkUpdatesOnStartup', 'updateChannel']}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-tertiary/55 p-3">
          <div>
            <p className="text-sm font-semibold text-text">ShellySVN {version}</p>
            <p
              className={`mt-0.5 text-xs ${state?.status === 'error' ? 'text-danger' : 'text-text-muted'}`}
              role={state?.status === 'error' ? 'alert' : undefined}
            >
              {statusText}
            </p>
          </div>
          {state?.status === 'unsupported' ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void window.api.app.openExternal(state.manualDownloadUrl)}
            >
              <ExternalLink className="h-4 w-4" />
              Downloads
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={state?.status === 'checking' || state?.status === 'downloading'}
              onClick={() => void check()}
            >
              <RefreshCw
                className={`h-4 w-4 ${state?.status === 'checking' ? 'animate-spin' : ''}`}
              />
              Check now
            </button>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-3 group">
          <input
            type="checkbox"
            checked={settings.checkUpdatesOnStartup}
            onChange={(event) => onChange('checkUpdatesOnStartup', event.target.checked)}
            className="checkbox"
          />
          <span className="text-sm text-text-secondary group-hover:text-text transition-fast">
            Check automatically at startup and every six hours
          </span>
        </label>

        <div>
          <label
            htmlFor="update-channel"
            className="mb-1.5 block text-xs font-medium text-text-muted"
          >
            Release channel
          </label>
          <div className="relative">
            <select
              id="update-channel"
              value={settings.updateChannel}
              onChange={(event) =>
                onChange('updateChannel', event.target.value as AppSettings['updateChannel'])
              }
              className="input appearance-none pr-10 cursor-pointer"
            >
              <option value="stable">Stable — recommended</option>
              <option value="preview">Preview — beta and release candidates</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          </div>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-faint">
            <Download className="mt-0.5 h-3.5 w-3.5 flex-none" />
            Updates are never downloaded until you approve them. Returning to Stable never
            downgrades an installed preview.
          </p>
        </div>
      </div>
    </SettingsGroup>
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
      { name: 'Executables', extensions: ['exe', 'app'] },
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
      <SettingsGroup title="SVN Client" description="SVN executable configuration" resetKeys={['svnClientPath']}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.svnClientPath}
              readOnly
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
      <SettingsGroup title="Working Copy Format" description="Format for new working copies" resetKeys={['workingCopyFormat']}>
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
      <SettingsGroup title="Default Commit Message" description="Pre-filled text for new commits" resetKeys={['defaultCommitMessage']}>
        <textarea
          value={settings.defaultCommitMessage}
          onChange={(e) => onChange('defaultCommitMessage', e.target.value)}
          placeholder="Enter default commit message…"
          className="input h-24 resize-none font-mono text-sm"
        />
      </SettingsGroup>


      {/* File Visibility */}
      <SettingsGroup title="File Visibility" description="Control which files are shown" resetKeys={['showIgnoredFiles', 'showUnversionedFiles']}>
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
      <SettingsGroup title="Auto Refresh" description="Automatically refresh file status" resetKeys={['autoRefreshInterval']}>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            max="3600"
            value={settings.autoRefreshInterval}
            onChange={(e) =>
              onChange('autoRefreshInterval', clampedInteger(e.target.value, 0, 3600, 0))
            }
            className="input w-24 text-center"
          />
          <span className="text-sm text-text-secondary">seconds</span>
          <span className="text-xs text-text-muted">(0 = disabled)</span>
        </div>
      </SettingsGroup>

      {/* Global Ignore Patterns */}
      <SettingsGroup title="Global Ignore Patterns" description="Files/folders to ignore globally" resetKeys={['globalIgnorePatterns']}>
        <div className="space-y-2">
          {settings.globalIgnorePatterns.length === 0 ? (
            <p className="text-sm text-text-muted py-2">No custom ignore patterns</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {settings.globalIgnorePatterns.map((pattern, index) => (
                <span
                  key={`${pattern}:${
                    settings.globalIgnorePatterns
                      .slice(0, index)
                      .filter((candidate) => candidate === pattern).length
                  }`}
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
      <SettingsGroup title="Proxy Settings" description="HTTP proxy for SVN connections" resetKeys={['proxySettings']}>
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
                <label htmlFor="settings-proxy-host" className="text-xs text-text-muted">
                  Host
                </label>
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
                <label htmlFor="settings-proxy-port" className="text-xs text-text-muted">
                  Port
                </label>
                <input
                  id="settings-proxy-port"
                  type="number"
                  value={settings.proxySettings.port}
                  onChange={(e) =>
                    onChangeNested(
                      'proxySettings',
                      'port',
                      clampedInteger(e.target.value, 1, 65535, 8080)
                    )
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
      <SettingsGroup title="Connection" description="Network timeout settings" resetKeys={['connectionTimeout']}>
        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-text-muted" />
          <span className="text-sm text-text-secondary">Timeout:</span>
          <input
            type="number"
            min="5"
            max="300"
            value={settings.connectionTimeout}
            onChange={(e) =>
              onChange('connectionTimeout', clampedInteger(e.target.value, 5, 300, 300))
            }
            className="input w-20 text-center"
          />
          <span className="text-sm text-text-muted">seconds</span>
        </div>
      </SettingsGroup>

      {/* SSL Settings */}
      <SettingsGroup title="SSL/TLS" description="Certificate verification" resetKeys={['sslVerify', 'clientCertificatePath']}>
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

interface DiffMergeSettingsTabProps extends NestedSettingsProps {
  /** `externalToolTemplates` is a top-level setting, not a nested one (#87). */
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function DiffMergeSettingsTab({
  settings,
  onChange,
  onChangeNested,
}: DiffMergeSettingsTabProps) {
  const toolOverrides = settings.diffMerge.externalToolOverrides ?? [];
  const toolOverrideIds = useRef<string[]>([]);
  while (toolOverrideIds.current.length < toolOverrides.length) {
    toolOverrideIds.current.push(crypto.randomUUID());
  }
  toolOverrideIds.current.length = toolOverrides.length;

  const handleBrowseDiffTool = async () => {
    const tool = await window.api.externalTools.register('diff');
    if (tool) {
      onChangeNested('diffMerge', 'externalDiffTool', tool.id);
    }
  };

  const handleBrowseMergeTool = async () => {
    const tool = await window.api.externalTools.register('merge');
    if (tool) {
      onChangeNested('diffMerge', 'externalMergeTool', tool.id);
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
    toolOverrideIds.current.push(crypto.randomUUID());
    onChangeNested('diffMerge', 'externalToolOverrides', [
      ...toolOverrides,
      { extension: '', diffTool: '', mergeTool: '' },
    ]);
  };

  const removeToolOverride = (index: number) => {
    toolOverrideIds.current.splice(index, 1);
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
              readOnly
              placeholder="Leave empty for built-in diff viewer"
              className="input flex-1"
            />
            <button onClick={handleBrowseDiffTool} className="btn btn-secondary">
              <FolderOpen className="w-4 h-4" />
              Register
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
              readOnly
              placeholder="Leave empty for built-in merge tool"
              className="input flex-1"
            />
            <button onClick={handleBrowseMergeTool} className="btn btn-secondary">
              <FolderOpen className="w-4 h-4" />
              Register
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
            <div
              key={toolOverrideIds.current[index]}
              className="grid grid-cols-[96px_1fr_1fr_auto] gap-2 items-center"
            >
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

      {/* Custom tools with argument templates (#87) */}
      <ExternalToolsSettings
        tools={settings.externalToolTemplates ?? []}
        onChange={(tools) => onChange('externalToolTemplates', tools)}
      />

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
              onChangeNested('diffMerge', 'contextLines', clampedInteger(e.target.value, 0, 20, 3))
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
                onChangeNested(
                  'dialogs',
                  'logMessagesPerPage',
                  clampedInteger(e.target.value, 10, 500, 100)
                )
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
                onChangeNested(
                  'dialogs',
                  'maxCachedMessages',
                  clampedInteger(e.target.value, 100, 10000, 1000)
                )
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
              onChangeNested(
                'notifications',
                'monitorPollInterval',
                clampedInteger(e.target.value, 10, 600, 60)
              )
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
  /** `customOpenWithTools` is a top-level setting, not a nested one. */
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function IntegrationSettingsTab({
  settings,
  onChangeNested,
  onOpenShellIntegration,
}: IntegrationSettingsProps) {
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
      {/* Applications for the "Open in" context menu */}
      <SettingsGroup
        title="Open in"
        description="Applications offered when you right-click a file or folder"
        resetKeys={['customOpenWithTools']}
      >
        <OpenWithSettings tools={settings.customOpenWithTools ?? []} />
      </SettingsGroup>

      {/* Shell Integration */}
      <SettingsGroup
        title="Shell Integration"
        description="Configure shell extension, icon overlays, and context menu integration"
      >
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
                  {isLoading
                    ? 'Checking status...'
                    : isRegistered
                      ? 'Registered'
                      : 'Not Registered'}
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
              Advanced Setup…
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
    { value: '#22c55e', label: 'Green' },
    { value: '#14b8a6', label: 'Teal' },
    { value: '#0ea5e9', label: 'Sky' },
  ];

  const highContrastOptions: { value: 'system' | boolean; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: true, label: 'On' },
    { value: false, label: 'Off' },
  ];

  const densityOptions: { value: 'compact' | 'comfortable'; label: string; hint: string }[] = [
    { value: 'comfortable', label: 'Comfortable', hint: 'Roomier rows with standard padding' },
    { value: 'compact', label: 'Compact', hint: 'Tighter rows — more items per screen' },
  ];

  const isPresetAccent = accentColors.some((c) => c.value === settings.accentColor);
  const customAccent = normalizeHexColor(settings.accentColor) ?? '#6366f1';

  return (
    <div className="space-y-6">
      {/* Sidebar Width */}
      <SettingsGroup title="Sidebar Width" description="Width of the navigation sidebar" resetKeys={['sidebarWidth']}>
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
      <SettingsGroup title="Accent Color" description="Primary color for highlights and actions" resetKeys={['accentColor']}>
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
              aria-label={`Accent color ${color.label}`}
              aria-pressed={settings.accentColor === color.value}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input
            type="color"
            value={customAccent}
            onChange={(e) => onChange('accentColor', e.target.value)}
            className="w-8 h-8 rounded-lg border border-border bg-bg-tertiary cursor-pointer p-0.5"
            title="Custom accent color"
            data-testid="accent-custom-color"
          />
          <input
            type="text"
            value={settings.accentColor}
            onChange={(e) => {
              const normalized = normalizeHexColor(e.target.value);
              if (normalized) onChange('accentColor', normalized);
            }}
            placeholder="#6366f1"
            spellCheck={false}
            className="input w-28 font-mono text-xs"
            aria-label="Custom accent color hex value"
            data-testid="accent-custom-hex"
          />
          <span className="text-xs text-text-muted">
            {isPresetAccent ? 'Pick a preset or enter a custom color' : 'Custom color'}
          </span>
        </div>
      </SettingsGroup>

      {/* High Contrast */}
      <SettingsGroup
        title="High Contrast"
        description="Stronger borders, brighter text and distinct status colors"
        resetKeys={['highContrast']}
      >
        <div className="flex gap-2">
          {highContrastOptions.map((opt) => (
            <button
              key={opt.label}
              onClick={() => onChange('highContrast', opt.value)}
              className={`
                flex-1 px-3 py-2 text-sm rounded-md border transition-fast
                ${
                  (settings.highContrast ?? 'system') === opt.value
                    ? 'bg-accent/10 border-accent text-accent'
                    : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted mt-2">
          System follows your operating system's increased-contrast preference
        </p>
      </SettingsGroup>

      {/* Density */}
      <SettingsGroup title="Density" description="Row height and padding across the app" resetKeys={['density']}>
        <div className="flex gap-2">
          {densityOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange('density', opt.value)}
              className={`
                flex-1 px-3 py-2 text-sm rounded-md border transition-fast
                ${
                  (settings.density ?? 'comfortable') === opt.value
                    ? 'bg-accent/10 border-accent text-accent'
                    : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted mt-2">
          {densityOptions.find((d) => d.value === (settings.density ?? 'comfortable'))?.hint}
        </p>
      </SettingsGroup>

      {/* Font Size */}
      <SettingsGroup title="Font Size" description="Base font size for the interface" resetKeys={['fontSize']}>
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

      {/* Font Scale */}
      <SettingsGroup
        title="Zoom"
        description="Scale the whole interface — text, spacing and controls"
        resetKeys={['fontScale']}
      >
        <div className="flex gap-2">
          {FONT_SCALE_STEPS.map((step) => (
            <button
              key={step}
              onClick={() => onChange('fontScale', step)}
              className={`
                flex-1 px-3 py-2 text-sm rounded-md border transition-fast
                ${
                  (settings.fontScale ?? 1) === step
                    ? 'bg-accent/10 border-accent text-accent'
                    : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
                }
              `}
            >
              {Math.round(step * 100)}%
            </button>
          ))}
        </div>
      </SettingsGroup>

      {/* Animation Speed */}
      <SettingsGroup title="Animation Speed" description="UI transition animations" resetKeys={['animationSpeed']}>
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
      <SettingsGroup title="Status Bar" description="Bottom status bar visibility" resetKeys={['showStatusBar']}>
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

      {/* Explorer View */}
      <SettingsGroup
        title="Default Explorer View"
        description="How the file explorer is laid out by default"
        resetKeys={['explorerViewMode']}
      >
        <div className="flex gap-2">
          <button
            onClick={() => onChange('explorerViewMode', 'miller')}
            className={`flex-1 px-3 py-2 text-sm rounded-md border transition-fast ${
              settings.explorerViewMode === 'miller'
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
            }`}
          >
            Columns
          </button>
          <button
            onClick={() => onChange('explorerViewMode', 'list')}
            className={`flex-1 px-3 py-2 text-sm rounded-md border transition-fast ${
              settings.explorerViewMode === 'list'
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-focus'
            }`}
          >
            List
          </button>
        </div>
        <p className="text-xs text-text-muted mt-2">
          {settings.explorerViewMode === 'miller'
            ? 'Finder-style Miller columns — best for deep, nested trees'
            : 'Classic single-column list with sortable columns'}
        </p>
      </SettingsGroup>

      {/* File List Height */}
      <SettingsGroup title="File List Height" description="How file list fills available space" resetKeys={['fileListHeight']}>
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
      <SettingsGroup title="Compact Mode" description="Reduce file row height" resetKeys={['compactFileRows']}>
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
      <SettingsGroup title="File Thumbnails" description="Show image previews in file list" resetKeys={['showThumbnails']}>
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
      <SettingsGroup title="Folder Sizes" description="Calculate folder sizes in file list" resetKeys={['showFolderSizes']}>
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
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
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

/** Human-readable explanation for a failed credential verification probe. */
export function getCredentialVerifyFailureCopy(result: SvnCredentialVerifyResult): string {
  const detail = result.message ? ` (${result.message})` : '';
  switch (result.reason) {
    case 'auth':
      return `The server rejected these credentials. Check the username and password.${detail}`;
    case 'network':
      return `The repository could not be reached, so credentials were not checked.${detail}`;
    case 'ssl':
      return `The server certificate could not be trusted. Configure it in the SVN tab and retry.${detail}`;
    default:
      return `Verification failed.${detail}`;
  }
}

export function AuthSettings({ isOpen, settings, onChange }: AuthSettingsProps) {
  const [credentials, setCredentials] = useState<AuthListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEncryptionAvailable, setIsEncryptionAvailable] = useState<boolean | null>(null);
  const [editingRealm, setEditingRealm] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'win32' | 'darwin' | 'linux' | undefined>();
  const [isAddingCredential, setIsAddingCredential] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [isSavingNewCredential, setIsSavingNewCredential] = useState(false);
  const [revealed, setRevealed] = useState<{ realm: string; password: string } | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{
    realm: string;
    state: 'verifying' | 'ok' | 'failed';
    message?: string;
  } | null>(null);
  const [knownRepositoryUrls, setKnownRepositoryUrls] = useState<string[]>([]);
  const [nativeAuthEntries, setNativeAuthEntries] = useState<SvnNativeAuthEntry[] | null>(null);
  const sshSettings = settings.sshSettings ?? {
    sshClientPath: '',
    useAgent: true,
    keys: [],
  };

  useEffect(() => {
    if (!isOpen) return;

    void window.api.app
      ?.getPlatform?.()
      .then(setPlatform)
      .catch(() => setPlatform(undefined));

    // Supporting lookups are best-effort: URL suggestions from monitored
    // working copies and the native Subversion cache listing (which includes
    // credentials written by TortoiseSVN) both enrich the panel but must not
    // block the core credential list when unavailable.
    const loadSupportingData = async () => {
      try {
        const copies = (await window.api.monitor?.getWorkingCopies?.()) ?? [];
        const urls = Array.from(
          new Set(
            copies
              .map((copy) => copy.url?.trim())
              .filter((url): url is string => Boolean(url))
          )
        );
        setKnownRepositoryUrls(urls);
      } catch {
        setKnownRepositoryUrls([]);
      }
      try {
        const entries = await window.api.svn?.nativeAuth?.list?.();
        setNativeAuthEntries(Array.isArray(entries) ? entries : []);
      } catch {
        setNativeAuthEntries([]);
      }
    };
    void loadSupportingData();

    const loadCredentials = async () => {
      setIsLoading(true);
      setRevealed(null);
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
    setCredentialError(null);
    try {
      await window.api.auth.delete(realm);
      const list = await window.api.auth.list();
      setCredentials(list);
      setRevealed(null);
      if (editingRealm === realm) {
        setEditingRealm(null);
        setEditUsername('');
        setEditPassword('');
      }
    } catch {
      setCredentialError('Could not remove the saved credential.');
    }
  };

  const handleClearAll = async () => {
    setCredentialError(null);
    try {
      await window.api.auth.clear();
      setCredentials([]);
    } catch {
      setCredentialError('Could not clear saved credentials.');
    }
  };

  const handleStartEdit = (credential: AuthListEntry) => {
    setEditingRealm(credential.realm);
    setEditUsername(credential.username);
    setEditPassword('');
  };

  const handleReveal = async (realm: string) => {
    // Toggle back to hidden without another IPC round-trip.
    if (revealed?.realm === realm) {
      setRevealed(null);
      return;
    }
    setIsRevealing(true);
    setCredentialError(null);
    try {
      const result = await window.api.auth.reveal(realm);
      setRevealed({ realm, password: result.password });
    } catch {
      setCredentialError('Could not reveal the saved password.');
    } finally {
      setIsRevealing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingRealm(null);
    setEditUsername('');
    setEditPassword('');
  };

  const handleSaveEdit = async () => {
    if (!editingRealm || !editUsername.trim() || !editPassword) return;

    setIsSavingEdit(true);
    setCredentialError(null);
    try {
      await window.api.auth.beginSession({
        realm: editingRealm,
        username: editUsername.trim(),
        password: editPassword,
        persistence: 'stored',
      });
      const list = await window.api.auth.list();
      setCredentials(list);
      handleCancelEdit();
    } catch {
      setCredentialError('Could not update the saved credential.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const resetAddForm = () => {
    setIsAddingCredential(false);
    setAddUrl('');
    setAddUsername('');
    setAddPassword('');
  };

  const startAddCredential = () => {
    setCredentialError(null);
    setVerifyStatus(null);
    setIsAddingCredential(true);
    if (!addUrl && knownRepositoryUrls.length > 0) {
      setAddUrl(knownRepositoryUrls[0]);
    }
  };

  /**
   * Probe the just-stored credentials against their repository so the user
   * learns immediately whether commits will succeed instead of discovering it
   * at the next sync. Runs in the background: the credential is saved either
   * way and the outcome is reported as an inline banner.
   */
  const verifySavedCredential = async (realm: string, username: string, password: string) => {
    try {
      const result = await window.api.svn?.verifyCredentials?.(realm, username, password);
      if (!result) return;
      setVerifyStatus(
        result.ok
          ? { realm, state: 'ok' }
          : { realm, state: 'failed', message: getCredentialVerifyFailureCopy(result) }
      );
    } catch {
      setVerifyStatus({ realm, state: 'failed', message: 'Verification could not be started.' });
    }
  };

  const handleSaveNewCredential = async () => {
    const realm = addUrl.trim();
    const username = addUsername.trim();
    const password = addPassword;
    if (!realm || !username || !password) return;

    setIsSavingNewCredential(true);
    setCredentialError(null);
    try {
      await window.api.auth.beginSession({
        realm,
        username,
        password,
        persistence: 'stored',
      });
      const list = await window.api.auth.list();
      setCredentials(list);
      resetAddForm();
      setVerifyStatus({ realm, state: 'verifying' });
      void verifySavedCredential(realm, username, password);
    } catch {
      setCredentialError('Could not save the new credential.');
    } finally {
      setIsSavingNewCredential(false);
    }
  };

  const handleRemoveNativeAuthEntry = async (realm: string) => {
    setCredentialError(null);
    try {
      await window.api.svn?.nativeAuth?.remove?.([realm]);
      setNativeAuthEntries((entries) =>
        entries ? entries.filter((entry) => entry.realm !== realm) : entries
      );
    } catch {
      setCredentialError('Could not remove the cached Subversion credential.');
    }
  };

  const handleBrowseSshClient = async () => {
    const path = await window.api.dialog.openFile([
      { name: 'SSH clients', extensions: ['exe', 'cmd', 'bat', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (path) {
      onChange('sshSettings', { ...sshSettings, sshClientPath: path });
    }
  };

  const handleAddSshKey = async () => {
    const privateKeyPath = await window.api.dialog.openFile([
      { name: 'SSH private keys', extensions: ['pem', 'key', 'ppk'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (!privateKeyPath) return;

    const hostPattern = await promptAppInput({
      title: 'SSH key host',
      message: 'Host pattern for this key (for example svn.example.com or *.example.com).',
      placeholder: '*.example.com',
      confirmLabel: 'Add Key',
    });
    if (hostPattern === null) return;

    const name = privateKeyPath.split(/[/\\]/).pop() || 'SSH key';
    onChange('sshSettings', {
      ...sshSettings,
      keys: [
        ...sshSettings.keys,
        {
          id: `ssh-key-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name,
          privateKeyPath,
          keyType: 'unknown',
          hasPassphrase: true,
          ...(hostPattern.trim() ? { hostPattern: hostPattern.trim() } : {}),
          createdAt: Date.now(),
        },
      ],
    });
  };

  return (
    <div className="space-y-6">
      {credentialError && (
        <div
          role="alert"
          className="rounded-lg border border-error/20 bg-error/10 p-3 text-sm text-error"
        >
          {credentialError}
        </div>
      )}
      {isEncryptionAvailable === null ? (
        <div className="p-4 rounded-lg bg-bg-tertiary border border-border">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-text-muted animate-spin" />
            <p className="text-sm text-text-muted">Checking encryption status…</p>
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
        description="Offered automatically for commits, updates, and other repository operations"
      >
        {!isAddingCredential && (
          <div className="flex justify-end mb-3">
            <button type="button" className="btn btn-secondary" onClick={startAddCredential}>
              <Plus className="w-4 h-4" />
              Add Credential
            </button>
          </div>
        )}

        {isAddingCredential && (
          <form
            className="p-3 rounded-lg bg-bg-tertiary border border-border space-y-3 mb-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveNewCredential();
            }}
          >
            <div className="space-y-1">
              <label
                htmlFor="add-credential-url"
                className="text-xs font-medium text-text-secondary"
              >
                Repository URL
              </label>
              <input
                id="add-credential-url"
                type="text"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                list="add-credential-known-urls"
                className="input text-sm"
                placeholder="https://svn.example.com/repo"
                autoComplete="off"
                required
              />
              <datalist id="add-credential-known-urls">
                {knownRepositoryUrls.map((url) => (
                  <option key={url} value={url} />
                ))}
              </datalist>
              <p className="text-xs text-text-faint">
                Use the repository root URL — for a working copy created by TortoiseSVN or another
                client, this lets ShellySVN reuse the same account.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                className="input text-sm"
                placeholder="Username"
                aria-label="New credential username"
                autoComplete="off"
                required
              />
              <input
                type="password"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                className="input text-sm"
                placeholder="Password"
                aria-label="New credential password"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-text-faint">
                Saved encrypted on this device. ShellySVN will verify the credentials against the
                repository afterwards.
              </p>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={resetAddForm}
                  className="btn-icon-sm text-text-muted hover:bg-bg-secondary"
                  aria-label="Cancel adding credential"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  type="submit"
                  disabled={
                    isSavingNewCredential || !addUrl.trim() || !addUsername.trim() || !addPassword
                  }
                  className="btn-icon-sm text-success hover:bg-success/10 disabled:opacity-50"
                  aria-label="Save new credential"
                >
                  {isSavingNewCredential ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </form>
        )}

        {verifyStatus && (
          <div
            role="status"
            aria-live="polite"
            className={`mb-3 rounded-lg border p-3 text-sm ${
              verifyStatus.state === 'ok'
                ? 'bg-success/10 border-success/20 text-success'
                : verifyStatus.state === 'verifying'
                  ? 'bg-bg-tertiary border-border text-text-muted'
                  : 'bg-warning/10 border-warning/20 text-warning'
            }`}
          >
            <div className="flex items-start gap-2">
              {verifyStatus.state === 'ok' ? (
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : verifyStatus.state === 'verifying' ? (
                <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                {verifyStatus.state === 'ok' && (
                  <span>Credentials verified against {verifyStatus.realm}.</span>
                )}
                {verifyStatus.state === 'verifying' && (
                  <span>Verifying credentials against {verifyStatus.realm}…</span>
                )}
                {verifyStatus.state === 'failed' && (
                  <>
                    <span>
                      Saved for {verifyStatus.realm}, but verification did not succeed:{' '}
                      {verifyStatus.message}
                    </span>
                    <span className="block mt-1 text-xs opacity-80">
                      Edit or remove the entry below and try again.
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-8 h-8 text-text-muted mx-auto mb-3 animate-spin" />
            <p className="text-sm text-text-muted">Loading credentials…</p>
          </div>
        ) : credentials.length === 0 ? (
          <div className="py-8 text-center">
            <Key className="w-10 h-10 text-text-faint mx-auto mb-3" />
            <p className="text-sm text-text-muted">No saved credentials</p>
            <p className="text-xs text-text-faint mt-1">
              Add one with your repository URL, or they are saved automatically when you
              authenticate
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
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0 mr-4">
                        <p className="text-sm font-medium text-text truncate">{cred.username}</p>
                        <p className="text-xs text-text-muted truncate">{cred.realm}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all">
                        <button
                          type="button"
                          onClick={() => void handleReveal(cred.realm)}
                          disabled={isRevealing}
                          className="btn-icon-sm text-text-muted hover:bg-bg-secondary disabled:opacity-50"
                          aria-label={
                            revealed?.realm === cred.realm
                              ? `Hide password for ${cred.realm}`
                              : `Reveal password for ${cred.realm}`
                          }
                          data-testid={`reveal-credential-${cred.username}`}
                        >
                          {revealed?.realm === cred.realm ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
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
                    {revealed?.realm === cred.realm && (
                      <div
                        className="mt-2 flex items-center gap-2 rounded-md border border-border bg-bg-secondary px-2.5 py-1.5"
                        data-testid={`revealed-password-${cred.username}`}
                      >
                        <span className="text-xs text-text-faint shrink-0">Password</span>
                        <code className="flex-1 min-w-0 break-all font-mono text-xs text-text select-all">
                          {revealed.password.length > 0 ? (
                            revealed.password
                          ) : (
                            <span className="text-warning">(empty — no password stored)</span>
                          )}
                        </code>
                        <button
                          type="button"
                          onClick={() => void handleReveal(cred.realm)}
                          className="btn-icon-sm text-text-muted hover:bg-bg-secondary shrink-0"
                          aria-label={`Hide shown password for ${cred.username}`}
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
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

      {/* Subversion Native Cache Section (includes TortoiseSVN entries) */}
      {nativeAuthEntries !== null && (
        <SettingsGroup
          title="Subversion Client Cache"
          description="Credentials cached by the native Subversion client, including those saved by TortoiseSVN or the svn command line. Passwords written by other clients cannot be read here — add them above to use them in ShellySVN."
        >
          {nativeAuthEntries.length === 0 ? (
            <p className="text-sm text-text-muted py-2">No native cached credentials found.</p>
          ) : (
            <div className="space-y-2">
              {nativeAuthEntries.map((entry) => (
                <div
                  key={`${entry.kind}:${entry.realm}`}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-bg-tertiary border border-border"
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <p className="text-sm font-medium text-text truncate">
                      {entry.username || entry.realm}
                    </p>
                    <p className="text-xs text-text-muted truncate">{entry.realm}</p>
                    <p className="text-xs text-text-faint">{entry.kind}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveNativeAuthEntry(entry.realm)}
                    className="btn-icon-sm shrink-0 text-error hover:bg-error/10"
                    aria-label={`Delete native cached credential for ${entry.realm}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SettingsGroup>
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
          Current certificate path: {settings.clientCertificatePath || 'Not configured'}
        </div>
      </div>

      {/* SSH Keys Section */}
      <div className="space-y-4 mt-6">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          SSH Keys
        </h4>
        <p className="text-xs text-text-secondary">
          SVN+SSH runs non-interactively. Configure an SSH client and host-specific private keys, or
          use your system ssh-agent for unlocked keys.
        </p>
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-secondary" htmlFor="ssh-client-path">
            SSH client
          </label>
          <div className="flex gap-2">
            <input
              id="ssh-client-path"
              value={sshSettings.sshClientPath}
              onChange={(event) =>
                onChange('sshSettings', {
                  ...sshSettings,
                  sshClientPath: event.target.value,
                })
              }
              className="input flex-1"
              placeholder="ssh (system default)"
            />
            <button type="button" className="btn btn-secondary" onClick={handleBrowseSshClient}>
              Browse
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={sshSettings.useAgent}
            onChange={(event) =>
              onChange('sshSettings', {
                ...sshSettings,
                useAgent: event.target.checked,
              })
            }
          />
          Use ssh-agent or Pageant
        </label>
        <div className="space-y-2">
          {sshSettings.keys.map((sshKey) => (
            <div
              key={sshKey.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-tertiary p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{sshKey.name}</p>
                <p className="truncate text-xs text-text-muted">
                  {sshKey.hostPattern || 'All SVN+SSH hosts'} · {sshKey.privateKeyPath}
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-sm text-error hover:bg-error/10"
                aria-label={`Remove SSH key ${sshKey.name}`}
                onClick={() =>
                  onChange('sshSettings', {
                    ...sshSettings,
                    keys: sshSettings.keys.filter((candidate) => candidate.id !== sshKey.id),
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={handleAddSshKey}>
            <Key className="h-4 w-4" />
            Add SSH Key
          </button>
        </div>
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
  /** Applied when a settings import succeeds (#89). */
  onImportSettings?: (settings: AppSettings) => void;
}

export function AdvancedSettings({
  settings,
  onChange,
  onReset,
  showResetConfirm,
  setShowResetConfirm,
  onImportSettings,
}: AdvancedSettingsProps) {
  const [cacheSize, setCacheSize] = useState<{ size: number; files: number }>({
    size: 0,
    files: 0,
  });
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const [transferMessage, setTransferMessage] = useState<
    { tone: 'ok' | 'warn' | 'error'; text: string } | null
  >(null);

  const handleExport = async () => {
    setIsExchanging(true);
    setTransferMessage(null);
    try {
      const version = await window.api.app.getVersion();
      const result = await exportSettingsToFile(settings, { appVersion: version });
      setTransferMessage(
        result.status === 'failed'
          ? { tone: 'error', text: result.message }
          : { tone: result.status === 'saved' ? 'ok' : 'warn', text: result.message }
      );
    } catch {
      setTransferMessage({ tone: 'error', text: 'Export failed.' });
    } finally {
      setIsExchanging(false);
    }
  };

  const handleImport = async () => {
    setIsExchanging(true);
    setTransferMessage(null);
    try {
      const file = await readSettingsImportFile();
      if (file.status === 'cancelled') {
        setTransferMessage(null);
        return;
      }
      if (file.status === 'failed') {
        setTransferMessage({ tone: 'error', text: file.message });
        return;
      }
      const result = parseSettingsImport(file.content);
      if (!result.ok || !result.settings) {
        setTransferMessage({ tone: 'error', text: result.error ?? 'The file is not a settings export.' });
        return;
      }
      onImportSettings?.(result.settings);
      const notes = [
        result.unknownKeys.length > 0
          ? `skipped ${result.unknownKeys.length} unknown key${result.unknownKeys.length === 1 ? '' : 's'} (${result.unknownKeys.slice(0, 5).join(', ')}${result.unknownKeys.length > 5 ? '…' : ''})`
          : '',
        ...result.warnings,
      ].filter(Boolean);
      setTransferMessage({
        tone: notes.length > 0 ? 'warn' : 'ok',
        text: `Imported ${result.importedKeyCount} settings${notes.length > 0 ? ` — ${notes.join('; ')}` : ''}. Review and Save Changes to apply.`,
      });
    } finally {
      setIsExchanging(false);
    }
  };

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
        window.dispatchEvent(new CustomEvent('svn-cache-cleared'));
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
      <SettingsGroup title="Log Level" description="Diagnostic output verbosity" resetKeys={['logLevel']}>
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
      <SettingsGroup title="Custom Paths" description="Override default locations" resetKeys={['svnConfigPath', 'logCachePath']}>
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
              onChange={(e) =>
                onChange('maxLogCacheSize', clampedInteger(e.target.value, 10, 1000, 100))
              }
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
                Clearing…
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

      {/* Import & Export (#89) */}
      <SettingsGroup
        title="Import & Export"
        description="Back up settings as JSON or restore them on another machine"
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={isExchanging}
              className="btn btn-secondary"
              data-testid="settings-export-button"
            >
              <Download className="w-4 h-4" />
              Export…
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={isExchanging || !onImportSettings}
              className="btn btn-secondary"
              data-testid="settings-import-button"
            >
              <FolderOpen className="w-4 h-4" />
              Import…
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Exports never include saved credentials; proxy passwords are blanked. Imports report
            unknown keys instead of applying them.
          </p>
          {transferMessage && (
            <p
              className={`text-xs ${
                transferMessage.tone === 'ok'
                  ? 'text-success'
                  : transferMessage.tone === 'warn'
                    ? 'text-warning'
                    : 'text-error'
              }`}
              role="status"
              data-testid="settings-transfer-message"
            >
              {transferMessage.text}
            </p>
          )}
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
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

// ============================================
// Convenience Components
// ============================================
