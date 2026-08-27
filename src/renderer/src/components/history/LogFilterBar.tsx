/**
 * LogFilterBar (#66/#67) — the shared filter toolbar for log surfaces.
 *
 * One compact row (the prototype's `.navbar` control language, as in
 * `FilterBar`): full-text search with the regex toggle docked inside it, a
 * Filters popover holding the field-scoped rules (author, message, path,
 * excluded message, issue, revision and date ranges), a Views popover for
 * saved views (apply / save / rename / delete / restore built-ins), and an
 * Export menu. Active field filters surface as removable chips under the row,
 * so what the list is being narrowed by stays legible without opening
 * anything. Wired to a `useLogViewState` result, so LogViewer and
 * CommitHistory get identical behaviour.
 */

import { useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  FileJson,
  FileSpreadsheet,
  Funnel,
  History,
  Info,
  Pencil,
  Regex,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { type LogFilterState } from '@renderer/utils/logFilters';
import type { UseLogViewStateResult } from './useLogViewState';
import { Popover } from '../ui/Popover';

export interface LogFilterBarProps {
  /** State from `useLogViewState`. */
  logView: UseLogViewStateResult;
  searchPlaceholder?: string;
  /** Counter wording — "revisions" in LogViewer, "commits" in CommitHistory. */
  countLabel?: string;
}

/** `.eyebrow` — a section label. */
const EYEBROW = 'flex-none text-[10px] font-bold uppercase tracking-[0.13em] text-text-muted';

/** Micro label inside a popover panel. */
const PANEL_EYEBROW =
  'px-2 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.13em] text-text-muted';

/** `.btn` — 32px high, 8px radius, hairline border, 12.5px semibold label. */
const BTN_BASE =
  'inline-flex h-8 flex-none items-center gap-[7px] rounded-lg border px-3 text-[12.5px] font-semibold transition-fast active:translate-y-px';

const BTN_TONE =
  'border-border-strong bg-bg-secondary text-text shadow-card hover:border-text-faint hover:bg-bg-tertiary';

/** A control whose filter is engaged. */
const BTN_ON = 'border-accent/60 bg-accent/10 text-accent hover:border-accent';

/** `.ctx` — popovers reuse the context menu's surface; placement (portaled,
 *  fixed, viewport-flipped) lives in `Popover`. */
const PANEL_SURFACE =
  'rounded-[11px] border border-border-strong bg-bg-secondary p-[5px] shadow-overlay';

/** A popover row. */
const PANEL_ITEM =
  'group flex w-full items-center gap-2.5 rounded-[7px] px-[9px] py-[7px] text-left text-[12.5px] leading-tight text-text hover:bg-accent hover:text-white';

type Panel = 'filters' | 'views' | 'export';

/** Enter inside the text inputs must not submit anything. */
function preventSubmit(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') event.preventDefault();
}

/** One removable chip under the toolbar. */
interface FieldChip {
  key: keyof LogFilterState;
  label: string;
  value: string;
}

/** Text-field chips plus the two combined range chips, in reading order. */
function fieldChips(filters: LogFilterState): FieldChip[] {
  const chips: FieldChip[] = [];
  const textRules: Array<{ key: 'author' | 'message' | 'path' | 'notMessage' | 'issueId'; label: string }> = [
    { key: 'author', label: 'Author' },
    { key: 'message', label: 'Message' },
    { key: 'path', label: 'Path' },
    { key: 'notMessage', label: 'Excluded' },
    { key: 'issueId', label: 'Issue' },
  ];
  for (const rule of textRules) {
    const value = filters[rule.key].trim();
    if (value) chips.push({ key: rule.key, label: rule.label, value });
  }
  if (filters.revisionFrom.trim() || filters.revisionTo.trim()) {
    chips.push({
      key: 'revisionFrom',
      label: 'Revision',
      value:
        filters.revisionFrom.trim() && filters.revisionTo.trim()
          ? `r${filters.revisionFrom.trim()}–r${filters.revisionTo.trim()}`
          : filters.revisionFrom.trim()
            ? `≥ r${filters.revisionFrom.trim()}`
            : `≤ r${filters.revisionTo.trim()}`,
    });
  }
  if (filters.dateFrom.trim() || filters.dateTo.trim()) {
    chips.push({
      key: 'dateFrom',
      label: 'Date',
      value:
        filters.dateFrom.trim() && filters.dateTo.trim()
          ? `${filters.dateFrom.trim()} → ${filters.dateTo.trim()}`
          : filters.dateFrom.trim()
            ? `after ${filters.dateFrom.trim()}`
            : `before ${filters.dateTo.trim()}`,
    });
  }
  return chips;
}

export function LogFilterBar({
  logView,
  searchPlaceholder = 'Search author, message, path…',
  countLabel = 'revisions',
}: LogFilterBarProps) {
  const {
    filters,
    updateFilter,
    clearFilters,
    regexError,
    activeFilterCount,
    views,
    saveCurrentView,
    deleteView,
    renameView,
    restoreDefaultViews,
    exportEntries,
    exportNotice,
    dismissExportNotice,
    filteredEntries,
    totalCount,
  } = logView;

  const [open, setOpen] = useState<Panel | null>(null);
  const [viewName, setViewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const viewsButtonRef = useRef<HTMLButtonElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);

  /** Escape closes the panel, not the surrounding surface. */
  const closePanel = (panel: Panel, restoreFocus = true) => {
    setOpen(null);
    setRenaming(null);
    if (restoreFocus) {
      const refs = { filters: filtersButtonRef, views: viewsButtonRef, export: exportButtonRef };
      refs[panel].current?.focus();
    }
  };

  /*
   * Escape is handled on the wrapper that owns the trigger and the panel, so
   * it dismisses the popover whether focus sits on the trigger or inside the
   * panel — and never reaches a host that would read it as "close me".
   */
  const escapeCloses = (panel: Panel) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open === panel) {
      event.preventDefault();
      event.stopPropagation();
      closePanel(panel);
    }
  };

  const handleSaveView = () => {
    const name = viewName.trim();
    if (!name || regexError) return;
    void saveCurrentView(name).then((saved) => {
      if (saved) setViewName('');
    });
  };

  const commitRename = () => {
    if (!renaming) return;
    const name = renaming.draft.trim();
    const view = views.find((item) => item.id === renaming.id);
    if (view && name && name !== view.name) void renameView(renaming.id, name);
    setRenaming(null);
  };

  const chips = fieldChips(filters);
  const narrowed = activeFilterCount > 0;

  return (
    <div className="flex-shrink-0 border-b border-border bg-bg-secondary px-3.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={EYEBROW}>Filter</span>

        {/* Search with the regex toggle docked into its right edge. */}
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
            aria-hidden="true"
          />
          <input
            type="text"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            onKeyDown={preventSubmit}
            className={`input h-8 pl-8 pr-11 text-xs ${regexError ? 'border-error' : ''}`}
            placeholder={searchPlaceholder}
            aria-label={`Search ${countLabel}`}
            aria-invalid={regexError ? true : undefined}
          />
          <button
            type="button"
            onClick={() => updateFilter('useRegex', !filters.useRegex)}
            aria-pressed={filters.useRegex}
            title="Treat the text filters as regular expressions (case-insensitive)"
            className={`absolute right-1.5 top-1/2 flex h-6 -translate-y-1/2 items-center gap-1 rounded-md border px-1.5 font-mono text-[11px] font-bold transition-fast ${
              filters.useRegex
                ? 'border-accent/60 bg-accent/15 text-accent'
                : 'border-transparent text-text-faint hover:border-border hover:bg-bg-tertiary hover:text-text-secondary'
            }`}
          >
            <Regex className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>

        {/* Field-scoped filters (#66), folded into a popover. */}
        <div className="relative flex-none" onKeyDown={escapeCloses('filters')}>
          <button
            ref={filtersButtonRef}
            type="button"
            onClick={() => (open === 'filters' ? setOpen(null) : setOpen('filters'))}
            className={`${BTN_BASE} ${chips.length > 0 ? BTN_ON : BTN_TONE}`}
            aria-haspopup="true"
            aria-expanded={open === 'filters'}
          >
            <Funnel className="h-3.5 w-3.5" aria-hidden="true" />
            Filters
            {chips.length > 0 && (
              <span className="font-mono text-[10px] font-medium">{chips.length}</span>
            )}
            <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden="true" />
          </button>

          {open === 'filters' && (
            <Popover
              anchorRef={filtersButtonRef}
              ariaLabel="Field filters"
              onClose={() => closePanel('filters')}
              className={PANEL_SURFACE}
            >
              <p className={PANEL_EYEBROW}>Narrow by field</p>
              <div className="grid w-[19rem] grid-cols-2 gap-x-2 gap-y-1.5 px-1 pb-1">
                <FilterField
                  label="Author"
                  value={filters.author}
                  onChange={(value) => updateFilter('author', value)}
                  placeholder="alice"
                />
                <FilterField
                  label="Issue"
                  value={filters.issueId}
                  onChange={(value) => updateFilter('issueId', value)}
                  placeholder="APP-9"
                />
                <FilterField
                  label="Message"
                  className="col-span-2"
                  value={filters.message}
                  onChange={(value) => updateFilter('message', value)}
                  placeholder="message contains…"
                />
                <FilterField
                  label="Path"
                  className="col-span-2"
                  value={filters.path}
                  onChange={(value) => updateFilter('path', value)}
                  placeholder="/trunk/src/…"
                />
                <FilterField
                  label="Exclude message"
                  className="col-span-2"
                  value={filters.notMessage}
                  onChange={(value) => updateFilter('notMessage', value)}
                  placeholder="exclude messages containing…"
                />
                <FilterField
                  label="Revision from"
                  type="number"
                  value={filters.revisionFrom}
                  onChange={(value) => updateFilter('revisionFrom', value)}
                  placeholder="e.g. 100"
                />
                <FilterField
                  label="Revision to"
                  type="number"
                  value={filters.revisionTo}
                  onChange={(value) => updateFilter('revisionTo', value)}
                  placeholder="e.g. 200"
                />
                <FilterField
                  label="Date from"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(value) => updateFilter('dateFrom', value)}
                />
                <FilterField
                  label="Date to"
                  type="date"
                  value={filters.dateTo}
                  onChange={(value) => updateFilter('dateTo', value)}
                />
              </div>
              {chips.length > 0 && (
                <>
                  <div className="divider my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      for (const chip of chips) {
                        updateFilter(chip.key, '');
                        if (chip.key === 'revisionFrom') updateFilter('revisionTo', '');
                        if (chip.key === 'dateFrom') updateFilter('dateTo', '');
                      }
                    }}
                    className={`${PANEL_ITEM} text-text-muted hover:text-white`}
                  >
                    <RotateCcw className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                    Clear field filters
                  </button>
                </>
              )}
            </Popover>
          )}
        </div>

        {/* Saved views (#67) */}
        <div className="relative flex-none" onKeyDown={escapeCloses('views')}>
          <button
            ref={viewsButtonRef}
            type="button"
            onClick={() => (open === 'views' ? setOpen(null) : setOpen('views'))}
            className={BTN_BASE + ' ' + BTN_TONE}
            aria-haspopup="true"
            aria-expanded={open === 'views'}
          >
            <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
            Views
            <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden="true" />
          </button>

          {open === 'views' && (
            <Popover
              anchorRef={viewsButtonRef}
              ariaLabel="Saved views"
              onClose={() => closePanel('views')}
              className={PANEL_SURFACE}
            >
              <p className={PANEL_EYEBROW}>Apply a view</p>
              {views.length === 0 ? (
                <p className="px-2 pb-1.5 text-[11.5px] leading-snug text-text-faint">
                  No saved views yet — set some filters, then save them below.
                </p>
              ) : (
                <div className="max-h-56 w-[21rem] overflow-y-auto py-0.5">
                  {views.map((view) =>
                    renaming?.id === view.id ? (
                      <input
                        key={view.id}
                        autoFocus
                        value={renaming.draft}
                        onChange={(event) =>
                          setRenaming({ id: view.id, draft: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitRename();
                          } else if (event.key === 'Escape') {
                            event.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                        onBlur={commitRename}
                        aria-label={`New name for ${view.name}`}
                        className="input my-0.5 h-7 px-2 text-xs"
                      />
                    ) : (
                      <div key={view.id} className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            logView.applyView(view);
                            closePanel('views');
                          }}
                          className={`${PANEL_ITEM} min-w-0 flex-1`}
                          title={`Apply ${view.name}`}
                        >
                          <span className="truncate">{view.name}</span>
                          {view.builtin && (
                            <span className="ml-auto flex-none rounded border border-border bg-bg-tertiary px-1 font-mono text-[9px] uppercase text-text-faint group-hover:border-white/30 group-hover:text-white/80">
                              built-in
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenaming({ id: view.id, draft: view.name })}
                          aria-label={`Rename view ${view.name}`}
                          title="Rename this view"
                          className="btn-icon-sm flex-none rounded-[7px]"
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteView(view.id)}
                          aria-label={`Delete view ${view.name}`}
                          title="Delete this view"
                          className="btn-icon-sm flex-none rounded-[7px] hover:text-error"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}

              <div className="divider my-1" />
              <p className={PANEL_EYEBROW}>Save current filters</p>
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <input
                  type="text"
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  onKeyDown={(event) => {
                    preventSubmit(event);
                    if (event.key === 'Enter') handleSaveView();
                  }}
                  className="input h-8 px-2.5 text-xs"
                  placeholder="Name this view"
                  aria-label="New view name"
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm flex-none text-xs"
                  onClick={handleSaveView}
                  disabled={viewName.trim() === '' || regexError !== null}
                  title={
                    regexError
                      ? 'Fix the invalid regex before saving a view'
                      : 'Save the current filters and sort under this name'
                  }
                >
                  <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Save view
                </button>
              </div>

              <div className="divider my-1" />
              <button
                type="button"
                onClick={() => void restoreDefaultViews()}
                className={`${PANEL_ITEM} text-text-muted hover:text-white`}
                title="Restore the built-in views (My commits, Last 7 days, Merge-free)"
              >
                <History className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                Restore built-in views
              </button>
            </Popover>
          )}
        </div>

        {/* Export of the current result set */}
        <div className="relative flex-none" onKeyDown={escapeCloses('export')}>
          <button
            ref={exportButtonRef}
            type="button"
            onClick={() => (open === 'export' ? setOpen(null) : setOpen('export'))}
            className={BTN_BASE + ' ' + BTN_TONE}
            aria-haspopup="menu"
            aria-expanded={open === 'export'}
            title="Export the current filtered result set"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
            Export
            <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden="true" />
          </button>

          {open === 'export' && (
            <Popover
              anchorRef={exportButtonRef}
              ariaLabel="Export"
              role="menu"
              onClose={() => closePanel('export')}
              className={PANEL_SURFACE}
            >
              <button
                type="button"
                role="menuitem"
                className={PANEL_ITEM}
                disabled={filteredEntries.length === 0}
                onClick={() => {
                  void exportEntries('csv');
                  closePanel('export');
                }}
              >
                <FileSpreadsheet className="h-4 w-4 flex-none" aria-hidden="true" />
                Export CSV
              </button>
              <button
                type="button"
                role="menuitem"
                className={PANEL_ITEM}
                disabled={filteredEntries.length === 0}
                onClick={() => {
                  void exportEntries('json');
                  closePanel('export');
                }}
              >
                <FileJson className="h-4 w-4 flex-none" aria-hidden="true" />
                Export JSON
              </button>
            </Popover>
          )}
        </div>

        {/* Result count — mono, filtered over loaded when narrowed. */}
        <span
          className="ml-auto flex-none font-mono text-[11px] tabular-nums text-text-muted"
          title={`${filteredEntries.length} of ${totalCount ?? filteredEntries.length} loaded ${countLabel} match the current filters`}
        >
          {narrowed && totalCount !== undefined && filteredEntries.length !== totalCount ? (
            <>
              <span className="text-accent">{filteredEntries.length}</span>
              <span className="mx-1 text-text-faint">/</span>
              {totalCount}{' '}
            </>
          ) : (
            <>{filteredEntries.length} </>
          )}
          {countLabel}
        </span>
      </div>

      {/* Active filters as removable chips. The search text is already
          visible in the input; the button clears it along with the rest. */}
      {(chips.length > 0 || narrowed) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-bg-tertiary py-0.5 pl-2.5 pr-1 text-[11px] leading-none text-text-secondary"
            >
              <span className="truncate">
                <span className="font-semibold text-text-faint">{chip.label}</span>{' '}
                <span className="font-mono">{chip.value}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  updateFilter(chip.key, '');
                  if (chip.key === 'revisionFrom') updateFilter('revisionTo', '');
                  if (chip.key === 'dateFrom') updateFilter('dateTo', '');
                }}
                aria-label={`Remove ${chip.label.toLowerCase()} filter`}
                className="grid h-4 w-4 flex-none place-items-center rounded-full text-text-faint transition-fast hover:bg-error/15 hover:text-error"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </span>
          ))}
          {narrowed && (
            <button
              type="button"
              onClick={clearFilters}
              aria-label="Clear all filters"
              className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-text-muted transition-fast hover:bg-bg-tertiary hover:text-error"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      )}

      {regexError && (
        <p
          className="mt-2 flex items-center gap-1.5 text-xs text-error"
          role="alert"
          title="Fix the pattern or turn the regex toggle off"
        >
          <AlertCircle className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
          Invalid regex — this filter is inactive until fixed:{' '}
          <code className="font-mono">{regexError}</code>
        </p>
      )}

      {exportNotice && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary" role="status">
          <Info className="h-3.5 w-3.5 flex-none text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={exportNotice}>
            {exportNotice}
          </span>
          <button
            type="button"
            className="btn-icon-sm"
            onClick={dismissExportNotice}
            aria-label="Dismiss export message"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </p>
      )}
    </div>
  );
}

function FilterField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'date' | 'number' | 'text';
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-text-faint">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={preventSubmit}
        className="input h-8 px-2.5 text-xs"
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}
