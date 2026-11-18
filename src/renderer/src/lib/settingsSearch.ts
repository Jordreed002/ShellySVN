/**
 * Searchable settings index (#89).
 *
 * A static map of settings tab → section → control labels (mirroring the
 * panels in components/settings/SettingsPanels.tsx and the new sections).
 * Pure filtering: every whitespace-separated term must match somewhere in the
 * label, section, or keywords; matching is case-insensitive and diacritic-
 * insensitive. The dialog uses the matches to filter the sidebar tabs and to
 * render a jump-to-section results view.
 */

import type { SettingsTab } from '../components/ui/SettingsDialog';

export interface SettingsSearchEntry {
  tab: SettingsTab;
  /** Section title exactly as rendered by SettingsGroup. */
  section: string;
  /** The individual control or setting label. */
  label: string;
  /** Extra searchable words (descriptions, option names). */
  keywords?: string[];
}

export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchEntry[] = [
  // General
  { tab: 'general', section: 'Theme', label: 'Color scheme', keywords: ['light', 'dark', 'system'] },
  { tab: 'general', section: 'Language and startup', label: 'Application display language', keywords: ['english', 'german', 'french', 'spanish', 'japanese', 'chinese'] },
  { tab: 'general', section: 'Language and startup', label: 'Startup action', keywords: ['welcome', 'last repository', 'empty'] },
  { tab: 'general', section: 'Default checkout directory', label: 'Where new checkouts are saved', keywords: ['checkout', 'folder', 'browse'] },
  { tab: 'general', section: 'Updates', label: 'Check for updates', keywords: ['release channel', 'stable', 'preview', 'version'] },
  { tab: 'general', section: 'Behavior', label: 'Single instance mode', keywords: ['one instance', 'open files'] },
  { tab: 'general', section: 'Behavior', label: 'Confirm destructive operations', keywords: ['revert', 'delete', 'confirmation'] },
  { tab: 'general', section: 'Tutorial', label: 'Restart tutorial', keywords: ['onboarding', 'learn'] },

  // SVN
  { tab: 'svn', section: 'SVN client', label: 'SVN executable path', keywords: ['binary', 'bundled'] },
  { tab: 'svn', section: 'Working copy format', label: 'Format for new working copies', keywords: ['1.8', '1.14', 'pristine'] },
  { tab: 'svn', section: 'Default commit message', label: 'Pre-filled commit text', keywords: ['commit'] },
  { tab: 'svn', section: 'File visibility', label: 'Show ignored files', keywords: ['ignored', 'unversioned', 'visibility'] },
  { tab: 'svn', section: 'File visibility', label: 'Show unversioned files', keywords: ['unversioned', 'visibility'] },
  { tab: 'svn', section: 'Auto refresh', label: 'Status refresh interval', keywords: ['seconds', 'poll', 'refresh'] },
  { tab: 'svn', section: 'Global ignore patterns', label: 'Files and folders to ignore globally', keywords: ['ignore', 'pattern', 'exclude'] },
  { tab: 'svn', section: 'Proxy', label: 'Enable proxy', keywords: ['http', 'host', 'port', 'username', 'password', 'bypass'] },
  { tab: 'svn', section: 'Proxy', label: 'Proxy host and port', keywords: ['http', 'proxy', '8080'] },
  { tab: 'svn', section: 'Connection', label: 'Network timeout', keywords: ['timeout', 'seconds'] },
  { tab: 'svn', section: 'SSL/TLS', label: 'Verify SSL certificates', keywords: ['ssl', 'tls', 'certificate', 'client'] },

  // Diff & Merge
  { tab: 'diffmerge', section: 'External diff tool', label: 'Application for viewing differences', keywords: ['beyond compare', 'kdiff3', 'p4merge', 'winmerge'] },
  { tab: 'diffmerge', section: 'External merge tool', label: 'Application for resolving conflicts', keywords: ['merge', 'conflict', 'threeway'] },
  { tab: 'diffmerge', section: 'Per-extension tools', label: 'Override tools for file extensions', keywords: ['extension', 'override'] },
  { tab: 'diffmerge', section: 'Custom tools', label: 'Add a custom diff or merge tool', keywords: ['executable', 'argument template', 'placeholders', 'mine', 'theirs', 'base', 'merged'] },
  { tab: 'diffmerge', section: 'Diff behavior', label: 'Show diff on double-click', keywords: ['double click', 'diff'] },
  { tab: 'diffmerge', section: 'Diff behavior', label: 'Ignore whitespace', keywords: ['whitespace', 'eol', 'end of line'] },
  { tab: 'diffmerge', section: 'Unified diff', label: 'Context lines', keywords: ['unified', 'context'] },

  // Dialogs
  { tab: 'dialogs', section: 'Window behavior', label: 'Remember dialog positions and sizes', keywords: ['geometry', 'window'] },
  { tab: 'dialogs', section: 'Commit dialog', label: 'Visible columns', keywords: ['status', 'path', 'extension', 'size', 'modified'] },
  { tab: 'dialogs', section: 'Log dialog', label: 'Messages per page', keywords: ['log', 'pagination', 'cache'] },

  // Notifications
  { tab: 'notifications', section: 'Alerts', label: 'Play sounds on completion', keywords: ['audio', 'sound'] },
  { tab: 'notifications', section: 'Alerts', label: 'Desktop notifications', keywords: ['notification', 'os'] },
  { tab: 'notifications', section: 'Hook scripts', label: 'Show output from hook scripts', keywords: ['hook', 'output'] },
  { tab: 'notifications', section: 'Working copy monitor', label: 'Monitor poll interval', keywords: ['monitor', 'poll', 'seconds'] },

  // Integration
  { tab: 'integration', section: 'Open in', label: 'Applications for the Open in context menu', keywords: ['editor', 'open with'] },
  { tab: 'integration', section: 'Shell integration', label: 'Explorer and Finder context menu', keywords: ['shell', 'extension', 'register'] },
  { tab: 'integration', section: 'Shell integration', label: 'Status icon overlays', keywords: ['overlay', 'badge'] },
  { tab: 'integration', section: 'Context menu items', label: 'Which items appear in the context menu', keywords: ['update', 'commit', 'revert', 'blame'] },

  // Appearance
  { tab: 'appearance', section: 'Sidebar width', label: 'Navigation sidebar width', keywords: ['sidebar', 'pixels'] },
  { tab: 'appearance', section: 'Accent color', label: 'Primary highlight color', keywords: ['accent', 'indigo', 'custom hex'] },
  { tab: 'appearance', section: 'High contrast', label: 'Stronger borders and brighter text', keywords: ['contrast', 'accessibility', 'system'] },
  { tab: 'appearance', section: 'Density', label: 'Row height and padding', keywords: ['compact', 'comfortable', 'density'] },
  { tab: 'appearance', section: 'Font size', label: 'Base interface font size', keywords: ['font', 'small', 'medium', 'large'] },
  { tab: 'appearance', section: 'Zoom', label: 'Scale the whole interface', keywords: ['zoom', 'font scale', 'percent'] },
  { tab: 'appearance', section: 'Animation speed', label: 'UI transition animations', keywords: ['animation', 'motion', 'fast'] },
  { tab: 'appearance', section: 'Status bar', label: 'Show status bar', keywords: ['status bar'] },
  { tab: 'appearance', section: 'Default explorer view', label: 'Miller columns or list layout', keywords: ['explorer', 'miller', 'columns', 'list'] },
  { tab: 'appearance', section: 'File list height', label: 'Fill space or compact', keywords: ['file list', 'height'] },
  { tab: 'appearance', section: 'File rows', label: 'Compact file rows', keywords: ['compact', 'rows'] },
  { tab: 'appearance', section: 'File rows', label: 'Show image thumbnails', keywords: ['thumbnail', 'image', 'preview'] },
  { tab: 'appearance', section: 'File rows', label: 'Calculate folder sizes', keywords: ['folder', 'size'] },

  // Authentication
  { tab: 'auth', section: 'Saved credentials', label: 'Authentication data for repositories', keywords: ['credential', 'password', 'realm', 'keychain'] },
  { tab: 'auth', section: 'SSL certificates', label: 'Client certificate path', keywords: ['certificate', 'ssl'] },
  { tab: 'auth', section: 'SSH keys', label: 'SSH client and host keys', keywords: ['ssh', 'key', 'agent', 'svn+ssh'] },

  // Connections (#90 / #91)
  { tab: 'connections', section: 'Connection profiles', label: 'Named repo, proxy and auth bundles', keywords: ['profile', 'proxy', 'credentials', 'pattern', 'duplicate', 'rename'] },
  { tab: 'connections', section: 'Connection profiles', label: 'Repository URL pattern', keywords: ['pattern', 'wildcard', 'match'] },
  { tab: 'connections', section: 'Working copies', label: 'Per-working-copy overrides', keywords: ['override', 'working copy', 'inherited', 'effective'] },
  { tab: 'connections', section: 'Working copies', label: 'Proxy override for one working copy', keywords: ['proxy', 'override', 'working copy'] },
  { tab: 'connections', section: 'Working copies', label: 'AI opt-in state per working copy', keywords: ['ai', 'consent', 'opt in', 'privacy'] },

  // AI Providers
  { tab: 'ai', section: 'HTTP providers', label: 'Add provider dialog', keywords: ['add', 'provider', 'new', 'connect', 'endpoint', 'anthropic', 'azure', 'openai', 'ollama', 'api key'] },
  { tab: 'ai', section: 'HTTP providers', label: 'Custom provider with name and protocol', keywords: ['custom', 'provider', 'display name', 'protocol', 'openai-compatible', 'openrouter', 'groq', 'together', 'lm studio', 'endpoint', 'base url', 'proxy'] },
  { tab: 'ai', section: 'HTTP providers', label: 'Enable a provider and save its API key', keywords: ['anthropic', 'azure', 'openai', 'ollama', 'api key', 'safe storage'] },
  { tab: 'ai', section: 'HTTP providers', label: 'Base URL for openai-compatible or azure', keywords: ['base url', 'endpoint', 'openai-compatible', 'azure'] },
  { tab: 'ai', section: 'HTTP providers', label: 'Rename or delete a custom provider', keywords: ['rename', 'delete', 'remove', 'custom', 'display name'] },
  { tab: 'ai', section: 'HTTP providers', label: 'Model picker and refresh', keywords: ['model', 'list', 'refresh', 'override'] },
  { tab: 'ai', section: 'HTTP providers', label: 'Preview cost for a sample diff', keywords: ['cost', 'estimate', 'tokens', 'pricing'] },
  { tab: 'ai', section: 'CLI providers', label: 'Installed CLI provider status', keywords: ['codex', 'claude', 'cli', 'installed', 'signed in'] },
  { tab: 'ai', section: 'AI commit messages', label: 'Enable generated commit-message drafts', keywords: ['ai', 'provider', 'codex', 'claude', 'diff', 'budget', 'privacy'] },
  { tab: 'ai', section: 'AI commit messages', label: 'Confirm before sending each diff', keywords: ['ai', 'privacy', 'prompt'] },

  // Advanced
  { tab: 'advanced', section: 'Log level', label: 'Diagnostic output verbosity', keywords: ['log', 'debug', 'verbose'] },
  { tab: 'advanced', section: 'Custom paths', label: 'SVN config and log cache directories', keywords: ['config', 'cache', 'path'] },
  { tab: 'advanced', section: 'Log cache', label: 'Clear cached revision history', keywords: ['cache', 'clear', 'size'] },
  { tab: 'advanced', section: 'Import & export', label: 'Export or import settings as JSON', keywords: ['export', 'import', 'backup', 'json', 'transfer'] },
  { tab: 'advanced', section: 'Reset', label: 'Reset all settings to defaults', keywords: ['reset', 'defaults', 'restore'] },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeSearchQuery(query: string): string[] {
  return normalizeText(query).split(/\s+/).filter(Boolean);
}

/** Whether all query terms hit the entry's label, section, or keywords. */
export function entryMatches(entry: SettingsSearchEntry, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const haystack = normalizeText(
    [entry.label, entry.section, entry.tab, ...(entry.keywords ?? [])].join(' ')
  );
  return terms.every((term) => haystack.includes(term));
}

/** Filter the index; stable order (index order = tab order). */
export function searchSettings(
  entries: readonly SettingsSearchEntry[],
  query: string
): SettingsSearchEntry[] {
  const terms = normalizeSearchQuery(query);
  if (terms.length === 0) return [];
  return entries.filter((entry) => entryMatches(entry, terms));
}

export type TabMatchCounts = Partial<Record<SettingsTab, number>>;

/** Matches per tab, for sidebar badges. */
export function countMatchesPerTab(matches: readonly SettingsSearchEntry[]): TabMatchCounts {
  const counts: TabMatchCounts = {};
  for (const match of matches) {
    counts[match.tab] = (counts[match.tab] ?? 0) + 1;
  }
  return counts;
}

/** Tabs that still match, in canonical tab order. */
export function filterTabsByQuery(
  tabs: readonly SettingsTab[],
  matches: readonly SettingsSearchEntry[]
): SettingsTab[] {
  const matching = new Set(matches.map((match) => match.tab));
  return tabs.filter((tab) => matching.has(tab));
}

/** Stable slug for the `data-settings-section` hook used by jump-to-section. */
export function sectionSlug(sectionTitle: string): string {
  return normalizeText(sectionTitle).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface GroupedSearchMatches {
  tab: SettingsTab;
  sections: { section: string; entries: SettingsSearchEntry[] }[];
}

/** Group matches by tab, then section, preserving index order. */
export function groupSearchMatches(
  matches: readonly SettingsSearchEntry[]
): GroupedSearchMatches[] {
  const byTab = new Map<SettingsTab, Map<string, SettingsSearchEntry[]>>();
  for (const match of matches) {
    const sections = byTab.get(match.tab) ?? new Map<string, SettingsSearchEntry[]>();
    const entries = sections.get(match.section) ?? [];
    entries.push(match);
    sections.set(match.section, entries);
    byTab.set(match.tab, sections);
  }
  return [...byTab.entries()].map(([tab, sections]) => ({
    tab,
    sections: [...sections.entries()].map(([section, entries]) => ({ section, entries })),
  }));
}
