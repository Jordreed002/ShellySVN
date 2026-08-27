import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  FileDiff,
  FolderSync,
  GitBranch,
  Key,
  Loader2,
  MessageSquare,
  Palette,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';

import type { AppSettings } from '@shared/types';
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings-defaults';

import { useSettingsPreview } from '../../contexts/SettingsPreviewContext';
import { useSettings } from '../../hooks/useSettings';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  countMatchesPerTab,
  searchSettings,
  sectionSlug,
  SETTINGS_SEARCH_INDEX,
} from '../../lib/settingsSearch';
import { applySectionReset } from '../../lib/settingsTransfer';
import { SettingsSectionResetContext } from '../settings/sectionReset';
import { SettingsSearchView } from '../settings/SettingsSearchView';
import { AiProviderSettings } from '../settings/AiProviderSettings';
import { ConnectionProfilesSettings } from '../settings/ConnectionProfilesSettings';
import { WorkingCopiesSettings } from '../settings/WorkingCopiesSettings';
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
  | 'connections'
  | 'ai'
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
  { id: 'connections', label: 'Connections', icon: <FolderSync className="w-4 h-4" /> },
  { id: 'ai', label: 'AI Providers', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'advanced', label: 'Advanced', icon: <Wrench className="w-4 h-4" /> },
];

const TAB_LABELS = Object.fromEntries(TABS.map((tab) => [tab.id, tab.label])) as Record<
  SettingsTab,
  string
>;

