/**
 * Issue-tracker linkification with provider presets (#74).
 *
 * The per-working-copy runtime config (enabled / pattern / URL template) lives
 * in `utils/issueTracker.ts` + `hooks/useIssueTrackerConfig.ts`; this module
 * adds the provider layer on top of it:
 *
 *  - Jira / GitHub / custom presets that derive a `{ pattern, urlTemplate }`
 *    pair from a base URL, feeding the existing config chain (so bugtraq
 *    inheritance and the commit rules keep working unchanged);
 *  - a segmenting linkifier shared by `components/IssueKeyText.tsx`, which
 *    LogViewer / CommitHistory can adopt for free;
 *  - a small persisted record of the picker choice itself (which preset and
 *    base URL the user picked for this working copy / globally).
 *
 * URLs are only ever opened when they pass `isSafeExternalUrl`, and issue IDs
 * are encoded before being interpolated into a template.
 */

import { buildIssueUrl, isValidIssuePattern } from '../utils/issueTracker';

export type IssueTrackerPresetId = 'jira' | 'github' | 'custom';

export interface TrackerPresetDefinition {
  id: IssueTrackerPresetId;
  label: string;
  description: string;
  /** Pattern used when the preset is applied. Empty for `custom`. */
  defaultPattern: string;
  /** Placeholder shown in the base-URL input. */
  baseUrlPlaceholder: string;
}

/** Jira project keys: at least two characters before the dash (PROJ-123). */
export const JIRA_ISSUE_PATTERN = '[A-Z][A-Z0-9]+-\\d+';
/** GitHub references: `#123` and cross-repository `org/repo#123`. */
export const GITHUB_ISSUE_PATTERN = '(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#\\d+';

export const TRACKER_PRESETS: Record<IssueTrackerPresetId, TrackerPresetDefinition> = {
  jira: {
    id: 'jira',
    label: 'Jira',
    description: 'Keys like PROJ-123',
    defaultPattern: JIRA_ISSUE_PATTERN,
    baseUrlPlaceholder: 'https://jira.example.com',
  },
  github: {
    id: 'github',
    label: 'GitHub',
    description: '#123 and org/repo#123',
    defaultPattern: GITHUB_ISSUE_PATTERN,
    baseUrlPlaceholder: 'https://github.com/org/repo',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    description: 'Your own regex and URL template',
    defaultPattern: '',
    baseUrlPlaceholder: 'https://tracker.example.com',
  },
};

export interface DerivedTrackerConfig {
  issueIdPattern: string;
  issueUrlTemplate: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Strip a trailing `/browse` (and `/browse/{id}`) so re-applying is idempotent. */
export function normalizeJiraBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/browse(\/\{(?:id|issue)\})?$/i, '');
}

/** `https://github.com/org/repo#extras` → `https://github.com/org/repo`. */
export function normalizeGitHubBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/#.*$/, '');
}

export function buildJiraUrlTemplate(baseUrl: string): string {
  const normalized = normalizeJiraBaseUrl(baseUrl);
  return normalized ? `${normalized}/browse/{id}` : '';
}

export interface ParsedGitHubRepository {
  root: string;
  org?: string;
  repo?: string;
}

/**
 * Accepts `https://github.com/org/repo`, `github.com/org/repo`, bare
 * `org/repo`, or a bare GitHub root. `repo` is undefined when no repository
 * context was given.
 */
export function parseGitHubRepository(input: string): ParsedGitHubRepository | null {
  const raw = input.trim();
  if (!raw) return null;

  if (!/[./]/.test(raw) || /^[\w.-]+\/[\w.-]+$/.test(raw.replace(/\/+$/, ''))) {
    // `org/repo` (possibly with trailing slash) and repo names without dots.
    const match = raw.replace(/\/+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
    if (match) return { root: 'https://github.com', org: match[1], repo: match[2] };
  }

  const normalized = normalizeGitHubBaseUrl(raw);
  try {
    const url = new URL(normalized);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) {
      return { root: url.origin, org: segments[0], repo: segments[1] };
    }
    return { root: url.origin };
  } catch {
    return null;
  }
}

export function buildGitHubUrlTemplate(input: string): string {
  const parsed = parseGitHubRepository(input);
  if (!parsed) return '';
  const base = parsed.org && parsed.repo ? `${parsed.root}/${parsed.org}/${parsed.repo}` : parsed.root;
  return `${base}/issues/{id}`;
}

/**
 * Derive the `{ pattern, urlTemplate }` pair a preset selection produces. For
 * `custom`, the pattern/template come from the user directly; an invalid custom
 * pattern falls back to empty (the caller keeps the previous value).
 */
export function buildPresetConfig(
  preset: IssueTrackerPresetId,
  baseUrl: string,
  custom?: Partial<DerivedTrackerConfig>
): DerivedTrackerConfig {
  if (preset === 'jira') {
    return { issueIdPattern: JIRA_ISSUE_PATTERN, issueUrlTemplate: buildJiraUrlTemplate(baseUrl) };
  }
  if (preset === 'github') {
    return {
      issueIdPattern: GITHUB_ISSUE_PATTERN,
      issueUrlTemplate: buildGitHubUrlTemplate(baseUrl),
    };
  }
  const pattern = custom?.issueIdPattern?.trim() ?? '';
  return {
    issueIdPattern: pattern && isValidIssuePattern(pattern) ? pattern : '',
    issueUrlTemplate: custom?.issueUrlTemplate?.trim() ?? '',
  };
}

// ---------------------------------------------------------------------------
// Linkification
// ---------------------------------------------------------------------------

export interface IssueKeySegment {
  type: 'text' | 'link';
  text: string;
  url?: string;
}

