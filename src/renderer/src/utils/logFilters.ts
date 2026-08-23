import type { SvnLogEntry } from '@shared/types';
import { extractIssueIds, type IssueTrackerConfig } from './issueTracker';

/**
 * Log search/filter model (#66).
 *
 * Text fields (`search`, `author`, `message`, `path`, `notMessage`) match as
 * case-insensitive substrings, or — when `useRegex` is on — as regular
 * expressions (compiled with the `i` flag to match the substring convention;
 * use explicit character classes when case must matter). An invalid regex
 * never silently falls back to substring matching: the compiled predicate
 * reports it via `regexError`, the offending filter is skipped, and the UI
 * surfaces the error inline.
 *
 * `compileLogFilters` derives a single memoizable predicate so large logs are
 * filtered once per filter change instead of re-parsing every rule per entry.
 */

export interface LogFilterState {
  /** Full-text search across author, message and changed paths. */
  search: string;
  /** Treat text filters as regular expressions. */
  useRegex: boolean;
  author: string;
  message: string;
  path: string;
  /** Exclude entries whose message matches this filter ("Merge-free" view). */
  notMessage: string;
  issueId: string;
  revisionFrom: string;
  revisionTo: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_LOG_FILTERS: LogFilterState = {
  search: '',
  useRegex: false,
  author: '',
  message: '',
  path: '',
  notMessage: '',
  issueId: '',
  revisionFrom: '',
  revisionTo: '',
  dateFrom: '',
  dateTo: '',
};

/** A compiled predicate plus the diagnostics the UI needs. */
export interface CompiledLogFilters {
  predicate: (entry: SvnLogEntry) => boolean;
  /** First invalid regex found in the text filters, if any. */
  regexError: string | null;
  activeCount: number;
}

/** One text filter after compilation: a matcher or a reported error. */
interface TextMatcher {
  fieldName: string;
  matches: (value: string) => boolean;
  error: string | null;
}

function compileTextMatcher(fieldName: string, pattern: string, useRegex: boolean): TextMatcher | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;

  if (!useRegex) {
    const needle = trimmed.toLowerCase();
    return { fieldName, matches: (value) => value.toLowerCase().includes(needle), error: null };
  }

  try {
    const regex = new RegExp(trimmed, 'i');
    return { fieldName, matches: (value) => regex.test(value), error: null };
  } catch (err) {
    return {
      fieldName,
      // Invalid pattern: the filter is skipped (never a substring fallback)…
      matches: () => true,
      // …and the error is surfaced to the caller.
      error: `${fieldName}: ${err instanceof Error ? err.message : 'invalid regular expression'}`,
    };
  }
}

function firstMatcherError(matchers: Array<TextMatcher | null>): string | null {
  for (const matcher of matchers) {
    if (matcher?.error) return matcher.error;
  }
  return null;
}

export function compileLogFilters(
  filters: LogFilterState,
  issueTrackerConfig?: IssueTrackerConfig
): CompiledLogFilters {
  const search = compileTextMatcher('Search', filters.search, filters.useRegex);
  const author = compileTextMatcher('Author', filters.author, filters.useRegex);
  const message = compileTextMatcher('Message', filters.message, filters.useRegex);
  const path = compileTextMatcher('Path', filters.path, filters.useRegex);
  const notMessage = compileTextMatcher('Excluded message', filters.notMessage, filters.useRegex);
  const matchers = [search, author, message, path, notMessage];

  const revisionFrom = parseRevisionFilter(filters.revisionFrom);
  const revisionTo = parseRevisionFilter(filters.revisionTo);
  const dateFrom = parseDateStart(filters.dateFrom);
  const dateTo = parseDateEnd(filters.dateTo);
  const issueFilter = normalizeFilter(filters.issueId);

  const predicate = (entry: SvnLogEntry): boolean => {
    if (author && !author.matches(entry.author)) return false;
    if (message && !message.matches(entry.message)) return false;
    if (notMessage && notMessage.matches(entry.message)) return false;

    if (path) {
      const paths = entry.paths ?? [];
      if (!paths.some((changed) => path.matches(changed.path))) return false;
    }

    if (search) {
      const paths = entry.paths ?? [];
      const found =
        search.matches(entry.author) ||
        search.matches(entry.message) ||
        paths.some((changed) => search.matches(changed.path));
      if (!found) return false;
    }

    if (revisionFrom !== null && entry.revision < revisionFrom) return false;
    if (revisionTo !== null && entry.revision > revisionTo) return false;

    const date = new Date(entry.date);
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;

    if (issueFilter && !matchesIssueFilter(entry, issueFilter, issueTrackerConfig)) return false;

    return true;
  };

  return {
    predicate,
    regexError: firstMatcherError(matchers),
    activeCount: countActiveLogFilters(filters),
  };
}

