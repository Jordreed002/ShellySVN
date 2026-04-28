import type { SvnLogEntry } from '@shared/types';
import { extractIssueIds, type IssueTrackerConfig } from './issueTracker';

export interface LogFilterState {
  author: string;
  message: string;
  path: string;
  issueId: string;
  revisionFrom: string;
  revisionTo: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_LOG_FILTERS: LogFilterState = {
  author: '',
  message: '',
  path: '',
  issueId: '',
  revisionFrom: '',
  revisionTo: '',
  dateFrom: '',
  dateTo: '',
};

export function filterLogEntries(
  entries: SvnLogEntry[],
  filters: LogFilterState,
  issueTrackerConfig?: IssueTrackerConfig
): SvnLogEntry[] {
  return entries.filter((entry) => matchesLogFilters(entry, filters, issueTrackerConfig));
}

export function countActiveLogFilters(filters: LogFilterState): number {
  return Object.values(filters).filter((value) => value.trim()).length;
}

function matchesLogFilters(
  entry: SvnLogEntry,
  filters: LogFilterState,
  issueTrackerConfig?: IssueTrackerConfig
): boolean {
  if (!includesText(entry.author, filters.author)) return false;
  if (!includesText(entry.message, filters.message)) return false;

  const pathFilter = normalizeFilter(filters.path);
  if (pathFilter && !entry.paths.some((path) => includesText(path.path, pathFilter))) {
    return false;
  }

  const revisionFrom = parseRevisionFilter(filters.revisionFrom);
  if (revisionFrom !== null && entry.revision < revisionFrom) return false;

  const revisionTo = parseRevisionFilter(filters.revisionTo);
  if (revisionTo !== null && entry.revision > revisionTo) return false;

  const date = new Date(entry.date);
  const dateFrom = parseDateStart(filters.dateFrom);
  if (dateFrom && date < dateFrom) return false;

  const dateTo = parseDateEnd(filters.dateTo);
  if (dateTo && date > dateTo) return false;

  const issueFilter = normalizeFilter(filters.issueId);
  if (issueFilter && !matchesIssueFilter(entry, issueFilter, issueTrackerConfig)) {
    return false;
  }

  return true;
}

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

function includesText(value: string, filter: string): boolean {
  const normalizedFilter = normalizeFilter(filter);
  return !normalizedFilter || normalizeFilter(value).includes(normalizedFilter);
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
