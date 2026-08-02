import { Suspense, lazy, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  FileDiff,
  GitBranch,
  Key,
  Loader2,
  MessageSquare,
  Palette,
  Puzzle,
  Settings,
  Wrench,
  X,
} from 'lucide-react';

import type { AppSettings } from '@shared/types';
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings-defaults';

import { useSettingsPreview } from '../../contexts/SettingsPreviewContext';
import { useSettings } from '../../hooks/useSettings';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  AdvancedSettings,
  AppearanceSettings,
  AuthSettings,
  DialogsSettingsTab,
  DiffMergeSettingsTab,
  GeneralSettings,
  IntegrationSettingsTab,
  NotificationsSettingsTab,
  SvnSettings,
} from '../settings/SettingsPanels';
const ShellIntegrationDialog = lazy(() =>
  import('./ShellIntegrationDialog').then((m) => ({ default: m.ShellIntegrationDialog }))
);

export type SettingsTab =
  | 'general'
  | 'svn'
  | 'diffmerge'
  | 'dialogs'
  | 'notifications'
  | 'integration'
  | 'appearance'
  | 'auth'
  | 'advanced';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
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
];

export function SettingsDialog({ isOpen, onClose, initialTab = 'general' }: SettingsDialogProps) {
  const { settings: savedSettings, updateSettings, isUpdating } = useSettings();
  const {
    startPreview,
    updatePreviewSetting,
    updateNestedPreviewSetting,
    commitPreview,
    cancelPreview,
    hasPreviewChanges,
  } = useSettingsPreview();

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [localSettings, setLocalSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showShellIntegrationDialog, setShowShellIntegrationDialog] = useState(false);
  const [appVersion, setAppVersion] = useState('…');
  const dialogRef = useFocusTrap<HTMLDivElement>({
    active: isOpen && !showShellIntegrationDialog,
    allowOutsideClick: true,
    onEscape: handleEscape,
    returnFocus: true,
  });

  function handleEscape() {
    if (savedSettings) cancelPreview(savedSettings);
    onClose();
  }

  useEffect(() => {
    let active = true;
    void window.api.app.getVersion().then((version) => {
      if (active) setAppVersion(version);
    });
    return () => {
      active = false;
    };
  }, []);

  // Load settings and start preview when dialog opens
  useEffect(() => {
    if (isOpen && savedSettings) {
      const settings = mergeSettings(savedSettings);
      setLocalSettings(settings);
      startPreview(settings); // Start live preview
      setShowResetConfirm(false);
      // Set initial tab when dialog opens
      if (initialTab) {
        setActiveTab(initialTab);
      }
    }
  }, [isOpen, savedSettings, initialTab, startPreview]);

  const updateLocalSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    // Apply to preview immediately for visual settings
    updatePreviewSetting(key, value);
  };

  const updateNestedSetting = <K extends keyof AppSettings, SK extends keyof AppSettings[K]>(
    key: K,
    subKey: SK,
    value: AppSettings[K][SK]
  ) => {
    setLocalSettings((prev) => {
      const nestedValue = prev[key] as unknown as Record<string, unknown>;
      const updated = {
        ...prev,
        [key]: {
          ...nestedValue,
          [subKey]: value,
        },
      };
      return updated;
    });
    // Apply to preview immediately for visual settings
    updateNestedPreviewSetting(key, subKey, value);
  };

  const handleSave = async () => {
    await updateSettings(localSettings);
    commitPreview(); // Commit the preview changes
    onClose();
  };

  const handleReset = async () => {
    setLocalSettings(DEFAULT_SETTINGS);
    startPreview(DEFAULT_SETTINGS);
    setShowResetConfirm(false);
  };

  const handleClose = () => {
    // Cancel preview and revert any unsaved visual changes
    if (savedSettings) {
      cancelPreview(savedSettings);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-overlay titlebar-no-drag" onClick={handleClose}>
        <div
          ref={dialogRef}
          className="modal w-[820px] h-[680px] flex"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
        >
          {/* Sidebar Navigation */}
          <div className="w-[180px] flex-shrink-0 bg-bg-tertiary border-r border-border flex flex-col">
            <div className="px-4 py-4 border-b border-border">
              <h2
                id="settings-dialog-title"
                className="text-lg font-semibold text-text flex items-center gap-2"
              >
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
                    ${
                      activeTab === tab.id
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
              <p className="text-xs text-text-faint">ShellySVN v{appVersion}</p>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-medium text-text">
                {TABS.find((t) => t.id === activeTab)?.label}
              </h3>
              <button
                onClick={handleClose}
                className="btn-icon-sm"
                data-testid="modal-close-button"
                aria-label="Close settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-overlay">
              <Suspense fallback={<SettingsPanelLoader />}>
                {activeTab === 'general' && (
                  <GeneralSettings settings={localSettings} onChange={updateLocalSetting} />
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
                    onChange={updateLocalSetting}
                    onChangeNested={updateNestedSetting}
                    onOpenShellIntegration={() => setShowShellIntegrationDialog(true)}
                  />
                )}
                {activeTab === 'appearance' && (
                  <AppearanceSettings settings={localSettings} onChange={updateLocalSetting} />
                )}
                {activeTab === 'auth' && (
                  <AuthSettings
                    isOpen={isOpen}
                    settings={localSettings}
                    onChange={updateLocalSetting}
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
              </Suspense>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-tertiary/30">
              <div className="flex items-center gap-2">
                {hasPreviewChanges && (
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
                  disabled={!hasPreviewChanges || isUpdating}
                  className="btn btn-primary"
                >
                  {isUpdating ? (
                    <>
                      <span className="animate-spin">…</span>
                      Saving…
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
      {showShellIntegrationDialog && (
        <Suspense fallback={<SettingsPanelLoader />}>
          <ShellIntegrationDialog
            isOpen={showShellIntegrationDialog}
            onClose={() => setShowShellIntegrationDialog(false)}
          />
        </Suspense>
      )}
    </>
  );
}

function SettingsPanelLoader() {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center text-text-muted">
      <Loader2 className="w-5 h-5 animate-spin text-accent" aria-hidden="true" />
      <span className="sr-only">Loading settings…</span>
    </div>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-icon" title="Settings">
      <Settings className="w-5 h-5" />
    </button>
  );
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
  );
}

export default SettingsDialog;
