/**
 * The address bar: breadcrumbs, click-to-edit URL entry and the peg-revision button.
 *
 * Design source: `prototypes/12-browser.html` — `.address`, `.crumbs`, `.crumb`,
 * `.addrinput`, `.revbtn` and `renderCrumbs()`.
 *
 * Two behaviours carry real weight:
 *
 * 1. **Deep paths collapse in the middle.** Monorepo paths are long; letting them
 *    scroll or shrink the bar was a real bug. Root + first segment + `…` + the last
 *    three segments, with the elided middle in the `…` button's `title`.
 * 2. **A non-HEAD peg tints the whole bar.** `^/clients/acme@r4200` is a different
 *    repository than `^/clients/acme@HEAD`, and forgetting you are in the past is
 *    the classic way to file a confused bug report. The tint is not decoration.
 *
 * Presentational only: no fetching, no router.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { FolderGit2 } from 'lucide-react';
import type { PegRevision } from '../types';

/** One breadcrumb: the label shown and the repository-relative path it goes to. */
export interface RepoCrumb {
  /** Text on the crumb. The root crumb uses the repository name. */
  label: string;
  /** Repository-relative path, no leading slash. `''` is the repository root. */
  path: string;
}

/** Imperative handle so a parent can put the bar into edit mode (⌘L / Ctrl+L). */
export interface RepoAddressBarHandle {
  /** Enter edit mode and select the whole URL. */
  beginEdit: () => void;
  /** Leave edit mode, discarding any typing. */
  cancelEdit: () => void;
}

export interface RepoAddressBarProps {
  /** Current repository-relative path, no leading slash. `''` is the root. */
  path: string;
  /** Label for the root crumb — the repository's short name, e.g. `atlas`. */
  repositoryName: string;
  /**
   * Full repository URL, e.g. `svn://svn.lineindustries.com/atlas`. Used only to
   * accept a pasted absolute URL in edit mode; the bar always *displays* `^/`.
   */
  repositoryUrl?: string;
  /** Navigate to a repository-relative path. `''` means the root. */
  onNavigate: (path: string) => void;

  /** Peg revision the whole browser is pinned to. */
  peg: PegRevision;
  /** Open the revision picker. The bar never changes the peg itself. */
  onPegClick: () => void;
  /** Server HEAD, shown beside `HEAD` when known. */
  headRevision?: number;

  /** Controlled edit mode. Omit to let the bar manage it and drive it via the ref. */
  editing?: boolean;
  /** Called whenever edit mode should open or close. */
  onEditingChange?: (editing: boolean) => void;

  /** Right-click on a crumb — for the same context menu the tree and list use. */
  onCrumbContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>, crumb: RepoCrumb) => void;

  className?: string;
}

/** Keep the root and the last three segments; everything between hides behind `…`. */
const TAIL_SEGMENTS = 3;
const COLLAPSE_THRESHOLD = 4;

/** `^/some/path` — the canonical SVN shorthand, and what the input holds. */
function toRepoUrlShorthand(path: string): string {
  return `^/${path}`;
}

/**
 * Accept anything a person might paste: `^/a/b`, `/a/b`, `a/b/`, or the full
 * `svn://host/repo/a/b`. Returns a clean repository-relative path.
 */
function parseAddressInput(raw: string, repositoryUrl?: string): string {
  let value = raw.trim();
  if (repositoryUrl) {
    const base = repositoryUrl.replace(/\/+$/, '');
    if (value === base) return '';
    if (value.startsWith(`${base}/`)) value = value.slice(base.length + 1);
  }
  // Any other absolute URL: drop scheme://host/firstSegment, the usual repo root.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/[^/]+\/?/i, '');
  value = value.replace(/^\^/, '');
  return value.replace(/^\/+|\/+$/g, '');
}

function pegLabel(peg: PegRevision): string {
  switch (peg.kind) {
    case 'revision':
      return `r${peg.revision}`;
    case 'date':
      return `{${peg.date}}`;
    default:
      return 'HEAD';
  }
}

function pegDescription(peg: PegRevision, headRevision?: number): string {
  switch (peg.kind) {
    case 'revision':
      return `Browsing at revision r${peg.revision} — this is the past, not HEAD. Choose another revision.`;
    case 'date':
      return `Browsing at date {${peg.date}} — this is the past, not HEAD. Choose another revision.`;
    default:
      return headRevision === undefined
        ? 'Browsing at HEAD. Choose a revision to browse the past.'
        : `Browsing at HEAD (r${headRevision}). Choose a revision to browse the past.`;
  }
}

interface CrumbPlan {
  head: RepoCrumb[];
  /** Segment names hidden behind the `…` button; empty when nothing is elided. */
  elided: string[];
  tail: RepoCrumb[];
}

function planCrumbs(path: string): CrumbPlan {
  const segments = path ? path.split('/').filter(Boolean) : [];
  const crumbs: RepoCrumb[] = segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join('/'),
  }));

  if (crumbs.length <= COLLAPSE_THRESHOLD) {
    return { head: crumbs, elided: [], tail: [] };
  }
  return {
    head: crumbs.slice(0, 1),
    elided: crumbs.slice(1, -TAIL_SEGMENTS).map((crumb) => crumb.label),
    tail: crumbs.slice(-TAIL_SEGMENTS),
  };
}

