/**
 * LogFilterBar (#66/#67) — the shared filter bar for log surfaces.
 *
 * Row 1: full-text search with the regex toggle (invalid regex shows an inline
 * error and disables saving views until fixed), saved-view management, and
 * CSV/JSON export of the current result set. Row 2: field-scoped filters —
 * author, message, path, excluded message, issue id, revision range, date
 * range. Wired to a `useLogViewState` result, so both LogViewer and
 * CommitHistory get identical behaviour.
 */

import { useState, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  Download,
  FileJson,
  FileSpreadsheet,
  Filter,
  Info,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { type LogFilterState } from '@renderer/utils/logFilters';
import type { SavedLogView } from '@renderer/lib/logViews';
import type { LogExportFormat } from '@renderer/lib/logExport';
import type { UseLogViewStateResult } from './useLogViewState';

export interface LogFilterBarProps {
  /** State from `useLogViewState`. */
  logView: UseLogViewStateResult;
  searchPlaceholder?: string;
  /** Counter wording — "revisions" in LogViewer, "commits" in CommitHistory. */
  countLabel?: string;
}

/** Enter inside the text inputs must not submit anything. */
function preventSubmit(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') event.preventDefault();
}

export function LogFilterBar({
  logView,
  searchPlaceholder = 'Search author, message, path…',
  countLabel = 'revisions',
}: LogFilterBarProps) {
  const {
    filters,
    setFilters,
    clearFilters,
    regexError,
    activeFilterCount,
    views,
    saveCurrentView,
    applyView,
    deleteView,
    renameView,
    restoreDefaultViews,
    exportEntries,
    exportNotice,
    dismissExportNotice,
    filteredEntries,
  } = logView;

  const [viewName, setViewName] = useState('');
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const selectedView = views.find((view) => view.id === selectedViewId) ?? null;

  const updateText = (name: keyof LogFilterState, value: string) => {
    setFilters({ ...filters, [name]: value });
  };

  const handleViewSelect = (view: SavedLogView | null) => {
    setSelectedViewId(view?.id ?? null);
    setViewName(view?.name ?? '');
    if (view) applyView(view);
  };

  const handleSaveView = () => {
    const name = viewName.trim();
    if (!name || regexError) return;
    void saveCurrentView(name).then((saved) => {
      if (saved) setSelectedViewId(saved.id);
    });
  };

  const handleRenameView = () => {
    if (!selectedView) return;
    const name = viewName.trim();
    if (!name || name === selectedView.name) return;
    void renameView(selectedView.id, name);
  };

  const handleDeleteView = () => {
    if (!selectedView) return;
    const id = selectedView.id;
    setSelectedViewId(null);
    setViewName('');
    void deleteView(id);
  };

  const handleExport = (format: LogExportFormat) => {
    void exportEntries(format);
  };

  return (
    <div className="flex-shrink-0 border-b border-border bg-bg-secondary px-4 py-3">
      {/* Search + regex + views + export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
            aria-hidden="true"
          />
          <input
            type="text"
            value={filters.search}
            onChange={(event) => updateText('search', event.target.value)}
            onKeyDown={preventSubmit}
            className={`input h-8 pl-7 text-xs ${regexError ? 'border-error' : ''}`}
            placeholder={searchPlaceholder}
            aria-label={`Search ${countLabel}`}
            aria-invalid={regexError ? true : undefined}
          />
        </div>

        <label
          className="flex items-center gap-1 text-xs text-text-secondary"
          title="Treat the text filters as regular expressions (case-insensitive)"
        >
          <input
            type="checkbox"
            checked={filters.useRegex}
            onChange={(event) => setFilters({ ...filters, useRegex: event.target.checked })}
          />
          <span aria-hidden="true" className="font-mono">
            .*
          </span>
          Regex
        </label>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="btn btn-secondary btn-sm text-xs"
            title="Clear all filters"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </button>
        )}

        <span className="ml-auto flex items-center gap-2 text-xs text-text-muted tabular-nums">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          {activeFilterCount > 0 && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{activeFilterCount}</span>
          )}
          {filteredEntries.length} {countLabel}
        </span>

        <button
          type="button"
          className="btn btn-secondary btn-sm text-xs"
          onClick={() => handleExport('csv')}
          disabled={filteredEntries.length === 0}
          title="Export the current filtered result set as CSV"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
          CSV
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm text-xs"
          onClick={() => handleExport('json')}
          disabled={filteredEntries.length === 0}
          title="Export the current filtered result set as JSON"
        >
          <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
          JSON
        </button>
      </div>

      {regexError && (
        <p
          className="mt-2 flex items-center gap-1.5 text-xs text-error"
          role="alert"
          title="Fix the pattern or turn the regex toggle off"
        >
          <AlertCircle className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
          Invalid regex — this filter is inactive until fixed: <code className="font-mono">{regexError}</code>
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

      {/* Saved views (#67) */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className="input h-8 min-w-36 flex-none text-xs"
          value={selectedViewId ?? ''}
          onChange={(event) =>
            handleViewSelect(views.find((view) => view.id === event.target.value) ?? null)
          }
          aria-label="Saved log views"
          title="Apply a saved view"
        >
          <option value="">Saved views…</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
              {view.builtin ? ' (built-in)' : ''}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={viewName}
          onChange={(event) => setViewName(event.target.value)}
          onKeyDown={preventSubmit}
          className="input h-8 w-44 flex-none text-xs"
          placeholder="View name"
          aria-label="Saved view name"
          disabled={views.length === 0 && !selectedViewId}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm text-xs"
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
        {selectedView && (
          <>
            <button
              type="button"
              className="btn-icon-sm"
              onClick={handleRenameView}
              disabled={viewName.trim() === '' || viewName.trim() === selectedView.name}
              aria-label={`Rename view ${selectedView.name}`}
              title="Rename the selected view to the typed name"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon-sm"
              onClick={handleDeleteView}
              aria-label={`Delete view ${selectedView.name}`}
              title="Delete the selected view"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-icon-sm"
          onClick={() => void restoreDefaultViews()}
          aria-label="Restore default views"
          title="Restore the built-in views (My commits, Last 7 days, Merge-free)"
        >
          <Download className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
        </button>
      </div>

      {/* Field-scoped filters (#66) */}
      <div className="mt-2 grid grid-cols-3 gap-2 lg:grid-cols-5">
        <FilterInput
          label="Author"
          value={filters.author}
          onChange={(value) => updateText('author', value)}
          placeholder="author"
        />
        <FilterInput
          label="Message"
          value={filters.message}
          onChange={(value) => updateText('message', value)}
          placeholder="message"
        />
        <FilterInput
          label="Path"
          value={filters.path}
          onChange={(value) => updateText('path', value)}
          placeholder="path"
        />
        <FilterInput
          label="Not message"
          value={filters.notMessage}
          onChange={(value) => updateText('notMessage', value)}
          placeholder="exclude messages"
        />
        <FilterInput
          label="Issue"
          value={filters.issueId}
          onChange={(value) => updateText('issueId', value)}
          placeholder="issue ID"
        />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <FilterInput
          label="Revision from"
          type="number"
          value={filters.revisionFrom}
          onChange={(value) => updateText('revisionFrom', value)}
          placeholder="rev from"
        />
        <FilterInput
          label="Revision to"
          type="number"
          value={filters.revisionTo}
          onChange={(value) => updateText('revisionTo', value)}
          placeholder="rev to"
        />
        <FilterInput
          label="Date from"
          type="date"
          value={filters.dateFrom}
          onChange={(value) => updateText('dateFrom', value)}
        />
        <FilterInput
          label="Date to"
          type="date"
          value={filters.dateTo}
          onChange={(value) => updateText('dateTo', value)}
        />
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'date' | 'number' | 'text';
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`input h-8 text-xs ${type === 'text' ? 'pl-2.5' : ''}`}
          placeholder={placeholder || label}
          aria-label={label}
        />
      </div>
    </label>
  );
}
