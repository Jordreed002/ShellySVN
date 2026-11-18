/**
 * Search results view for the settings dialog (#89): renders the matches for
 * the current query grouped by tab and section; activating a match jumps to
 * that tab and highlights the section.
 */

import type { ReactNode } from 'react';
import { ChevronRight, SearchX } from 'lucide-react';

import type { SettingsTab } from '../ui/SettingsDialog';
import { groupSearchMatches, type SettingsSearchEntry } from '../../lib/settingsSearch';

interface SettingsSearchViewProps {
  query: string;
  matches: readonly SettingsSearchEntry[];
  tabLabels: Readonly<Record<SettingsTab, string>>;
  tabIcons?: Readonly<Partial<Record<SettingsTab, ReactNode>>>;
  onJump: (tab: SettingsTab, section: string) => void;
  onClear: () => void;
}

export function SettingsSearchView({
  query,
  matches,
  tabLabels,
  tabIcons,
  onJump,
  onClear,
}: SettingsSearchViewProps) {
  const grouped = groupSearchMatches(matches);

  if (matches.length === 0) {
    return (
      <div
        className="flex flex-col items-center px-6 py-16 text-center"
        data-testid="settings-search-results"
      >
        <SearchX className="h-6 w-6 text-text-faint" aria-hidden="true" />
        <p className="mt-3 text-13 font-medium text-text">No settings match "{query}"</p>
        <p className="mt-1 text-12 text-text-muted">
          Try a shorter term, such as proxy, theme or cache.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-4" onClick={onClear}>
          Clear search
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="settings-search-results">
      <div className="flex items-center justify-between gap-3">
        <p className="text-12 text-text-muted" role="status">
          {matches.length} {matches.length === 1 ? 'match' : 'matches'} for "{query}"
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear search
        </button>
      </div>

      {grouped.map((group) => (
        <div key={group.tab}>
          <p className="eyebrow mb-1.5 flex items-center gap-1.5">
            <span className="text-text-faint [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden="true">
              {tabIcons?.[group.tab]}
            </span>
            {tabLabels[group.tab]}
          </p>
          <ul className="settings-list">
            {group.sections.map((section) => (
              <li key={`${group.tab}:${section.section}`}>
                <button
                  type="button"
                  className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-fast hover:bg-bg-tertiary"
                  onClick={() => onJump(group.tab, section.section)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-13 font-medium text-text">{section.section}</span>
                    <span className="mt-0.5 block truncate text-12 text-text-muted">
                      {section.entries.map((entry) => entry.label).join(' · ')}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-text-faint transition-colors group-hover:text-text"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