const CRUMB_BASE =
  'inline-flex h-6 max-w-[10rem] flex-none items-center rounded-md px-[7px] font-mono text-[11.5px] whitespace-nowrap text-text-secondary hover:bg-bg-tertiary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export const RepoAddressBar = forwardRef<RepoAddressBarHandle, RepoAddressBarProps>(
  function RepoAddressBar(
    {
      path,
      repositoryName,
      repositoryUrl,
      onNavigate,
      peg,
      onPegClick,
      headRevision,
      editing,
      onEditingChange,
      onCrumbContextMenu,
      className,
    },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const inputId = useId();
    const [uncontrolledEditing, setUncontrolledEditing] = useState(false);
    const isEditing = editing ?? uncontrolledEditing;

    const [draft, setDraft] = useState(() => toRepoUrlShorthand(path));

    const setEditing = useCallback(
      (next: boolean) => {
        if (next) setDraft(toRepoUrlShorthand(path));
        if (editing === undefined) setUncontrolledEditing(next);
        onEditingChange?.(next);
      },
      [editing, onEditingChange, path]
    );

    // The displayed URL follows navigation whenever we are not mid-edit.
    useEffect(() => {
      if (!isEditing) setDraft(toRepoUrlShorthand(path));
    }, [isEditing, path]);

    // Focus and select on entering edit mode, however it was triggered.
    useEffect(() => {
      if (!isEditing) return;
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    }, [isEditing]);

    useImperativeHandle(
      ref,
      () => ({
        beginEdit: () => setEditing(true),
        cancelEdit: () => setEditing(false),
      }),
      [setEditing]
    );

    const plan = useMemo(() => planCrumbs(path), [path]);
    const isPast = peg.kind !== 'head';
    const elidedTitle = plan.elided.join(' / ');

    const handleBarClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (isEditing) return;
      // Clicks on a crumb or the revision button are their own actions; only the
      // empty space in the bar opens the editable URL.
      if (event.target instanceof Element && event.target.closest('button')) return;
      setEditing(true);
    };

    const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        setEditing(false);
        onNavigate(parseAddressInput(draft, repositoryUrl));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDraft(toRepoUrlShorthand(path));
        setEditing(false);
      }
    };

    const separator = (key: string): JSX.Element => (
      <span key={key} aria-hidden="true" className="flex-none text-[11px] text-text-faint">
        /
      </span>
    );

    const renderCrumb = (crumb: RepoCrumb, isCurrent: boolean): JSX.Element => (
      <button
        key={`crumb-${crumb.path}`}
        type="button"
        onClick={() => onNavigate(crumb.path)}
        onContextMenu={onCrumbContextMenu ? (event) => onCrumbContextMenu(event, crumb) : undefined}
        title={toRepoUrlShorthand(crumb.path)}
        aria-current={isCurrent ? 'page' : undefined}
        className={[CRUMB_BASE, isCurrent ? 'font-semibold text-text' : ''].filter(Boolean).join(' ')}
      >
        <span className="overflow-hidden text-ellipsis">{crumb.label}</span>
      </button>
    );

    const lastTailIndex = plan.tail.length - 1;

    return (
      <div
        onClick={handleBarClick}
        className={[
          'flex h-8 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-lg border py-0 pl-2 pr-1',
          isEditing
            ? 'border-accent bg-bg ring-2 ring-accent/30'
            : isPast
              ? 'border-svn-modified bg-svn-modified/10'
              : 'border-border bg-bg-secondary hover:border-border-focus/60',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <FolderGit2
          aria-hidden="true"
          className={['h-3.5 w-3.5 flex-none', isPast ? 'text-svn-modified' : 'text-text-muted'].join(' ')}
        />

        {isEditing ? (
          <>
            <label htmlFor={inputId} className="sr-only">
              Repository path
            </label>
            <input
              id={inputId}
              ref={inputRef}
              value={draft}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleInputKeyDown}
              onBlur={() => {
                setDraft(toRepoUrlShorthand(path));
                setEditing(false);
              }}
              placeholder="^/path/to/somewhere"
              className="h-6 min-w-0 flex-1 border-0 bg-transparent font-mono text-[11.5px] text-text outline-none placeholder:text-text-faint"
            />
          </>
        ) : (
          <>
            <nav
              aria-label="Repository path"
              className="flex min-w-0 flex-1 items-center gap-px overflow-hidden"
            >
              {renderCrumb({ label: repositoryName, path: '' }, path === '')}

              {plan.head.map((crumb) => (
                <span key={`head-${crumb.path}`} className="flex flex-none items-center gap-px">
                  {separator(`sep-head-${crumb.path}`)}
                  {renderCrumb(crumb, crumb.path === path)}
                </span>
              ))}

              {plan.elided.length > 0 ? (
                <span className="flex flex-none items-center gap-px">
                  {separator('sep-ellipsis')}
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    title={elidedTitle}
                    aria-label={`Show the full path — ${plan.elided.length} hidden folders: ${elidedTitle}`}
                    className="inline-flex h-6 flex-none items-center rounded-md px-[7px] text-[11.5px] font-bold tracking-wider text-text-faint hover:bg-bg-tertiary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    …
                  </button>
                </span>
              ) : null}

              {plan.tail.map((crumb, index) => (
                <span key={`tail-${crumb.path}`} className="flex flex-none items-center gap-px">
                  {separator(`sep-tail-${crumb.path}`)}
                  {renderCrumb(crumb, index === lastTailIndex)}
                </span>
              ))}
            </nav>

            <button
              type="button"
              onClick={onPegClick}
              title={pegDescription(peg, headRevision)}
              aria-label={pegDescription(peg, headRevision)}
              className={[
                'flex h-6 flex-none items-center gap-1.5 rounded-md border px-[9px] font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isPast
                  ? 'border-svn-modified bg-svn-modified text-bg'
                  : 'border-border bg-bg text-text-secondary hover:border-accent hover:text-accent',
              ].join(' ')}
            >
              <span aria-hidden="true">@</span>
              <b className={isPast ? 'font-semibold text-bg' : 'font-semibold text-text'}>{pegLabel(peg)}</b>
            </button>
          </>
        )}
      </div>
    );
  }
);
