/**
 * The commit dialog's single diff toolbar.
 *
 * The pane used to stack three control bands: a path-only header with its own
 * Unified/Split pair and a bare "Explain" dropdown, the embedded viewer's
 * toolbar with a *second* Unified/Split pair plus stats, whitespace options
 * and search, and then the viewer's per-file path header repeating the path a
 * third time. Every one of those controls now lives here once — both viewers
 * render with `showToolbar={false}` / `showFileHeaders={false}` inside the
 * dialog and are driven by these props.
 *
 * Reading order matches how the pane is used: what file you are looking at,
 * how big the change is, then how to look at it, then what to ask the AI.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlignLeft,
  Check,
  ChevronDown,
  Columns2,
  Lightbulb,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { AiDiffExplanationMode, SvnStatusChar } from '@shared/types';
import type { DiffDisplayOptions } from '../../lib/diffOptions';
import type { DiffViewMode } from '../ui/EnhancedDiffViewer';
import { Popover } from '../ui/Popover';
import { STATUS_CONFIG } from './commitStatusConfig';

/** The explanation kinds, in the order the menu offers them. */
export const EXPLANATION_MODES: Array<{
  id: AiDiffExplanationMode;
  label: string;
  hint: string;
}> = [
  { id: 'summary', label: 'Summarize file', hint: 'What this change does' },
  { id: 'why', label: 'Why it changed', hint: 'The intent behind the edit' },
  { id: 'risks', label: 'Risky lines', hint: 'What could break' },
  {
    id: 'questions',
    label: 'Review questions',
    hint: 'What a reviewer should ask',
  },
];

export function explanationModeLabel(mode: AiDiffExplanationMode): string {
  return EXPLANATION_MODES.find((entry) => entry.id === mode)?.label ?? 'Explanation';
}

const PANEL_SURFACE =
  'rounded-[11px] border border-border-strong bg-bg-secondary p-[5px] shadow-overlay';

const PANEL_ITEM =
  'group flex w-full items-center gap-2.5 rounded-[7px] px-[9px] py-[7px] text-left text-12 leading-tight text-text hover:bg-accent hover:text-white';

interface CommitDiffToolbarProps {
  filePath: string;
  status?: SvnStatusChar;
  additions: number;
  deletions: number;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  displayOptions: DiffDisplayOptions;
  onDisplayOptionsChange: (options: DiffDisplayOptions) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  /** False in the modes rendered by the virtualized viewer, which has no search. */
  searchSupported: boolean;
  searchMatchCount: number;
  searchMatchIndex: number;
  /** Why search is off, shown on the disabled control. */
  searchUnavailableReason?: string;
  explanationMode: AiDiffExplanationMode;
  onExplain: (mode: AiDiffExplanationMode) => void;
  explainDisabled: boolean;
  explainDisabledReason?: string;
  isExplaining: boolean;
}

type Panel = 'explain' | 'options';