export interface IssueLinkifyOptions {
  pattern: string;
  urlTemplate: string;
  preset?: IssueTrackerPresetId;
}

const GITHUB_REFERENCE = /^(?:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+))?#(\d+)$/;

/** Only http(s) URLs may be opened externally; anything else renders as text. */
export function isSafeExternalUrl(url: string): boolean {
  if (!url || /\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Build the URL for one matched GitHub reference against a template derived
 * from `buildGitHubUrlTemplate`. Explicit `org/repo#n` references override the
 * repository context baked into the template; bare `#n` uses it.
 */
function buildGitHubIssueUrl(reference: string, template: string): string | undefined {
  const match = GITHUB_REFERENCE.exec(reference);
  if (!match) return undefined;

  const issuesRoot = template
    .replace(/\/issues\/\{(?:id|issue)\}$/i, '')
    .replace(/\/+$/, '');
  if (!issuesRoot) return undefined;

  const [, owner, repo, number] = match;
  if (owner && repo) {
    let hostRoot = issuesRoot;
    try {
      const url = new URL(issuesRoot);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        hostRoot = url.origin;
      }
    } catch {
      hostRoot = issuesRoot;
    }
    return `${hostRoot}/${owner}/${repo}/issues/${number}`;
  }
  return `${issuesRoot}/issues/${number}`;
}

/**
 * Split `text` into plain-text and issue-link segments. Invalid patterns,
 * missing templates, and unsafe produced URLs degrade to plain text — the
 * caller never has to branch on failure.
 */
export function linkifyIssueKeys(text: string, options: IssueLinkifyOptions): IssueKeySegment[] {
  const { pattern, urlTemplate, preset } = options;
  if (!text) return [];
  if (!pattern.trim()) return [{ type: 'text', text }];

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    return [{ type: 'text', text }];
  }

  const segments: IssueKeySegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const matched = match[0];
    const index = match.index ?? 0;
    if (!matched || index < lastIndex) continue;
    if (index > lastIndex) segments.push({ type: 'text', text: text.slice(lastIndex, index) });

    let url: string | undefined;
    if (preset === 'github') {
      url = urlTemplate.trim() ? buildGitHubIssueUrl(matched, urlTemplate.trim()) : undefined;
    } else {
      url = buildIssueUrl(matched, urlTemplate);
    }
    segments.push({
      type: 'link',
      text: matched,
      url: url && isSafeExternalUrl(url) ? url : undefined,
    });
    lastIndex = index + matched.length;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', text: text.slice(lastIndex) });
  return segments;
}

// ---------------------------------------------------------------------------
// Persisted picker choice (preset + base URL)
// ---------------------------------------------------------------------------

export const ISSUE_TRACKER_PRESET_KEY = 'shellysvn:issue-tracker-preset:v1';

export interface TrackerPresetSelection {
  preset: IssueTrackerPresetId;
  baseUrl: string;
}

interface TrackerPresetStore {
  global?: TrackerPresetSelection;
  workingCopies?: Record<string, TrackerPresetSelection>;
}

function parseSelection(value: unknown): TrackerPresetSelection | null {
  if (!value || typeof value !== 'object') return null;
  const { preset, baseUrl } = value as { preset?: unknown; baseUrl?: unknown };
  if (typeof preset !== 'string' || !TRACKER_PRESETS[preset as IssueTrackerPresetId]) return null;
  return {
    preset: preset as IssueTrackerPresetId,
    baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
  };
}

function parsePresetStore(value: unknown): TrackerPresetStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const { global, workingCopies } = value as { global?: unknown; workingCopies?: unknown };
  const store: TrackerPresetStore = {};
  const parsedGlobal = parseSelection(global);
  if (parsedGlobal) store.global = parsedGlobal;
  if (workingCopies && typeof workingCopies === 'object' && !Array.isArray(workingCopies)) {
    const entries: Record<string, TrackerPresetSelection> = {};
    for (const [key, selection] of Object.entries(workingCopies)) {
      const parsed = parseSelection(selection);
      if (parsed) entries[key] = parsed;
    }
    if (Object.keys(entries).length > 0) store.workingCopies = entries;
  }
  return store;
}

function normalizeKey(workingCopyPath: string | null): string | null {
  const key = workingCopyPath?.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return key || null;
}

/**
 * The picker choice for one working copy, falling back to the global choice.
 * Storage failures degrade to "no selection".
 */
export async function loadTrackerPresetSelection(
  workingCopyPath: string | null
): Promise<TrackerPresetSelection | null> {
  try {
    const store = parsePresetStore(
      await window.api?.store?.get<unknown>(ISSUE_TRACKER_PRESET_KEY)
    );
    const key = normalizeKey(workingCopyPath);
    return (key && store.workingCopies?.[key]) || store.global || null;
  } catch {
    return null;
  }
}

/**
 * Persist the picker choice. A null working copy path writes the global slot;
 * a null selection clears the slot it addresses.
 */
export async function saveTrackerPresetSelection(
  workingCopyPath: string | null,
  selection: TrackerPresetSelection | null
): Promise<void> {
  try {
    const store = parsePresetStore(
      await window.api?.store?.get<unknown>(ISSUE_TRACKER_PRESET_KEY)
    );
    const key = normalizeKey(workingCopyPath);
    if (!key) {
      if (selection) store.global = selection;
      else delete store.global;
    } else {
      store.workingCopies ??= {};
      if (selection) store.workingCopies[key] = selection;
      else delete store.workingCopies[key];
    }
    await window.api?.store?.set(ISSUE_TRACKER_PRESET_KEY, store);
  } catch {
    // Persistence failures degrade silently; the derived config is still applied.
  }
}
