import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
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
import {
  SettingsCheckbox,
  SettingsCheckList,
  SettingsEmpty,
  SettingsField,
  SettingsInlineRow,
  SettingsList,
  SettingsNotice,
  SettingsNumber,
  SettingsSegmented,
  SettingsSelect,
} from './SettingsControls';
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
    <>
      <SettingsGroup title="Theme" description="Color scheme for the whole app" resetKeys={['theme']}>
        <SettingsSegmented
          ariaLabel="Theme"
          size="tile"
          value={settings.theme}
          onChange={(value) => onChange('theme', value)}
          options={[
            { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
            { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
            { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Language and startup"
        description="Display language and what opens when ShellySVN starts"
        resetKeys={['language', 'startupAction']}
      >
        <div className="grid grid-cols-2 gap-4">
          <SettingsField label="Language" htmlFor="settings-language">
            <SettingsSelect
              id="settings-language"
              value={settings.language}
              onChange={(e) => onChange('language', e.target.value)}
            >
              <option value="en">English</option>
              <option value="de">German (Deutsch)</option>
              <option value="fr">French (Francais)</option>
              <option value="es">Spanish (Espanol)</option>
              <option value="ja">Japanese</option>
              <option value="zh">Chinese (Simplified)</option>
            </SettingsSelect>
          </SettingsField>
          <SettingsField label="On startup" htmlFor="settings-startup-action">
            <SettingsSelect
              id="settings-startup-action"
              value={settings.startupAction}
              onChange={(e) => onChange('startupAction', e.target.value as StartupAction)}
            >
              <option value="welcome">Show welcome screen</option>
              <option value="lastRepo">Open last repository</option>
              <option value="empty">Show empty state</option>
            </SettingsSelect>
          </SettingsField>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Default checkout directory"
        description="Where new checkouts are saved. Leave empty to choose each time."
        resetKeys={['defaultCheckoutDirectory']}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.defaultCheckoutDirectory}
            onChange={(e) => onChange('defaultCheckoutDirectory', e.target.value)}
            placeholder="Ask each time"
            className="input flex-1 font-mono text-12"
            aria-label="Default checkout directory"
          />
          <button type="button" onClick={handleBrowseCheckoutDir} className="btn btn-secondary">
            <FolderOpen className="h-4 w-4" />
            Browse
          </button>
        </div>
      </SettingsGroup>

      <UpdatesSettings settings={settings} onChange={onChange} />

      <SettingsGroup
        title="Behavior"
        description="Window handling and confirmations"
        resetKeys={['singleInstanceMode', 'confirmDestructiveOps']}
      >
        <SettingsCheckList>
          <SettingsCheckbox
            checked={settings.singleInstanceMode}
            onChange={(checked) => onChange('singleInstanceMode', checked)}
            label="Allow only one instance"
            hint="Files and links open in the existing window."
          />
          <SettingsCheckbox
            checked={settings.confirmDestructiveOps}
            onChange={(checked) => onChange('confirmDestructiveOps', checked)}
            label="Confirm destructive operations"
            hint="Ask before revert, delete and other changes that discard work."
          />
        </SettingsCheckList>
      </SettingsGroup>

      <SettingsGroup title="Tutorial" description="Walk through the main SVN workflows again">
        <button
          type="button"
          onClick={() => {
            // Handled by the tutorial host component.
            window.dispatchEvent(new CustomEvent('tutorial:restart'));
          }}
          className="btn btn-secondary"
        >
          <Play className="h-4 w-4" />
          Restart tutorial
        </button>
      </SettingsGroup>
    </>
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
        <div className="settings-card flex items-center justify-between gap-4 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-13 font-medium text-text">
              ShellySVN <span className="font-mono text-12">{version}</span>
            </p>
            <p
              className={`mt-0.5 text-12 ${state?.status === 'error' ? 'text-error' : 'text-text-muted'}`}
              role={state?.status === 'error' ? 'alert' : undefined}
            >
              {statusText}
            </p>
          </div>
          {state?.status === 'unsupported' ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm shrink-0"
              onClick={() => void window.api.app.openExternal(state.manualDownloadUrl)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Downloads
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm shrink-0"
              disabled={state?.status === 'checking' || state?.status === 'downloading'}
              onClick={() => void check()}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${state?.status === 'checking' ? 'animate-spin' : ''}`}
              />
              Check now
            </button>
          )}
        </div>

        <SettingsCheckbox
          checked={settings.checkUpdatesOnStartup}
          onChange={(checked) => onChange('checkUpdatesOnStartup', checked)}
          label="Check automatically at startup and every six hours"
        />

        <SettingsField
          label="Release channel"
          htmlFor="update-channel"
          hint={
            <span className="flex items-start gap-1.5">
              <Download className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              Updates download only after you approve them. Switching back to Stable never
              downgrades an installed preview.
            </span>
          }
        >
          <SettingsSelect
            id="update-channel"
            value={settings.updateChannel}
            onChange={(event) =>
              onChange('updateChannel', event.target.value as AppSettings['updateChannel'])
            }
          >
            <option value="stable">Stable (recommended)</option>
            <option value="preview">Preview (beta and release candidates)</option>
          </SettingsSelect>
        </SettingsField>
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
    <>
      <SettingsGroup
        title="SVN client"
        description="Executable used for every SVN operation"
        resetKeys={['svnClientPath']}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.svnClientPath}
            readOnly
            placeholder="Bundled SVN 1.14.x client"
            className="input flex-1 font-mono text-12"
            aria-label="SVN executable path"
          />
          <button type="button" onClick={handleBrowseSvnPath} className="btn btn-secondary">
            <FolderOpen className="h-4 w-4" />
            Browse
          </button>
        </div>
        <p className="settings-hint mt-1.5">Leave empty to use the bundled SVN 1.14.x client.</p>
      </SettingsGroup>

      <SettingsGroup
        title="Working copy format"
        description="Format used when creating new working copies"
        resetKeys={['workingCopyFormat']}
      >
        <SettingsSelect
          aria-label="Working copy format"
          value={settings.workingCopyFormat}
          onChange={(e) => onChange('workingCopyFormat', e.target.value as WorkingCopyFormat)}
        >
          <option value="1.8">1.8 (compatible with SVN 1.8+)</option>
          <option value="1.9">1.9 (compatible with SVN 1.9+)</option>
          <option value="1.10">1.10 (compatible with SVN 1.10+)</option>
          <option value="1.11">1.11 (compatible with SVN 1.11+)</option>
          <option value="1.12">1.12 (compatible with SVN 1.12+)</option>
          <option value="1.13">1.13 (compatible with SVN 1.13+)</option>
          <option value="1.14">1.14 (latest, SVN 1.14+)</option>
        </SettingsSelect>
      </SettingsGroup>

      <SettingsGroup
        title="Default commit message"
        description="Text pre-filled in every new commit"
        resetKeys={['defaultCommitMessage']}
      >
        <textarea
          value={settings.defaultCommitMessage}
          onChange={(e) => onChange('defaultCommitMessage', e.target.value)}
          placeholder="Enter default commit message…"
          className="input h-24 resize-none font-mono text-12"
          aria-label="Default commit message"
        />
      </SettingsGroup>

      <SettingsGroup
        title="File visibility"
        description="Which files appear in file lists"
        resetKeys={['showIgnoredFiles', 'showUnversionedFiles']}
      >
        <SettingsCheckList>
          <SettingsCheckbox
            checked={settings.showIgnoredFiles}
            onChange={(checked) => onChange('showIgnoredFiles', checked)}
            label="Show ignored files"
          />
          <SettingsCheckbox
            checked={settings.showUnversionedFiles}
            onChange={(checked) => onChange('showUnversionedFiles', checked)}
            label="Show unversioned files"
          />
        </SettingsCheckList>
      </SettingsGroup>

      <SettingsGroup
        title="Auto refresh"
        description="How often file status refreshes on its own"
        resetKeys={['autoRefreshInterval']}
      >
        <SettingsInlineRow label="Refresh interval" htmlFor="settings-auto-refresh" hint="0 turns automatic refresh off.">
          <SettingsNumber
            id="settings-auto-refresh"
            min={0}
            max={3600}
            value={settings.autoRefreshInterval}
            onValueChange={(raw) => onChange('autoRefreshInterval', clampedInteger(raw, 0, 3600, 0))}
            unit="seconds"
          />
        </SettingsInlineRow>
      </SettingsGroup>

      <SettingsGroup
        title="Global ignore patterns"
        description="Files and folders SVN ignores in every working copy"
        resetKeys={['globalIgnorePatterns']}
        actions={
          <button type="button" onClick={handleAddIgnorePattern} className="btn btn-secondary btn-sm">
            <Plus className="h-3.5 w-3.5" />
            Add pattern
          </button>
        }
      >
        {settings.globalIgnorePatterns.length === 0 ? (
          <SettingsEmpty title="No custom ignore patterns" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {settings.globalIgnorePatterns.map((pattern, index) => (
              <span
                key={`${pattern}:${
                  settings.globalIgnorePatterns
                    .slice(0, index)
                    .filter((candidate) => candidate === pattern).length
                }`}
                className="inline-flex items-center gap-1 rounded-5 border border-border bg-bg py-0.5 pl-2 pr-1 font-mono text-12 text-text"
              >
                {pattern}
                <button
                  type="button"
                  onClick={() => handleRemoveIgnorePattern(index)}
                  className="rounded-4 p-0.5 text-text-muted hover:bg-bg-tertiary hover:text-error"
                  aria-label={`Remove ignore pattern ${pattern}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Proxy"
        description="HTTP proxy for SVN connections"
        resetKeys={['proxySettings']}
      >
        <SettingsCheckbox
          checked={settings.proxySettings.enabled}
          onChange={(checked) => onChangeNested('proxySettings', 'enabled', checked)}
          label="Use a proxy server"
        />

        {settings.proxySettings.enabled && (
          <div className="settings-inset mt-3 grid grid-cols-[1fr_120px] gap-3 p-3">
            <SettingsField label="Host" htmlFor="settings-proxy-host">
              <input
                id="settings-proxy-host"
                type="text"
                value={settings.proxySettings.host}
                onChange={(e) => onChangeNested('proxySettings', 'host', e.target.value)}
                placeholder="proxy.example.com"
                className="input font-mono text-12"
              />
            </SettingsField>
            <SettingsField label="Port" htmlFor="settings-proxy-port">
              <input
                id="settings-proxy-port"
                type="number"
                value={settings.proxySettings.port}
                onChange={(e) =>
                  onChangeNested('proxySettings', 'port', clampedInteger(e.target.value, 1, 65535, 8080))
                }
                className="input tabular-nums"
              />
            </SettingsField>
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <SettingsField label="Username (optional)" htmlFor="settings-proxy-username">
                <input
                  id="settings-proxy-username"
                  type="text"
                  value={settings.proxySettings.username}
                  onChange={(e) => onChangeNested('proxySettings', 'username', e.target.value)}
                  className="input"
                />
              </SettingsField>
              <SettingsField label="Password (optional)" htmlFor="settings-proxy-password">
                <input
                  id="settings-proxy-password"
                  type="password"
                  value={settings.proxySettings.password}
                  onChange={(e) => onChangeNested('proxySettings', 'password', e.target.value)}
                  className="input"
                />
              </SettingsField>
            </div>
            <div className="col-span-2">
              <SettingsCheckbox
                checked={settings.proxySettings.bypassForLocal}
                onChange={(checked) => onChangeNested('proxySettings', 'bypassForLocal', checked)}
                label="Bypass for local addresses"
              />
            </div>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Connection"
        description="Network timeout for repository requests"
        resetKeys={['connectionTimeout']}
      >
        <SettingsInlineRow label="Timeout" htmlFor="settings-connection-timeout" hint="Between 5 and 300 seconds.">
          <SettingsNumber
            id="settings-connection-timeout"
            min={5}
            max={300}
            value={settings.connectionTimeout}
            onValueChange={(raw) => onChange('connectionTimeout', clampedInteger(raw, 5, 300, 300))}
            unit="seconds"
          />
        </SettingsInlineRow>
      </SettingsGroup>

      <SettingsGroup
        title="SSL/TLS"
        description="Server certificate checks and client certificate"
        resetKeys={['sslVerify', 'clientCertificatePath']}
      >
        <SettingsCheckbox
          checked={settings.sslVerify}
          onChange={(checked) => onChange('sslVerify', checked)}
          label="Verify SSL certificates"
          hint="Turn off only for servers you trust that use self-signed certificates."
        />

        <SettingsField
          className="mt-3"
          label="Client certificate (optional)"
          htmlFor="settings-client-certificate"
        >
          <div className="flex gap-2">
            <input
              id="settings-client-certificate"
              type="text"
              value={settings.clientCertificatePath}
              onChange={(e) => onChange('clientCertificatePath', e.target.value)}
              placeholder="Path to a .p12, .pem, .crt or .cer file"
              className="input flex-1 font-mono text-12"
            />
            <button type="button" onClick={handleBrowseCertPath} className="btn btn-secondary">
              Browse
            </button>
          </div>
        </SettingsField>
      </SettingsGroup>
    </>
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
    <>
      <SettingsGroup
        title="External diff tool"
        description="Application that opens when you view differences"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.diffMerge.externalDiffTool}
            readOnly
            placeholder="Built-in diff viewer"
            className="input flex-1"
            aria-label="External diff tool"
          />
          <button type="button" onClick={handleBrowseDiffTool} className="btn btn-secondary">
            <FolderOpen className="h-4 w-4" />
            Register
          </button>
        </div>
        <p className="settings-hint mt-1.5">
          Works with Beyond Compare, KDiff3, P4Merge, WinMerge and TortoiseMerge.
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="External merge tool"
        description="Application used for three-way merges during conflict resolution"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.diffMerge.externalMergeTool}
            readOnly
            placeholder="Built-in merge tool"
            className="input flex-1"
            aria-label="External merge tool"
          />
          <button type="button" onClick={handleBrowseMergeTool} className="btn btn-secondary">
            <FolderOpen className="h-4 w-4" />
            Register
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Per-extension tools"
        description="Use a different diff or merge tool for specific file extensions"
        actions={
          <button type="button" onClick={addToolOverride} className="btn btn-secondary btn-sm">
            <Plus className="h-3.5 w-3.5" />
            Add override
          </button>
        }
      >
        {toolOverrides.length === 0 ? (
          <SettingsEmpty title="No extension overrides" />
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[96px_1fr_1fr_28px] gap-2 px-0.5">
              <span className="settings-label">Extension</span>
              <span className="settings-label">Diff tool</span>
              <span className="settings-label">Merge tool</span>
              <span aria-hidden="true" />
            </div>
            {toolOverrides.map((override, index) => (
              <div
                key={toolOverrideIds.current[index]}
                className="grid grid-cols-[96px_1fr_1fr_28px] items-center gap-2"
              >
                <input
                  type="text"
                  value={override.extension}
                  onChange={(e) => updateToolOverride(index, 'extension', e.target.value)}
                  placeholder="ts"
                  className="input font-mono text-12"
                  aria-label={`Extension override ${index + 1}`}
                />
                <input
                  type="text"
                  value={override.diffTool}
                  onChange={(e) => updateToolOverride(index, 'diffTool', e.target.value)}
                  placeholder="Default"
                  className="input"
                  aria-label={`Diff tool override ${index + 1}`}
                />
                <input
                  type="text"
                  value={override.mergeTool}
                  onChange={(e) => updateToolOverride(index, 'mergeTool', e.target.value)}
                  placeholder="Default"
                  className="input"
                  aria-label={`Merge tool override ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeToolOverride(index)}
                  className="btn-icon-sm text-text-muted hover:bg-error/10 hover:text-error"
                  aria-label={`Remove tool override ${index + 1}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>

      {/* Custom tools with argument templates (#87) */}
      <ExternalToolsSettings
        tools={settings.externalToolTemplates ?? []}
        onChange={(tools) => onChange('externalToolTemplates', tools)}
      />

      <SettingsGroup title="Diff behavior" description="Defaults for the built-in diff viewer">
        <SettingsCheckList>
          <SettingsCheckbox
            checked={settings.diffMerge.diffOnDoubleClick}
            onChange={(checked) => onChangeNested('diffMerge', 'diffOnDoubleClick', checked)}
            label="Show diff on double-click"
          />
          <SettingsCheckbox
            checked={settings.diffMerge.ignoreWhitespace}
            onChange={(checked) => onChangeNested('diffMerge', 'ignoreWhitespace', checked)}
            label="Ignore whitespace changes by default"
          />
          <SettingsCheckbox
            checked={settings.diffMerge.ignoreEol}
            onChange={(checked) => onChangeNested('diffMerge', 'ignoreEol', checked)}
            label="Ignore end-of-line differences"
          />
        </SettingsCheckList>
      </SettingsGroup>

      <SettingsGroup title="Unified diff" description="Output format for unified diffs">
        <SettingsInlineRow
          label="Context lines"
          htmlFor="settings-context-lines"
          hint="Unchanged lines shown around each change."
        >
          <SettingsNumber
            id="settings-context-lines"
            min={0}
            max={20}
            value={settings.diffMerge.contextLines}
            onValueChange={(raw) =>
              onChangeNested('diffMerge', 'contextLines', clampedInteger(raw, 0, 20, 3))
            }
            unit="lines"
          />
        </SettingsInlineRow>
      </SettingsGroup>
    </>
  );
}

// ============================================
// Dialogs Settings Tab
// ============================================

export function DialogsSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
  const commitColumns = ['status', 'path', 'extension', 'size', 'modified'];
  return (
    <>
      <SettingsGroup title="Window behavior" description="What dialogs remember between uses">
        <SettingsCheckList>
          <SettingsCheckbox
            checked={settings.dialogs.rememberPositions}
            onChange={(checked) => onChangeNested('dialogs', 'rememberPositions', checked)}
            label="Remember dialog positions"
          />
          <SettingsCheckbox
            checked={settings.dialogs.rememberSizes}
            onChange={(checked) => onChangeNested('dialogs', 'rememberSizes', checked)}
            label="Remember dialog sizes"
          />
        </SettingsCheckList>
      </SettingsGroup>

      <SettingsGroup title="Commit dialog" description="Columns shown in the commit file list">
        <div className="grid grid-cols-3 gap-x-4" role="group" aria-label="Visible columns">
          {commitColumns.map((col) => (
            <SettingsCheckbox
              key={col}
              checked={settings.dialogs.commitDialogColumns.includes(col)}
              onChange={(checked) => {
                const cols = settings.dialogs.commitDialogColumns;
                onChangeNested(
                  'dialogs',
                  'commitDialogColumns',
                  checked ? [...cols, col] : cols.filter((c) => c !== col)
                );
              }}
              label={col.charAt(0).toUpperCase() + col.slice(1)}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Log dialog"
        description="Paging and offline cache for revision history"
      >
        <div className="divide-y divide-border-muted">
          <SettingsInlineRow label="Messages per page" htmlFor="settings-log-per-page">
            <SettingsNumber
              id="settings-log-per-page"
              min={10}
              max={500}
              value={settings.dialogs.logMessagesPerPage}
              onValueChange={(raw) =>
                onChangeNested('dialogs', 'logMessagesPerPage', clampedInteger(raw, 10, 500, 100))
              }
            />
          </SettingsInlineRow>
          <SettingsInlineRow
            label="Maximum cached messages"
            htmlFor="settings-log-max-cached"
            hint="Cached messages keep history readable while offline."
          >
            <SettingsNumber
              id="settings-log-max-cached"
              min={100}
              max={10000}
              step={100}
              value={settings.dialogs.maxCachedMessages}
              onValueChange={(raw) =>
                onChangeNested(
                  'dialogs',
                  'maxCachedMessages',
                  clampedInteger(raw, 100, 10000, 1000)
                )
              }
            />
          </SettingsInlineRow>
        </div>
      </SettingsGroup>
    </>
  );
}

// ============================================
// Notifications Settings Tab
// ============================================

export function NotificationsSettingsTab({ settings, onChangeNested }: NestedSettingsProps) {
  return (
    <>
      <SettingsGroup title="Alerts" description="How ShellySVN tells you an operation finished">
        <SettingsCheckList>
          <SettingsCheckbox
            checked={settings.notifications.enableSounds}
            onChange={(checked) => onChangeNested('notifications', 'enableSounds', checked)}
            label="Play sounds"
            hint="A short sound when an operation completes or fails."
          />
          <SettingsCheckbox
            checked={settings.notifications.enableSystemNotifications}
            onChange={(checked) =>
              onChangeNested('notifications', 'enableSystemNotifications', checked)
            }
            label="Show system notifications"
            hint="Desktop notifications for completed operations."
          />
        </SettingsCheckList>
      </SettingsGroup>

      <SettingsGroup title="Hook scripts" description="Client-side hook behavior">
        <SettingsCheckbox
          checked={settings.notifications.showHookOutput}
          onChange={(checked) => onChangeNested('notifications', 'showHookOutput', checked)}
          label="Show output from hook scripts"
        />
      </SettingsGroup>

      <SettingsGroup
        title="Working copy monitor"
        description="Background status checks for monitored working copies"
      >
        <SettingsInlineRow
          label="Poll interval"
          htmlFor="settings-monitor-interval"
          hint="How often monitored working copies are checked for changes."
        >
          <SettingsNumber
            id="settings-monitor-interval"
            min={10}
            max={600}
            value={settings.notifications.monitorPollInterval}
            onValueChange={(raw) =>
              onChangeNested('notifications', 'monitorPollInterval', clampedInteger(raw, 10, 600, 60))
            }
            unit="seconds"
          />
        </SettingsInlineRow>
      </SettingsGroup>
    </>
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
    { id: 'log', label: 'Show log' },
    { id: 'diff', label: 'Diff' },
    { id: 'checkout', label: 'Checkout' },
    { id: 'export', label: 'Export' },
    { id: 'add', label: 'Add' },
    { id: 'delete', label: 'Delete' },
    { id: 'lock', label: 'Lock/unlock' },
    { id: 'branch', label: 'Branch/tag' },
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
    <>
      <SettingsGroup
        title="Open in"
        description="Applications offered when you right-click a file or folder"
        resetKeys={['customOpenWithTools']}
      >
        <OpenWithSettings tools={settings.customOpenWithTools ?? []} />
      </SettingsGroup>

      <SettingsGroup
        title="Shell integration"
        description="Explorer and Finder extension for SVN commands outside the app"
      >
        <div className="space-y-3">
          <div className="settings-card flex items-center justify-between gap-4 px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {isLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" />
              ) : isRegistered ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-text-muted" />
              )}
              <div className="min-w-0">
                <p className="text-13 font-medium text-text">
                  {isLoading ? 'Checking status…' : isRegistered ? 'Registered' : 'Not registered'}
                </p>
                <p className="text-12 text-text-muted">
                  {isRegistered
                    ? 'The shell extension is active.'
                    : 'Register to add SVN commands to the system context menu.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={isRegistered ? handleUnregister : handleRegister}
              disabled={isRegistering || isLoading}
              className={`btn btn-sm shrink-0 ${isRegistered ? 'btn-secondary' : 'btn-primary'}`}
            >
              {isRegistering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isRegistered ? (
                <FolderSync className="h-3.5 w-3.5" />
              ) : (
                <Shield className="h-3.5 w-3.5" />
              )}
              {isRegistering ? 'Please wait…' : isRegistered ? 'Unregister' : 'Register'}
            </button>
          </div>

          {error && (
            <SettingsNotice tone="error" role="alert">
              {error}
            </SettingsNotice>
          )}

          <SettingsCheckList>
            <SettingsCheckbox
              checked={settings.integration.shellExtensionEnabled}
              onChange={(checked) => onChangeNested('integration', 'shellExtensionEnabled', checked)}
              label="Show in Explorer context menu"
              hint="Adds SVN options to the right-click menu in Explorer or Finder."
            />
            <SettingsCheckbox
              checked={settings.integration.iconOverlaysEnabled}
              onChange={(checked) => onChangeNested('integration', 'iconOverlaysEnabled', checked)}
              label="Show status icon overlays"
              hint="Badges file icons in Explorer or Finder with their SVN status."
            />
          </SettingsCheckList>

          <button type="button" onClick={onOpenShellIntegration} className="btn btn-secondary btn-sm">
            <Wrench className="h-3.5 w-3.5" />
            Advanced setup…
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Context menu items"
        description="Commands listed in the shell context menu"
      >
        <div className="grid grid-cols-3 gap-x-4" role="group" aria-label="Context menu items">
          {contextMenuOptions.map((opt) => (
            <SettingsCheckbox
              key={opt.id}
              checked={settings.integration.contextMenuItems.includes(opt.id)}
              onChange={(checked) => {
                const items = settings.integration.contextMenuItems;
                onChangeNested(
                  'integration',
                  'contextMenuItems',
                  checked ? [...items, opt.id] : items.filter((i) => i !== opt.id)
                );
              }}
              label={opt.label}
            />
          ))}
        </div>
      </SettingsGroup>
    </>
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
    { value: 'comfortable', label: 'Comfortable', hint: 'Roomier rows with standard padding.' },
    { value: 'compact', label: 'Compact', hint: 'Tighter rows that fit more items on screen.' },
  ];

  const isPresetAccent = accentColors.some((c) => c.value === settings.accentColor);
  const customAccent = normalizeHexColor(settings.accentColor) ?? '#6366f1';

  return (
    <>
      <SettingsGroup
        title="Accent color"
        description="Used for primary actions, selection and focus"
        resetKeys={['accentColor']}
      >
        <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Accent presets">
          {accentColors.map((color) => {
            const selected = settings.accentColor === color.value;
            return (
              <button
                key={color.value}
                type="button"
                onClick={() => onChange('accentColor', color.value)}
                className={`h-6 w-6 rounded-full transition-shadow ${
                  selected
                    ? 'ring-2 ring-text ring-offset-2 ring-offset-bg-secondary'
                    : 'ring-1 ring-inset ring-black/10 hover:ring-2 hover:ring-border-strong hover:ring-offset-2 hover:ring-offset-bg-secondary'
                }`}
                style={{ backgroundColor: color.value }}
                title={color.label}
                aria-label={`Accent color ${color.label}`}
                aria-pressed={selected}
              />
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="color"
            value={customAccent}
            onChange={(e) => onChange('accentColor', e.target.value)}
            className="h-8 w-8 cursor-pointer rounded-md border border-border bg-bg p-0.5"
            title="Custom accent color"
            aria-label="Custom accent color"
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
            className="input w-28 font-mono text-12"
            aria-label="Custom accent color hex value"
            data-testid="accent-custom-hex"
          />
          <span className="text-12 text-text-muted">
            {isPresetAccent ? 'Pick a preset or enter a hex color' : 'Custom color'}
          </span>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="High contrast"
        description="Stronger borders, brighter text and distinct status colors"
        resetKeys={['highContrast']}
      >
        <SettingsSegmented
          ariaLabel="High contrast"
          value={settings.highContrast ?? 'system'}
          onChange={(value) => onChange('highContrast', value)}
          options={highContrastOptions}
        />
        <p className="settings-hint mt-2">
          System follows your operating system's increased-contrast preference.
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="Density"
        description="Row height and padding across the app"
        resetKeys={['density']}
      >
        <SettingsSegmented
          ariaLabel="Density"
          value={settings.density ?? 'comfortable'}
          onChange={(value) => onChange('density', value)}
          options={densityOptions}
        />
        <p className="settings-hint mt-2">
          {densityOptions.find((d) => d.value === (settings.density ?? 'comfortable'))?.hint}
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="Font size"
        description="Base size for interface text"
        resetKeys={['fontSize']}
      >
        <SettingsSegmented
          ariaLabel="Font size"
          value={settings.fontSize}
          onChange={(value) => onChange('fontSize', value)}
          options={fontSizeOptions}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Zoom"
        description="Scale text, spacing and controls together"
        resetKeys={['fontScale']}
      >
        <SettingsSegmented
          ariaLabel="Zoom"
          value={settings.fontScale ?? 1}
          onChange={(value) => onChange('fontScale', value)}
          options={FONT_SCALE_STEPS.map((step) => ({
            value: step,
            label: `${Math.round(step * 100)}%`,
          }))}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Animation speed"
        description="Transitions for panels, menus and dialogs"
        resetKeys={['animationSpeed']}
      >
        <SettingsSegmented
          ariaLabel="Animation speed"
          value={settings.animationSpeed}
          onChange={(value) => onChange('animationSpeed', value)}
          options={[
            { value: 'none', label: 'Minimal' },
            { value: 'fast', label: 'Fast' },
            { value: 'normal', label: 'Normal' },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Sidebar width"
        description="Width of the navigation sidebar"
        resetKeys={['sidebarWidth']}
      >
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="200"
            max="400"
            step="10"
            value={settings.sidebarWidth}
            onChange={(e) => onChange('sidebarWidth', parseInt(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-accent"
            aria-label="Sidebar width"
            aria-valuetext={`${settings.sidebarWidth} pixels`}
          />
          <span className="w-14 text-right font-mono text-12 tabular-nums text-text-secondary">
            {settings.sidebarWidth}px
          </span>
        </div>
        <div className="mt-1 flex justify-between pr-[72px] text-11 text-text-muted">
          <span>Narrow (200px)</span>
          <span>Wide (400px)</span>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Status bar"
        description="Bottom bar with repository and operation status"
        resetKeys={['showStatusBar']}
      >
        <SettingsCheckbox
          checked={settings.showStatusBar}
          onChange={(checked) => onChange('showStatusBar', checked)}
          label="Show status bar"
        />
      </SettingsGroup>

      <SettingsGroup
        title="Default explorer view"
        description="How the file explorer is laid out by default"
        resetKeys={['explorerViewMode']}
      >
        <SettingsSegmented
          ariaLabel="Default explorer view"
          value={settings.explorerViewMode}
          onChange={(value) => onChange('explorerViewMode', value)}
          options={[
            { value: 'miller', label: 'Columns' },
            { value: 'list', label: 'List' },
          ]}
        />
        <p className="settings-hint mt-2">
          {settings.explorerViewMode === 'miller'
            ? 'Finder-style columns, best for deep folder trees.'
            : 'Single-column list with sortable columns.'}
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="File list height"
        description="How the file list uses vertical space"
        resetKeys={['fileListHeight']}
      >
        <SettingsSegmented
          ariaLabel="File list height"
          value={settings.fileListHeight}
          onChange={(value) => onChange('fileListHeight', value)}
          options={[
            { value: 'fill', label: 'Fill space' },
            { value: 'auto', label: 'Compact' },
          ]}
        />
        <p className="settings-hint mt-2">
          {settings.fileListHeight === 'fill'
            ? 'The file list fills all available vertical space.'
            : 'The file list takes only the space its rows need.'}
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="File rows"
        description="Row size and extra details in file lists"
        resetKeys={['compactFileRows', 'showThumbnails', 'showFolderSizes']}
      >
        <SettingsCheckList>
          <SettingsCheckbox
            checked={settings.compactFileRows}
            onChange={(checked) => onChange('compactFileRows', checked)}
            label="Use compact file rows"
          />
          <SettingsCheckbox
            checked={settings.showThumbnails}
            onChange={(checked) => onChange('showThumbnails', checked)}
            label="Show image thumbnails"
            hint="Previews image files in the list. Large folders may load more slowly."
          />
          <SettingsCheckbox
            checked={settings.showFolderSizes}
            onChange={(checked) => onChange('showFolderSizes', checked)}
            label="Show folder sizes"
            hint="Totals the size of each folder. This can be slow for large directories."
          />
        </SettingsCheckList>
      </SettingsGroup>

      <SettingsGroup title="Preview" description="Current text size and accent">
        <div
          className={`settings-card px-4 py-3.5 ${
            settings.fontSize === 'small'
              ? 'text-xs'
              : settings.fontSize === 'large'
                ? 'text-base'
                : 'text-sm'
          }`}
          aria-hidden="true"
        >
          <p className="text-text">Sample text at {settings.fontSize} size</p>
          <p className="mt-0.5 text-text-secondary">Secondary text color</p>
          <span
            className="mt-3 inline-flex rounded-md px-3 py-1 text-sm font-medium text-white"
            style={{ backgroundColor: settings.accentColor }}
          >
            Accent button
          </span>
        </div>
      </SettingsGroup>
    </>
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
    <>
      {credentialError && (
        <SettingsNotice tone="error" role="alert">
          {credentialError}
        </SettingsNotice>
      )}
      {isEncryptionAvailable === null ? (
        <SettingsNotice tone="pending">Checking encryption status…</SettingsNotice>
      ) : isEncryptionAvailable ? (
        <SettingsNotice tone="success" icon={<Shield className="h-4 w-4" aria-hidden="true" />}>
          {getCredentialEncryptionStatusCopy(true, platform)}
        </SettingsNotice>
      ) : (
        <SettingsNotice tone="warning">
          {getCredentialEncryptionStatusCopy(false, platform)}
        </SettingsNotice>
      )}

      <SettingsGroup
        title="Saved credentials"
        description="Offered automatically for commits, updates and other repository operations"
        actions={
          !isAddingCredential ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={startAddCredential}>
              <Plus className="h-3.5 w-3.5" />
              Add credential
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          {isAddingCredential && (
            <form
              className="settings-inset space-y-3 p-3"
              aria-label="Add credential"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveNewCredential();
              }}
            >
              <SettingsField
                label="Repository URL"
                htmlFor="add-credential-url"
                hint="Use the repository root URL. For a working copy created by TortoiseSVN or another client, this lets ShellySVN reuse the same account."
              >
                <input
                  id="add-credential-url"
                  type="text"
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  list="add-credential-known-urls"
                  className="input font-mono text-12"
                  placeholder="https://svn.example.com/repo"
                  autoComplete="off"
                  required
                />
                <datalist id="add-credential-known-urls">
                  {knownRepositoryUrls.map((url) => (
                    <option key={url} value={url} />
                  ))}
                </datalist>
              </SettingsField>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value)}
                  className="input"
                  placeholder="Username"
                  aria-label="New credential username"
                  autoComplete="off"
                  required
                />
                <input
                  type="password"
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  className="input"
                  placeholder="Password"
                  aria-label="New credential password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="settings-hint">
                  Saved encrypted on this device, then checked against the repository.
                </p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={resetAddForm}
                    className="btn btn-ghost btn-sm"
                    aria-label="Cancel adding credential"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSavingNewCredential || !addUrl.trim() || !addUsername.trim() || !addPassword
                    }
                    className="btn btn-primary btn-sm"
                    aria-label="Save new credential"
                  >
                    {isSavingNewCredential ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Save
                  </button>
                </div>
              </div>
            </form>
          )}

          {verifyStatus && (
            <SettingsNotice
              role="status"
              tone={
                verifyStatus.state === 'ok'
                  ? 'success'
                  : verifyStatus.state === 'verifying'
                    ? 'pending'
                    : 'warning'
              }
            >
              {verifyStatus.state === 'ok' && (
                <span className="text-text">Credentials verified against {verifyStatus.realm}.</span>
              )}
              {verifyStatus.state === 'verifying' && (
                <span>Verifying credentials against {verifyStatus.realm}…</span>
              )}
              {verifyStatus.state === 'failed' && (
                <>
                  <span className="text-text">
                    Saved for {verifyStatus.realm}, but verification did not succeed:{' '}
                    {verifyStatus.message}
                  </span>
                  <span className="mt-1 block">Edit or remove the entry below and try again.</span>
                </>
              )}
            </SettingsNotice>
          )}

          {isLoading ? (
            <SettingsEmpty
              icon={<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              title="Loading credentials…"
            />
          ) : credentials.length === 0 ? (
            <SettingsEmpty
              icon={<Key className="h-4 w-4" aria-hidden="true" />}
              title="No saved credentials"
            >
              Add one with your repository URL. Credentials are also saved when you sign in during
              an operation.
            </SettingsEmpty>
          ) : (
            <SettingsList label="Saved credentials">
              {credentials.map((cred) => (
                <li key={cred.realm} className="group px-3 py-2.5">
                  {editingRealm === cred.realm ? (
                    <div className="space-y-2.5">
                      <p className="truncate font-mono text-11 text-text-muted">{cred.realm}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="input"
                          aria-label={`Username for ${cred.realm}`}
                        />
                        <input
                          type="password"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          className="input"
                          placeholder="New password"
                          aria-label={`New password for ${cred.realm}`}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="btn btn-ghost btn-sm"
                          aria-label={`Cancel editing ${cred.realm}`}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={isSavingEdit || !editUsername.trim() || !editPassword}
                          className="btn btn-primary btn-sm"
                          aria-label={`Save credentials for ${cred.realm}`}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-13 font-medium text-text">{cred.username}</p>
                          <p className="truncate font-mono text-11 text-text-muted">{cred.realm}</p>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => void handleReveal(cred.realm)}
                            disabled={isRevealing}
                            className="btn-icon-sm text-text-muted disabled:opacity-50"
                            aria-label={
                              revealed?.realm === cred.realm
                                ? `Hide password for ${cred.realm}`
                                : `Reveal password for ${cred.realm}`
                            }
                            data-testid={`reveal-credential-${cred.username}`}
                          >
                            {revealed?.realm === cred.realm ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartEdit(cred)}
                            className="btn-icon-sm text-text-muted"
                            aria-label={`Edit credentials for ${cred.realm}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemove(cred.realm)}
                            className="btn-icon-sm text-text-muted hover:bg-error/10 hover:text-error"
                            aria-label={`Delete credentials for ${cred.realm}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {revealed?.realm === cred.realm && (
                        <div
                          className="settings-inset mt-2 flex items-center gap-2 px-2.5 py-1.5"
                          data-testid={`revealed-password-${cred.username}`}
                        >
                          <span className="shrink-0 text-11 text-text-muted">Password</span>
                          <code className="min-w-0 flex-1 select-all break-all font-mono text-12 text-text">
                            {revealed.password.length > 0 ? (
                              revealed.password
                            ) : (
                              <span className="text-warning">(empty — no password stored)</span>
                            )}
                          </code>
                          <button
                            type="button"
                            onClick={() => void handleReveal(cred.realm)}
                            className="btn-icon-sm shrink-0 text-text-muted"
                            aria-label={`Hide shown password for ${cred.username}`}
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </SettingsList>
          )}

          {credentials.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClearAll}
                className="btn btn-ghost btn-sm text-error hover:bg-error/10 hover:text-error"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear all credentials
              </button>
            </div>
          )}
        </div>
      </SettingsGroup>

      {/* Subversion native cache (includes TortoiseSVN entries) */}
      {nativeAuthEntries !== null && (
        <SettingsGroup
          title="Subversion client cache"
          description="Credentials cached by the native Subversion client, including TortoiseSVN and the svn command line. ShellySVN cannot read passwords saved by other clients, so add them above to use them here."
        >
          {nativeAuthEntries.length === 0 ? (
            <SettingsEmpty title="No native cached credentials found." />
          ) : (
            <SettingsList label="Subversion client cache">
              {nativeAuthEntries.map((entry) => (
                <li
                  key={`${entry.kind}:${entry.realm}`}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-medium text-text">
                      {entry.username || entry.realm}
                    </p>
                    <p className="truncate font-mono text-11 text-text-muted">
                      <span>{entry.realm}</span>
                      <span className="text-text-faint"> · {entry.kind}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveNativeAuthEntry(entry.realm)}
                    className="btn-icon-sm shrink-0 text-text-muted hover:bg-error/10 hover:text-error"
                    aria-label={`Delete native cached credential for ${entry.realm}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </SettingsList>
          )}
        </SettingsGroup>
      )}

      <SettingsGroup
        title="SSL certificates"
        description="Client certificates are configured in the SVN tab for now"
      >
        <div className="settings-card flex items-center gap-3 px-3.5 py-2.5">
          <Key className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-12 text-text-muted">Current certificate path</p>
            <p className="truncate font-mono text-12 text-text">
              {settings.clientCertificatePath || 'Not configured'}
            </p>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="SSH keys"
        description="SVN+SSH runs without prompts. Choose an SSH client and host-specific keys, or use an agent for unlocked keys."
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddSshKey}>
            <Plus className="h-3.5 w-3.5" />
            Add SSH key
          </button>
        }
      >
        <div className="space-y-3">
          <SettingsField label="SSH client" htmlFor="ssh-client-path">
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
                className="input flex-1 font-mono text-12"
                placeholder="ssh (system default)"
              />
              <button type="button" className="btn btn-secondary" onClick={handleBrowseSshClient}>
                Browse
              </button>
            </div>
          </SettingsField>
          <SettingsCheckbox
            checked={sshSettings.useAgent}
            onChange={(checked) =>
              onChange('sshSettings', {
                ...sshSettings,
                useAgent: checked,
              })
            }
            label="Use ssh-agent or Pageant"
          />
          {sshSettings.keys.length === 0 ? (
            <SettingsEmpty
              icon={<Terminal className="h-4 w-4" aria-hidden="true" />}
              title="No SSH keys added"
            />
          ) : (
            <SettingsList label="SSH keys">
              {sshSettings.keys.map((sshKey) => (
                <li key={sshKey.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-13 font-medium text-text">{sshKey.name}</p>
                    <p className="truncate font-mono text-11 text-text-muted">
                      {sshKey.hostPattern || 'All SVN+SSH hosts'} · {sshKey.privateKeyPath}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-icon-sm shrink-0 text-text-muted hover:bg-error/10 hover:text-error"
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
                </li>
              ))}
            </SettingsList>
          )}
        </div>
      </SettingsGroup>
    </>
  );
}

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
        text: `Imported ${result.importedKeyCount} settings${notes.length > 0 ? ` — ${notes.join('; ')}` : ''}. Review them and save changes to apply.`,
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
    <>
      <SettingsGroup
        title="Log level"
        description="How much diagnostic output ShellySVN writes"
        resetKeys={['logLevel']}
      >
        <SettingsSelect
          aria-label="Log level"
          value={settings.logLevel}
          onChange={(e) => onChange('logLevel', e.target.value as LogLevel)}
        >
          {logLevels.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}: {level.description}
            </option>
          ))}
        </SettingsSelect>
      </SettingsGroup>

      <SettingsGroup
        title="Custom paths"
        description="Override where SVN configuration and the log cache live"
        resetKeys={['svnConfigPath', 'logCachePath']}
      >
        <div className="space-y-3">
          <SettingsField label="SVN config directory" htmlFor="settings-svn-config-path">
            <div className="flex gap-2">
              <input
                id="settings-svn-config-path"
                type="text"
                value={settings.svnConfigPath}
                onChange={(e) => onChange('svnConfigPath', e.target.value)}
                placeholder="Default: ~/.subversion"
                className="input flex-1 font-mono text-12"
              />
              <button type="button" onClick={handleBrowseSvnConfig} className="btn btn-secondary">
                Browse
              </button>
            </div>
          </SettingsField>
          <SettingsField label="Log cache directory" htmlFor="settings-log-cache-path">
            <div className="flex gap-2">
              <input
                id="settings-log-cache-path"
                type="text"
                value={settings.logCachePath}
                onChange={(e) => onChange('logCachePath', e.target.value)}
                placeholder="Default: application data"
                className="input flex-1 font-mono text-12"
              />
              <button type="button" onClick={handleBrowseLogCache} className="btn btn-secondary">
                Browse
              </button>
            </div>
          </SettingsField>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Log cache" description="Cached revision history and application data">
        <div className="space-y-3">
          <div className="settings-card flex items-center justify-between gap-4 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-12 text-text-muted">Current cache</p>
              <p className="font-mono text-13 tabular-nums text-text">
                {formatBytes(cacheSize.size)}{' '}
                <span className="text-text-muted">({cacheSize.files} files)</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={loadCacheSize}
                className="btn-icon-sm"
                title="Refresh cache size"
                aria-label="Refresh cache size"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleClearCache}
                disabled={isClearingCache}
                className="btn btn-secondary btn-sm"
              >
                {isClearingCache ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Clearing…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear cache
                  </>
                )}
              </button>
            </div>
          </div>

          <SettingsInlineRow
            label="Maximum cache size"
            htmlFor="settings-max-log-cache"
            hint="Clearing removes temporary files, cached repository data and the application cache."
          >
            <SettingsNumber
              id="settings-max-log-cache"
              min={10}
              max={1000}
              step={10}
              value={settings.maxLogCacheSize}
              onValueChange={(raw) =>
                onChange('maxLogCacheSize', clampedInteger(raw, 10, 1000, 100))
              }
              unit="MB"
            />
          </SettingsInlineRow>

          {cacheCleared && (
            <SettingsNotice tone="success" role="status">
              <span className="text-text">Cache cleared.</span>
            </SettingsNotice>
          )}

          {cacheError && (
            <SettingsNotice tone="error" role="alert">
              Failed to clear cache: {cacheError}
            </SettingsNotice>
          )}
        </div>
      </SettingsGroup>

      {/* Import & Export (#89) */}
      <SettingsGroup
        title="Import & export"
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
              <Download className="h-4 w-4" />
              Export…
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={isExchanging || !onImportSettings}
              className="btn btn-secondary"
              data-testid="settings-import-button"
            >
              <FolderOpen className="h-4 w-4" />
              Import…
            </button>
          </div>
          <p className="settings-hint">
            Exports never include saved credentials, and proxy passwords are blanked. Imports list
            unknown keys instead of applying them.
          </p>
          {transferMessage && (
            <p
              className={`text-12 ${
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

      <SettingsGroup title="Reset" description="Restore every setting to its default value">
        {showResetConfirm ? (
          <SettingsNotice
            tone="warning"
            role="alert"
            title="Reset all settings to defaults?"
            action={
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="button" onClick={onReset} className="btn btn-danger btn-sm">
                  Yes, reset
                </button>
              </div>
            }
          >
            The reset is staged in this dialog. Save changes to apply it.
          </SettingsNotice>
        ) : (
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="btn btn-secondary"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to defaults
          </button>
        )}
      </SettingsGroup>
    </>
  );
}
