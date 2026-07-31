/**
 * The navigation bar above the four panes: history controls, the address bar,
 * the folder filter with its scope toggle, and the two directory actions.
 *
 * Design source: `prototypes/12-browser.html` — `.navbar`, `.navgroup`, `.btn`,
 * `.foldersearch`, `.scopetog` and the `#scopetog` handler.
 *
 * The scope toggle matters more than its size suggests: filtering *this folder*
 * and searching *the whole repository* are different operations with different
 * costs, and the control says which one is armed rather than guessing.
 *
 * Presentational only: every handler and every disabled state arrives as a prop.
 */

import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderPlus,
  PanelRight,
  PanelRightClose,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { SearchScope } from '../types';

export interface RepoNavBarProps {
  /* ── history ── */
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  /** Spins the refresh icon and disables the button while a listing is in flight. */
  isRefreshing?: boolean;

  /** The `RepoAddressBar`, injected so this bar stays free of path logic. */
  addressBar: ReactNode;

  /* ── filter ── */
  filterText: string;
  onFilterTextChange: (value: string) => void;
  searchScope: SearchScope;
  onSearchScopeChange: (scope: SearchScope) => void;
  /**
   * Total paths in the repository, used in the whole-repo placeholder
   * ("Search all 512,000 paths"). Omit when unknown.
   */
  repositoryPathCount?: number;
  /** Lets the route focus the filter from a keyboard shortcut. */
  filterInputRef?: Ref<HTMLInputElement>;

  /* ── actions ── */
  onCheckout: () => void;
  onNewFolder: () => void;
  /** Creating a folder needs a writable destination; disable when there isn't one. */
  canCreateFolder?: boolean;
  /**
   * Show or hide the detail pane. Omit to leave the control out entirely — the
   * bar has no opinion about whether a host app has a detail pane at all.
   */
  onToggleDetail?: () => void;
  /** Whether the detail pane is currently on screen, for the button's state. */
  detailVisible?: boolean;

  /**
   * Modifier symbol used in the shortcut hints of button tooltips. `⌘` on macOS,
   * `Ctrl` elsewhere — the shell knows the platform, this component does not.
   */
  modifierKey?: string;

  className?: string;
}

const ICON_BUTTON =
  'flex h-8 w-[30px] flex-none items-center justify-center rounded-lg border border-border bg-bg text-text-secondary shadow-card transition-colors hover:border-text-faint hover:bg-bg-tertiary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-bg disabled:hover:text-text-secondary';

const TEXT_BUTTON =
  'inline-flex h-8 flex-none items-center gap-[7px] rounded-lg border border-border bg-bg px-3 text-[12.5px] font-semibold text-text shadow-card transition-colors hover:border-text-faint hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40';

export function RepoNavBar({
  canGoBack,
  canGoForward,
  canGoUp,
  onBack,
  onForward,
  onUp,
  onRefresh,
  isRefreshing = false,
  addressBar,
  filterText,
  onFilterTextChange,
  searchScope,
  onSearchScopeChange,
  repositoryPathCount,
  filterInputRef,
  onCheckout,
  onNewFolder,
  canCreateFolder = true,
  onToggleDetail,
  detailVisible = true,
  modifierKey = '⌘',
  className,
}: RepoNavBarProps): JSX.Element {
  const wholeRepo = searchScope === 'repository';

  const filterPlaceholder = wholeRepo
    ? repositoryPathCount === undefined
      ? 'Search every path in the repository'
      : `Search all ${repositoryPathCount.toLocaleString()} paths`
    : 'Filter';

  const scopeLabel = wholeRepo ? 'whole repo' : 'this folder';

  return (
    <div
      className={[
        'flex flex-none items-center gap-2 border-b border-border bg-bg px-3.5 py-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex flex-none gap-[3px]">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Back"
          title={`Back  ${modifierKey}[`}
          className={ICON_BUTTON}
        >
          <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Forward"
          title={`Forward  ${modifierKey}]`}
          className={ICON_BUTTON}
        >
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onUp}
          disabled={!canGoUp}
          aria-label="Parent folder"
          title={`Parent folder  ${modifierKey}↑`}
          className={ICON_BUTTON}
        >
          <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh listing"
          title="Refresh listing"
          className={ICON_BUTTON}
        >
          <RefreshCw
            aria-hidden="true"
            className={['h-3.5 w-3.5', isRefreshing ? 'animate-spin' : ''].filter(Boolean).join(' ')}
          />
        </button>
      </div>

      {addressBar}

      <div className="flex h-8 w-[236px] flex-none items-center gap-2 rounded-lg border border-border bg-bg-secondary px-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
        <Search aria-hidden="true" className="h-3.5 w-3.5 flex-none text-text-muted" />
        <input
          ref={filterInputRef}
          type="search"
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
          placeholder={filterPlaceholder}
          aria-label={wholeRepo ? 'Search the whole repository' : 'Filter this folder'}
          spellCheck={false}
          className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-text outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="button"
          onClick={() => onSearchScopeChange(wholeRepo ? 'folder' : 'repository')}
          aria-pressed={wholeRepo}
          aria-label={`Search scope: ${scopeLabel}. Switch to ${wholeRepo ? 'this folder' : 'whole repo'}.`}
          title="Search scope"
          className={[
            'flex-none rounded-[5px] border px-1.5 py-0.5 font-mono text-[9.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            wholeRepo
              ? 'border-accent/40 bg-accent/15 text-accent'
              : 'border-border bg-bg-tertiary text-text-muted hover:text-text',
          ].join(' ')}
        >
          {scopeLabel}
        </button>
      </div>

      <button type="button" onClick={onCheckout} className={TEXT_BUTTON}>
        <Download aria-hidden="true" className="h-3.5 w-3.5 text-text-secondary" />
        Checkout…
      </button>
      <button
        type="button"
        onClick={onNewFolder}
        disabled={!canCreateFolder}
        aria-label="New folder"
        title="New folder"
        className={ICON_BUTTON}
      >
        <FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {onToggleDetail && (
        <button
          type="button"
          onClick={onToggleDetail}
          aria-pressed={detailVisible}
          aria-label={detailVisible ? 'Hide the detail pane' : 'Show the detail pane'}
          title={detailVisible ? 'Hide the detail pane' : 'Show the detail pane'}
          className={ICON_BUTTON}
        >
          {detailVisible ? (
            <PanelRightClose aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <PanelRight aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
