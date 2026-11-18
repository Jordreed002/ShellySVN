import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
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

interface TabMeta {
  id: SettingsTab;
  label: string;
  icon: ReactNode;
  /** One line under the page title saying what the tab controls. */
  description: string;
}

const TAB_GROUPS: { label: string; tabs: TabMeta[] }[] = [
  {
    label: 'Application',
    tabs: [
      {
        id: 'general',
        label: 'General',
        icon: <Settings className="h-4 w-4" />,
        description: 'Theme, language, startup and updates.',
      },
      {
        id: 'appearance',
        label: 'Appearance',
        icon: <Palette className="h-4 w-4" />,
        description: 'Accent, density, zoom and file list layout.',
      },
      {
        id: 'dialogs',
        label: 'Dialogs',
        icon: <MessageSquare className="h-4 w-4" />,
        description: 'Window memory, commit columns and log paging.',
      },
      {
        id: 'notifications',
        label: 'Notifications',
        icon: <Bell className="h-4 w-4" />,
        description: 'Sounds, desktop notifications and background monitoring.',
      },
    ],
  },
  {
    label: 'Subversion',
    tabs: [
      {
        id: 'svn',
        label: 'SVN',
        icon: <GitBranch className="h-4 w-4" />,
        description: 'Client binary, working copy format, network and certificates.',
      },
      {
        id: 'diffmerge',
        label: 'Diff & Merge',
        icon: <FileDiff className="h-4 w-4" />,
        description: 'External diff and merge tools and diff defaults.',
      },
      {
        id: 'integration',
        label: 'Integration',
        icon: <Puzzle className="h-4 w-4" />,
        description: 'Open in applications, shell extension and context menu items.',
      },
    ],
  },
  {
    label: 'Access',
    tabs: [
      {
        id: 'auth',
        label: 'Authentication',
        icon: <Key className="h-4 w-4" />,
        description: 'Saved credentials, the Subversion cache and SSH keys.',
      },
      {
        id: 'connections',
        label: 'Connections',
        icon: <FolderSync className="h-4 w-4" />,
        description: 'Connection profiles and per-working-copy overrides.',
      },
      {
        id: 'ai',
        label: 'AI Providers',
        icon: <Sparkles className="h-4 w-4" />,
        description: 'Providers, models and commit message drafting.',
      },
    ],
  },
  {
    label: 'System',
    tabs: [
      {
        id: 'advanced',
        label: 'Advanced',
        icon: <Wrench className="h-4 w-4" />,
        description: 'Logging, custom paths, cache, backup and reset.',
      },
    ],
  },
];

const TABS: TabMeta[] = TAB_GROUPS.flatMap((group) => group.tabs);

const TAB_LABELS = Object.fromEntries(TABS.map((tab) => [tab.id, tab.label])) as Record<
  SettingsTab,
  string
>;

const TAB_ICONS = Object.fromEntries(TABS.map((tab) => [tab.id, tab.icon])) as Record<
  SettingsTab,
  ReactNode
>;