export function filterLogEntries(
  entries: SvnLogEntry[],
  filters: LogFilterState,
  issueTrackerConfig?: IssueTrackerConfig
): SvnLogEntry[] {
  return entries.filter(compileLogFilters(filters, issueTrackerConfig).predicate);
}

/** The first invalid-regex error for the given filters, if any. */
export function logFiltersRegexError(filters: LogFilterState): string | null {
  return compileLogFilters(filters).regexError;
}

export function countActiveLogFilters(filters: LogFilterState): number {
  let count = 0;
  for (const key of Object.keys(EMPTY_LOG_FILTERS) as Array<keyof LogFilterState>) {
    if (key === 'useRegex') continue;
    if (filters[key].trim()) count += 1;
  }
  return count;
}

/**
 * Strict validation of an unknown payload as filter state (storage is
 * untyped at rest). Unknown keys are ignored; a wrong type on any known key
 * rejects the whole payload.
 */
export function parseLogFilterState(value: unknown): LogFilterState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result: LogFilterState = { ...EMPTY_LOG_FILTERS };
  for (const key of Object.keys(EMPTY_LOG_FILTERS) as Array<keyof LogFilterState>) {
    const entry = record[key];
    if (entry === undefined) continue;
    if (key === 'useRegex') {
      if (typeof entry !== 'boolean') return null;
      result.useRegex = entry;
    } else {
      if (typeof entry !== 'string') return null;
      result[key] = entry;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Column sorting (#66)
// ---------------------------------------------------------------------------

export type LogSortKey = 'revision' | 'date' | 'author' | 'message';
export type LogSortDirection = 'asc' | 'desc';

export interface LogSortState {
  key: LogSortKey;
  direction: LogSortDirection;
}

/** Logs are newest-first by default, matching `svn log`. */
export const DEFAULT_LOG_SORT: LogSortState = { key: 'revision', direction: 'desc' };

const SORT_DEFAULT_DIRECTION: Record<LogSortKey, LogSortDirection> = {
  revision: 'desc',
  date: 'desc',
  author: 'asc',
  message: 'asc',
};

export function isLogSortKey(value: unknown): value is LogSortKey {
  return value === 'revision' || value === 'date' || value === 'author' || value === 'message';
}

/** Clicking a header: flip when active, otherwise switch to that column's default. */
export function toggleLogSort(current: LogSortState, key: LogSortKey): LogSortState {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: SORT_DEFAULT_DIRECTION[key] };
}

/** Stable copy sorted by the given column (`toSorted` never mutates the input). */
export function sortLogEntries(entries: readonly SvnLogEntry[], sort: LogSortState): SvnLogEntry[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return entries.toSorted((a, b) => {
    switch (sort.key) {
      case 'date':
        return factor * (Date.parse(a.date) - Date.parse(b.date));
      case 'author':
        return factor * a.author.localeCompare(b.author);
      case 'message':
        return factor * (a.message || '').localeCompare(b.message || '');
      case 'revision':
      default:
        return factor * (a.revision - b.revision);
    }
  });
}

/** Strict validation of an unknown payload as sort state. */
export function parseLogSortState(value: unknown): LogSortState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { key, direction } = value as Record<string, unknown>;
  if (!isLogSortKey(key)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { key, direction };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function matchesIssueFilter(
  entry: SvnLogEntry,
  issueFilter: string,
  issueTrackerConfig?: IssueTrackerConfig
): boolean {
  const issueIds = issueTrackerConfig
    ? extractIssueIds(entry.message, issueTrackerConfig.issueIdPattern)
    : [];

  return (
    issueIds.some((issueId) => normalizeFilter(issueId).includes(issueFilter)) ||
    normalizeFilter(entry.message).includes(issueFilter)
  );
}

function normalizeFilter(value: string): string {
  return value.trim().toLowerCase();
}

function parseRevisionFilter(value: string): number | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  const parsed = Number.parseInt(trimmedValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateStart(value: string): Date | null {
  if (!value.trim()) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value: string): Date | null {
  if (!value.trim()) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}
