import type { AppSettings } from './types';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'en',
  checkUpdatesOnStartup: true,
  updateChannel: 'stable',
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
  customOpenWithTools: [],
  proxySettings: {
    enabled: false,
    host: '',
    port: 8080,
    username: '',
    password: '',
    bypassForLocal: true,
  },
  connectionTimeout: 30,
  sslVerify: true,
  clientCertificatePath: '',
  diffMerge: {
    externalDiffTool: '',
    externalMergeTool: '',
    externalToolOverrides: [],
    diffOnDoubleClick: true,
    ignoreWhitespace: false,
    ignoreEol: false,
    contextLines: 3,
  },
  // #87: user-added external diff/merge tools with argument templates.
  // Optional on AppSettings; concrete here so the Diff & Merge panel always
  // renders against an array.
  externalToolTemplates: [],
  dialogs: {
    rememberPositions: true,
    rememberSizes: true,
    commitDialogColumns: ['status', 'path', 'extension'],
    logMessagesPerPage: 100,
    maxCachedMessages: 1000,
  },
  notifications: {
    enableSounds: true,
    enableSystemNotifications: true,
    showHookOutput: true,
    monitorPollInterval: 60,
  },
  integration: {
    shellExtensionEnabled: false,
    contextMenuItems: ['update', 'commit', 'revert', 'log', 'diff', 'checkout', 'export'],
    iconOverlaysEnabled: true,
  },
  aiCommit: {
    enabled: false,
    provider: 'auto',
    codexModel: 'gpt-5.6-luna',
    style: 'conventional',
    includeRecentHistory: false,
    historyLimit: 10,
    maxDiffBytes: 262_144,
    confirmBeforeSending: true,
    providerTimeoutMs: 60_000,
    maxSessionInvocations: 100,
    usageRetentionDays: 30,
    usageMaxEntries: 200,
  },
  fontSize: 'medium',
  showStatusBar: true,
  explorerViewMode: 'miller',
  fileListHeight: 'fill',
  accentColor: '#6366f1',
  compactFileRows: false,
  animationSpeed: 'none',
  showThumbnails: false,
  showFolderSizes: false,
  // Contrast/density/font-scale are optional on AppSettings; explicit defaults
  // here so the settings UI always renders against a concrete value.
  highContrast: 'system',
  density: 'comfortable',
  fontScale: 1,
  bookmarks: [],
  recentPaths: [],
  savedCredentials: [],
  sshSettings: {
    sshClientPath: '',
    useAgent: true,
    keys: [],
  },
  logLevel: 'info',
  svnConfigPath: '',
  logCachePath: '',
  maxLogCacheSize: 100,
  hasCompletedTutorial: false,
  tutorialStep: 0,
};

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

export function mergeDeep<T extends Record<string, unknown>>(target: T, source?: Partial<T>): T {
  if (!isObject(source)) return { ...target };

  const output = { ...target };
  Object.keys(source).forEach((key) => {
    const typedKey = key as keyof T;
    const sourceValue = source[typedKey];

    if (isObject(sourceValue) && isObject(target[typedKey])) {
      output[typedKey] = mergeDeep(
        target[typedKey] as Record<string, unknown>,
        sourceValue as Partial<Record<string, unknown>>
      ) as T[keyof T];
      return;
    }

    Object.assign(output, { [key]: sourceValue });
  });

  return output;
}

export function mergeSettings(updates?: DeepPartial<AppSettings>): AppSettings {
  return mergeDeep(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    updates as Partial<Record<string, unknown>> | undefined
  ) as unknown as AppSettings;
}