/** Class applied to a jumped-to section for a short flash (styles in global.css). */
const HIGHLIGHT_CLASS = 'settings-section-flash';

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

  // A newly selected tab starts at the top; the jump effect below runs after
  // this one and scrolls to its section when a search result was chosen.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, isSearching]);

  // Scroll to + flash a jumped-to section once its panel has rendered.
  useEffect(() => {
    if (!pendingHighlight) return;
    const slug = pendingHighlight;
    setPendingHighlight(null);
    const target = document.querySelector<HTMLElement>(`[data-settings-section="${slug}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add(HIGHLIGHT_CLASS);
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      target.classList.remove(HIGHLIGHT_CLASS);
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

  const selectTab = (tab: SettingsTab) => {
    // Choosing a tab while searching ends the search, matching the
    // results-view jump behavior.
    if (isSearching) setSearchQuery('');
    setActiveTab(tab);
  };

  // Vertical tab navigation: arrows, Home and End move between sections.
  const handleNavKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-settings-tab]')
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    const target = buttons[next];
    target.focus();
    selectTab(target.dataset.settingsTab as SettingsTab);
  };

  const canSave = hasPreviewChanges && !isUpdating;

  // Ctrl/Cmd+S saves from anywhere in the dialog.
  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (canSave) void handleSave();
    }
  };

  if (!isOpen) return null;

  const activeMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  return (
    <>
      <div className="modal-overlay titlebar-no-drag" onClick={handleClose}>
        <div
          ref={dialogRef}
          className="modal flex h-[680px] w-[900px] max-w-[calc(100vw-32px)] bg-bg-secondary"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleDialogKeyDown}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
        >
          {/* Sidebar navigation */}
          <div className="flex w-[220px] flex-shrink-0 flex-col border-r border-border bg-bg-sunk">
            <div className="px-4 pb-3 pt-4">
              <h2 id="settings-dialog-title" className="text-15 font-semibold text-text">
                Settings
              </h2>
              <div className="relative mt-3">
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
                  placeholder="Search settings"
                  className="input h-8 pl-8 pr-7 text-12.5"
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
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <nav
              className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-overlay"
              aria-label="Settings sections"
              onKeyDown={handleNavKeyDown}
            >
              {TAB_GROUPS.map((group) => (
                <div key={group.label} className="mt-2 first:mt-0">
                  <p className="eyebrow px-2.5 pb-1 pt-2">{group.label}</p>
                  <ul className="space-y-px">
                    {group.tabs.map((tab) => {
                      const matchCount = isSearching ? (matchesPerTab[tab.id] ?? 0) : undefined;
                      const isActive = activeTab === tab.id && !isSearching;
                      return (
                        <li key={tab.id}>
                          <button
                            type="button"
                            data-settings-tab={tab.id}
                            onClick={() => selectTab(tab.id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={`settings-nav-item ${
                              isSearching && matchCount === 0 ? 'opacity-45' : ''
                            }`}
                          >
                            {tab.icon}
                            <span className="flex-1 truncate">{tab.label}</span>
                            {matchCount !== undefined && matchCount > 0 && (
                              <span
                                className="rounded-pill bg-bg-elevated px-1.5 text-11 tabular-nums text-text-secondary"
                                aria-hidden="true"
                              >
                                {matchCount}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="border-t border-border px-4 py-3">
              <p className="font-mono text-11 text-text-muted">ShellySVN {appVersion}</p>
            </div>
          </div>

          {/* Content area */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border px-8 pb-4 pt-5">
              <div className="min-w-0">
                <h3 className="truncate text-18 font-semibold text-text">
                  {isSearching ? 'Search results' : activeMeta.label}
                </h3>
                <p className="mt-1 truncate text-12.5 text-text-muted">
                  {isSearching ? 'Choose a result to open its section.' : activeMeta.description}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="btn-icon-sm -mr-2 -mt-1"
                data-testid="modal-close-button"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={contentRef} className="flex-1 overflow-y-auto scrollbar-overlay">
              <div className="mx-auto w-full max-w-[640px] px-8 pb-8 pt-5">
                {isSearching ? (
                  <SettingsSearchView
                    query={trimmedQuery}
                    matches={matches}
                    tabLabels={TAB_LABELS}
                    tabIcons={TAB_ICONS}
                    onJump={handleJump}
                    onClear={() => setSearchQuery('')}
                  />
                ) : (
                  <SettingsSectionResetContext.Provider value={handleSectionReset}>
                    <Suspense fallback={<SettingsPanelLoader />}>
                      <div className="settings-page" key={activeTab}>
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
                          <AppearanceSettings
                            settings={localSettings}
                            onChange={updateLocalSetting}
                          />
                        )}
                        {activeTab === 'auth' && (
                          <AuthSettings
                            isOpen={isOpen}
                            settings={localSettings}
                            onChange={updateLocalSetting}
                          />
                        )}
                        {activeTab === 'connections' && (
                          <>
                            <ConnectionProfilesSettings />
                            <WorkingCopiesSettings settings={localSettings} />
                          </>
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
                      </div>
                    </Suspense>
                  </SettingsSectionResetContext.Provider>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-4 border-t border-border px-8 py-3">
              <p className="flex min-w-0 items-center gap-2 text-12 text-text-muted">
                {hasPreviewChanges ? (
                  <>
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                      aria-hidden="true"
                    />
                    <span className="text-text-secondary">Unsaved changes</span>
                  </>
                ) : (
                  <span className="truncate">Changes preview immediately and apply when saved.</span>
                )}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={handleClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="btn btn-primary min-w-[132px]"
                  title="Save changes (Ctrl+S)"
                >
                  {isUpdating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Save changes
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
