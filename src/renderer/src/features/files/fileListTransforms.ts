import type { SvnStatusEntry } from '@shared/types';

export type FileExplorerSortDirection = 'asc' | 'desc';

export interface FilterAndSortEntriesOptions {
  entries: SvnStatusEntry[];
  searchQuery: string;
  ignoreRegexes: RegExp[];
  sortColumn: string;
  sortDirection: FileExplorerSortDirection;
}

const REGEX_SPECIAL_CHARS = /[.+^${}()|[\]\\]/g;
const PATH_SEPARATOR_PATTERN = '[/\\\\]';

export function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() || '';
}

export function compileIgnorePatterns(patterns: string[]): RegExp[] {
  return patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => {
      let regexPattern = '';

      for (const char of pattern) {
        if (char === '*') {
          regexPattern += '.*';
        } else if (char === '?') {
          regexPattern += '.';
        } else if (char === '/' || char === '\\') {
          regexPattern += PATH_SEPARATOR_PATTERN;
        } else {
          regexPattern += char.replace(REGEX_SPECIAL_CHARS, '\\$&');
        }
      }

      return new RegExp(regexPattern, 'i');
    });
}

export function filterIgnoredEntries(
  entries: SvnStatusEntry[],
  ignoreRegexes: RegExp[]
): SvnStatusEntry[] {
  if (ignoreRegexes.length === 0) {
    return entries;
  }

  return entries.filter((entry) => {
    if (entry.isDirectory) {
      return true;
    }

    const filename = getBasename(entry.path);
    return !ignoreRegexes.some((regex) => regex.test(filename));
  });
}

export function filterSearchEntries(
  entries: SvnStatusEntry[],
  searchQuery: string
): SvnStatusEntry[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) => entry.path.toLowerCase().includes(normalizedQuery));
}

export function sortEntries(
  entries: SvnStatusEntry[],
  sortColumn: string,
  sortDirection: FileExplorerSortDirection
): SvnStatusEntry[] {
  const decorated = entries.map((entry) => ({
    entry,
    basename: getBasename(entry.path),
    status: entry.status || ' ',
    revision: entry.revision || 0,
    author: entry.author || '',
    date: entry.date || '',
  }));

  decorated.sort((a, b) => {
    if (a.entry.isDirectory && !b.entry.isDirectory) return -1;
    if (!a.entry.isDirectory && b.entry.isDirectory) return 1;

    let comparison = 0;
    switch (sortColumn) {
      case 'name':
        comparison = a.basename.localeCompare(b.basename);
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
      case 'revision':
        comparison = a.revision - b.revision;
        break;
      case 'author':
        comparison = a.author.localeCompare(b.author);
        break;
      case 'date':
        comparison = a.date.localeCompare(b.date);
        break;
      default:
        comparison = 0;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  return decorated.map(({ entry }) => entry);
}

export function filterAndSortEntries({
  entries,
  searchQuery,
  ignoreRegexes,
  sortColumn,
  sortDirection,
}: FilterAndSortEntriesOptions): SvnStatusEntry[] {
  const visibleEntries = filterSearchEntries(
    filterIgnoredEntries(entries, ignoreRegexes),
    searchQuery
  );

  return sortEntries(visibleEntries, sortColumn, sortDirection);
}
