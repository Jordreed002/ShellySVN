import { describe, expect, it } from 'vitest';

import {
  countMatchesPerTab,
  entryMatches,
  filterTabsByQuery,
  groupSearchMatches,
  normalizeSearchQuery,
  searchSettings,
  sectionSlug,
  SETTINGS_SEARCH_INDEX,
} from '../settingsSearch';

describe('query normalization', () => {
  it('lowercases, strips diacritics, and splits terms', () => {
    expect(normalizeSearchQuery('  Proxy  HOST ')).toEqual(['proxy', 'host']);
    expect(normalizeSearchQuery('Café')).toEqual(['cafe']);
    expect(normalizeSearchQuery('   ')).toEqual([]);
  });
});

describe('search filtering across sections', () => {
  it('matches labels case-insensitively across tabs', () => {
    const matches = searchSettings(SETTINGS_SEARCH_INDEX, 'proxy');
    const tabs = new Set(matches.map((match) => match.tab));
    expect(tabs.has('svn')).toBe(true);
    expect(tabs.has('connections')).toBe(true);
    expect(matches.every((match) => /proxy/i.test(`${match.label} ${match.section} ${match.keywords?.join(' ') ?? ''}`))).toBe(true);
  });

  it('requires every term to match somewhere in the entry', () => {
    const matches = searchSettings(SETTINGS_SEARCH_INDEX, 'proxy password');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((match) => entryMatches(match, ['proxy', 'password']))).toBe(true);
    expect(searchSettings(SETTINGS_SEARCH_INDEX, 'proxy zebra')).toEqual([]);
  });

  it('searches section titles and keywords, not just labels', () => {
    expect(searchSettings(SETTINGS_SEARCH_INDEX, 'accent').length).toBeGreaterThan(0);
    expect(searchSettings(SETTINGS_SEARCH_INDEX, 'wildcard').length).toBeGreaterThan(0);
    expect(searchSettings(SETTINGS_SEARCH_INDEX, 'kdiff3').length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty or whitespace query', () => {
    expect(searchSettings(SETTINGS_SEARCH_INDEX, '')).toEqual([]);
    expect(searchSettings(SETTINGS_SEARCH_INDEX, '   ')).toEqual([]);
  });

  it('covers the newly added sections', () => {
    const tabs = new Set(SETTINGS_SEARCH_INDEX.map((entry) => entry.tab));
    expect(tabs.has('connections')).toBe(true);
    expect(tabs.has('ai')).toBe(true);
    expect(SETTINGS_SEARCH_INDEX.some((entry) => entry.section === 'Custom Tools')).toBe(true);
    expect(SETTINGS_SEARCH_INDEX.some((entry) => entry.section === 'Import & Export')).toBe(true);
  });

  it('produces a stable slug for section anchors', () => {
    expect(sectionSlug('Diff & Merge Tools!')).toBe('diff-merge-tools');
    expect(sectionSlug('Import & Export')).toBe('import-export');
    expect(sectionSlug('SSL/TLS')).toBe('ssl-tls');
  });
});

describe('tab filtering and grouping', () => {
  it('counts matches per tab', () => {
    const matches = searchSettings(SETTINGS_SEARCH_INDEX, 'proxy');
    const counts = countMatchesPerTab(matches);
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(matches.length);
    expect(counts.svn).toBeGreaterThan(0);
  });

  it('filters the visible tabs down to matching ones in canonical order', () => {
    const matches = searchSettings(SETTINGS_SEARCH_INDEX, 'accent');
    const visible = filterTabsByQuery(['general', 'svn', 'appearance', 'advanced'], matches);
    expect(visible).toEqual(['appearance']);
  });

  it('groups matches by tab then section, preserving index order', () => {
    const matches = searchSettings(SETTINGS_SEARCH_INDEX, 'proxy');
    const grouped = groupSearchMatches(matches);
    expect(grouped.length).toBeGreaterThan(0);
    for (const group of grouped) {
      expect(group.sections.length).toBeGreaterThan(0);
      for (const section of group.sections) {
        expect(section.entries.every((entry) => entry.tab === group.tab && entry.section === section.section)).toBe(true);
      }
    }
  });
});
