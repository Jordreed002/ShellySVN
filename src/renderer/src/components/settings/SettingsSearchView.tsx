/**
 * Search results view for the settings dialog (#89): renders the matches for
 * the current query grouped by tab and section; activating a match jumps to
 * that tab and highlights the section.
 */

import { Search, X } from 'lucide-react';

import type { SettingsTab } from '../ui/SettingsDialog';
import { groupSearchMatches, type SettingsSearchEntry } from '../../lib/settingsSearch';

interface SettingsSearchViewProps {
  query: string;
  matches: readonly SettingsSearchEntry[];
  tabLabels: Readonly<Record<SettingsTab, string>>;
  onJump: (tab: SettingsTab, section: string) => void;
  onClear: () => void;
}

export function SettingsSearchView({
  query,
  matches,
  tabLabels,
  onJump,
  onClear,
}: SettingsSearchViewProps) {
  const grouped = groupSearchMatches(matches);

  return (
    <div className="space-y-4" data-testid="settings-search-results">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {matches.length === 0
            ? `No settings match “${query}”`
            : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} for “${query}”`}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
          Clear search
        </button>
      </div>

      {grouped.map((group) => (
        <div key={group.tab} className="space-y-2">
          <p className="text-10.5 font-semibold uppercase tracking-caps text-text-faint">
            {tabLabels[group.tab]}
          </p>
          {group.sections.map((section) => (
            <button
              key={`${group.tab}:${section.section}`}
              type="button"
              className="w-full rounded-lg border border-border bg-bg-tertiary p-3 text-left transition-fast hover:border-border-focus"
              onClick={() => onJump(group.tab, section.section)}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-text">
                <Search className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                {section.section}
              </span>
              <span className="mt-1 block space-y-0.5 pl-5.5">
                {section.entries.map((entry, index) => (
                  <span key={`${entry.label}:${index}`} className="block text-xs text-text-secondary">
                    {entry.label}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