/** Highlight classes applied to a jumped-to section (source-scanned by Tailwind). */
const HIGHLIGHT_CLASSES = ['ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-bg-secondary'];

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
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({
    active: isOpen && !showShellIntegrationDialog,
    allowOutsideClick: true,
    onEscape: handleEscape,
    returnFocus: true,
  });

  const trimmedQuery = searchQuery.trim();
  const matches = useMemo(
    () => searchSettings(SETTINGS_SEARCH_INDEX, trimmedQuery),
    [trimmedQuery]
  );
  const matchesPerTab = useMemo(() => countMatchesPerTab(matches), [matches]);
  const isSearching = trimmedQuery.length > 0;

  function handleEscape() {
    if (searchQuery) {
      setSearchQuery('');
      return;
    }
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

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    },
    []
  );

  // Load settings and start preview when dialog opens — once per open. The
  // init guard matters: the AI tab persists its changes immediately through
  // useSettings, which swaps the `savedSettings` object mid-open, and re-running
  // this effect would throw the user back to `initialTab` and discard any
  // unsaved edits made in other tabs.
  const initializedOpenRef = useRef(false);
  // aiCommit values (JSON key) the dialog opened with — the baseline used to
  // tell the open-time seed apart from a real AI-tab edit below.
  const openedAiCommitValuesRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      initializedOpenRef.current = false;
      openedAiCommitValuesRef.current = null;
      return;
    }
    if (initializedOpenRef.current || !savedSettings) return;
    initializedOpenRef.current = true;
    const settings = mergeSettings(savedSettings);
    setLocalSettings(settings);
    openedAiCommitValuesRef.current = JSON.stringify(settings.aiCommit);
    startPreview(settings); // Start live preview
    setShowResetConfirm(false);
    // Set initial tab when dialog opens
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, savedSettings, initialTab, startPreview]);

  // Immediate AI-tab writes land in the settings cache while the dialog is
  // open and never pass through the preview context, so without this the
  // footer would ignore them (Save stayed disabled). When a write differs
  // from the values the dialog opened with, fold it into the draft — so a
  // later Save cannot revert it with the open-time snapshot — and mark the
  // preview dirty so the "Unsaved changes" chip and Save button react like
  // they do for every other tab. Only aiCommit is touched; other keys may
  // hold unsaved local edits that must win until Save.
  const savedAiCommit = savedSettings?.aiCommit;
  const savedAiCommitValues = savedAiCommit ? JSON.stringify(savedAiCommit) : null;
  useEffect(() => {
    if (!isOpen || !savedAiCommit || !savedAiCommitValues) return;
    if (savedAiCommitValues === openedAiCommitValuesRef.current) return;
    openedAiCommitValuesRef.current = savedAiCommitValues;
    setLocalSettings((prev) => ({ ...prev, aiCommit: savedAiCommit }));
    updatePreviewSetting('aiCommit', savedAiCommit);
  }, [isOpen, savedAiCommit, savedAiCommitValues, updatePreviewSetting]);

  // Scroll to + flash a jumped-to section once its panel has rendered.
  useEffect(() => {
    if (!pendingHighlight) return;
    const slug = pendingHighlight;
    setPendingHighlight(null);
    const target = document.querySelector<HTMLElement>(`[data-settings-section="${slug}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add(...HIGHLIGHT_CLASSES);
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      target.classList.remove(...HIGHLIGHT_CLASSES);
    }, 1600);
  }, [pendingHighlight, activeTab]);

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
    // The dialog stays open after saving: re-baseline the preview to the
    // freshly saved draft so the footer shows a clean state and later edits
    // compare against the new saved values, and sync the aiCommit fold
    // baseline so the immediate-write effect does not re-flag the save.
    startPreview(localSettings);
    openedAiCommitValuesRef.current = JSON.stringify(localSettings.aiCommit);
  };

  const handleReset = async () => {
    // Deep clone so the shared DEFAULT_SETTINGS nested objects stay immutable.
    const fresh = applySectionReset(DEFAULT_SETTINGS, Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]);
    setLocalSettings(fresh);
    startPreview(fresh);
    setShowResetConfirm(false);
  };

  const handleSectionReset = useCallback(
    (keys: readonly (keyof AppSettings)[]) => {
      setLocalSettings((prev) => applySectionReset(prev, keys));
      for (const key of keys) {
        const value = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
        updatePreviewSetting(key, value as AppSettings[keyof AppSettings]);
      }
    },
    [updatePreviewSetting]
  );

  const handleImportSettings = useCallback(
    (imported: AppSettings) => {
      setLocalSettings(imported);
      startPreview(imported);
    },
    [startPreview]
  );

  const handleJump = useCallback((tab: SettingsTab, section: string) => {
    setSearchQuery('');
    setActiveTab(tab);
    setPendingHighlight(sectionSlug(section));
  }, []);

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

            <nav className="flex-1 py-2 overflow-y-auto scrollbar-overlay" aria-label="Settings sections">
              {TABS.map((tab) => {
                const matchCount = isSearching ? (matchesPerTab[tab.id] ?? 0) : undefined;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      // Clicking a tab while searching jumps there (and ends
                      // the search), matching the results-view jump behavior.
                      if (isSearching) setSearchQuery('');
                      setActiveTab(tab.id);
                    }}
                    className={`
                      w-full flex items-center gap-3 px-4 py-2 text-sm font-medium
                      transition-all duration-150 text-left
                      ${
                        activeTab === tab.id && !isSearching
                          ? 'bg-accent/10 text-accent border-r-2 border-accent'
                          : 'text-text-secondary hover:text-text hover:bg-bg-elevated/50'
                      }
                      ${isSearching && matchCount === 0 ? 'opacity-40' : ''}
                    `}
                  >
                    {tab.icon}
                    <span className="flex-1 truncate">{tab.label}</span>
                    {matchCount !== undefined && matchCount > 0 && (
                      <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-9.5 text-accent">
                        {matchCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Version info */}
            <div className="px-4 py-3 border-t border-border">
              <p className="text-xs text-text-faint">ShellySVN v{appVersion}</p>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
              <h3 className="text-base font-medium text-text truncate">
                {isSearching ? 'Search settings' : TABS.find((t) => t.id === activeTab)?.label}
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && matches.length > 0) {
                        handleJump(matches[0].tab, matches[0].section);
                      }
                    }}
                    placeholder="Search settings…"
                    className="input w-52 pl-8 text-xs"
                    aria-label="Search settings"
                    data-testid="settings-search-input"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:text-text"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear settings search"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <button
                  onClick={handleClose}
                  className="btn-icon-sm"
                  data-testid="modal-close-button"
                  aria-label="Close settings"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-overlay">
              {isSearching ? (
                <SettingsSearchView
                  query={trimmedQuery}
                  matches={matches}
                  tabLabels={TAB_LABELS}
                  onJump={handleJump}
                  onClear={() => setSearchQuery('')}
                />
              ) : (
                <SettingsSectionResetContext.Provider value={handleSectionReset}>
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
                        onChange={updateLocalSetting}
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
                    {activeTab === 'connections' && (
                      <div className="space-y-6">
                        <ConnectionProfilesSettings />
                        <WorkingCopiesSettings settings={localSettings} />
                      </div>
                    )}
                    {activeTab === 'ai' && <AiProviderSettings />}
                    {activeTab === 'advanced' && (
                      <AdvancedSettings
                        settings={localSettings}
                        onChange={updateLocalSetting}
                        onReset={handleReset}
                        showResetConfirm={showResetConfirm}
                        setShowResetConfirm={setShowResetConfirm}
                        onImportSettings={handleImportSettings}
                      />
                    )}
                  </Suspense>
                </SettingsSectionResetContext.Provider>
              )}
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