export function CommitDiffToolbar({
  filePath,
  status,
  additions,
  deletions,
  viewMode,
  onViewModeChange,
  displayOptions,
  onDisplayOptionsChange,
  searchQuery,
  onSearchQueryChange,
  searchSupported,
  searchMatchCount,
  searchMatchIndex,
  searchUnavailableReason,
  explanationMode,
  onExplain,
  explainDisabled,
  explainDisabledReason,
  isExplaining,
}: CommitDiffToolbarProps) {
  const [open, setOpen] = useState<Panel | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const explainButtonRef = useRef<HTMLButtonElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const directory = filePath.slice(0, Math.max(0, filePath.length - fileName.length - 1));
  const statusInfo = status ? STATUS_CONFIG[status] : undefined;
  const optionCount = Number(displayOptions.ignoreWhitespace) + Number(displayOptions.ignoreEol);

  const closePanel = (panel: Panel) => {
    setOpen(null);
    (panel === 'explain' ? explainButtonRef : optionsButtonRef).current?.focus();
  };

  /* Escape dismisses the popover, not the dialog around it. */
  const escapeCloses = (panel: Panel) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open === panel) {
      event.preventDefault();
      event.stopPropagation();
      closePanel(panel);
    }
  };

  const showSearchField = searchSupported && (searchOpen || searchQuery !== '');

  /*
   * `autoFocus` would scroll the field into view, and the modal — despite its
   * `overflow-hidden` — can be scrolled programmatically, which drags the
   * whole dialog sideways when the side-by-side diff is wider than the pane.
   */
  useEffect(() => {
    if (searchOpen && showSearchField) searchInputRef.current?.focus({ preventScroll: true });
  }, [searchOpen, showSearchField]);

  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-bg-tertiary px-3 py-1.5">
      {/* Which file — the list shows the same letter, so it reads as the same row. */}
      {statusInfo && (
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-4 bg-bg-sunk font-mono text-10 font-semibold ${statusInfo.color}`}
          title={statusInfo.label}
          aria-label={statusInfo.label}
        >
          {status}
        </span>
      )}
      <div className="flex min-w-0 items-baseline gap-1.5" title={filePath}>
        <span className="shrink-0 text-12 font-medium text-text">{fileName}</span>
        {directory && <span className="truncate text-10.5 text-text-faint">{directory}</span>}
      </div>

      {/* How big */}
      <div className="ml-1 flex shrink-0 items-center gap-2 font-mono text-10.5">
        <span className="text-success">+{additions}</span>
        <span className="text-error">-{deletions}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* Ask the AI about this file. One control: the button runs the last
            mode, the caret picks a different question and runs it. */}
        <div
          className="flex items-stretch overflow-hidden rounded-md border border-accent/30 bg-accent/10"
          onKeyDown={escapeCloses('explain')}
        >
          <button
            type="button"
            onClick={() => onExplain(explanationMode)}
            disabled={explainDisabled}
            title={explainDisabledReason ?? `${explanationModeLabel(explanationMode)} with AI`}
            aria-disabled={explainDisabled}
            className="flex items-center gap-1.5 px-2 py-1 text-11 font-medium text-accent transition-fast hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExplaining ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Explain
          </button>
          <button
            ref={explainButtonRef}
            type="button"
            onClick={() => setOpen(open === 'explain' ? null : 'explain')}
            disabled={explainDisabled}
            className="border-l border-accent/25 px-1 text-accent transition-fast hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={open === 'explain'}
            aria-label="Choose what to explain"
          >
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          {open === 'explain' && (
            <Popover
              anchorRef={explainButtonRef}
              ariaLabel="Explanation type"
              role="menu"
              onClose={() => closePanel('explain')}
              className={PANEL_SURFACE}
            >
              <div className="w-[15rem]">
                {EXPLANATION_MODES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    className={PANEL_ITEM}
                    onClick={() => {
                      setOpen(null);
                      onExplain(entry.id);
                    }}
                  >
                    <Check
                      className={`h-3.5 w-3.5 shrink-0 text-accent group-hover:text-white ${
                        entry.id === explanationMode ? '' : 'invisible'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{entry.label}</span>
                      <span className="block truncate text-10.5 text-text-faint group-hover:text-white/70">
                        {entry.hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {/* How to look at it */}
        <div
          className="flex items-center rounded-md bg-bg p-0.5"
          role="group"
          aria-label="Diff view mode"
        >
          <button
            type="button"
            onClick={() => onViewModeChange('unified')}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-11 transition-fast ${
              viewMode === 'unified'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text'
            }`}
            aria-pressed={viewMode === 'unified'}
            title="Unified diff view"
          >
            <AlignLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Unified
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('side-by-side')}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-11 transition-fast ${
              viewMode === 'side-by-side'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text'
            }`}
            aria-pressed={viewMode === 'side-by-side'}
            title="Side-by-side diff view"
          >
            <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
            Split
          </button>
        </div>

        {/* Whitespace options — two checkboxes that were permanently taking up
            toolbar width for a setting most commits never touch. */}
        <div className="relative" onKeyDown={escapeCloses('options')}>
          <button
            ref={optionsButtonRef}
            type="button"
            onClick={() => setOpen(open === 'options' ? null : 'options')}
            className={`btn btn-sm text-11 ${
              optionCount > 0
                ? 'border border-accent/40 bg-accent/10 text-accent'
                : 'btn-secondary text-text-secondary'
            }`}
            aria-haspopup="dialog"
            aria-expanded={open === 'options'}
            aria-label="Diff comparison options"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {optionCount > 0 && <span className="font-mono text-10">{optionCount}</span>}
          </button>
          {open === 'options' && (
            <Popover
              anchorRef={optionsButtonRef}
              ariaLabel="Diff comparison options"
              role="dialog"
              onClose={() => closePanel('options')}
              className={PANEL_SURFACE}
            >
              <div className="w-[14rem] px-2 py-1.5">
                <p className="pb-1.5 text-10 font-bold uppercase tracking-caps text-text-muted">
                  Ignore when comparing
                </p>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-12 text-text">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={displayOptions.ignoreWhitespace}
                    onChange={() =>
                      onDisplayOptionsChange({
                        ...displayOptions,
                        ignoreWhitespace: !displayOptions.ignoreWhitespace,
                      })
                    }
                  />
                  Whitespace
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-12 text-text">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={displayOptions.ignoreEol}
                    onChange={() =>
                      onDisplayOptionsChange({
                        ...displayOptions,
                        ignoreEol: !displayOptions.ignoreEol,
                      })
                    }
                  />
                  Line endings
                </label>
              </div>
            </Popover>
          )}
        </div>

        {/* Search collapses to its icon until asked for; the query keeps it
            open so a live filter is never hidden behind a button. */}
        {showSearchField ? (
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                // Inside the commit form, Enter must not start a commit.
                if (event.key === 'Enter') event.preventDefault();
                if (event.key === 'Escape' && searchQuery === '') {
                  event.stopPropagation();
                  setSearchOpen(false);
                }
              }}
              onBlur={() => {
                if (searchQuery === '') setSearchOpen(false);
              }}
              placeholder="Search diff…"
              aria-label="Search diff"
              className="input h-7 w-40 py-0 pl-7 pr-12 text-11"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {searchQuery !== '' && (
                <span className="font-mono text-10 text-text-muted">
                  {searchMatchCount === 0 ? '0' : `${searchMatchIndex + 1}/${searchMatchCount}`}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  onSearchQueryChange('');
                  setSearchOpen(false);
                }}
                className="btn-icon-sm p-0.5"
                aria-label="Clear diff search"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            disabled={!searchSupported}
            className="btn btn-secondary btn-sm text-11"
            title={
              searchSupported
                ? 'Search this diff'
                : (searchUnavailableReason ?? 'Search is unavailable for this diff')
            }
            aria-label="Search diff"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
