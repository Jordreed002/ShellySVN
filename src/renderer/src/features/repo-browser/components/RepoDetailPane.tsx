/**
 * Detail pane for the repository browser — the frame around Diff / Blame / Log / Properties.
 *
 * The pane exists to answer a question SVN clients habitually dodge: *what is
 * this diff actually comparing?* `svn diff` with no arguments compares your
 * disk to BASE; `--revision BASE:HEAD` compares two server revisions and shows
 * none of your work; `--old/--new` compares two paths entirely. The answers are
 * materially different, so the comparand and its consequence are stated in the
 * chrome, above every view, at all times.
 *
 * Presentational only: every value and handler arrives via props.
 */

import { useCallback, useId, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Info,
  Loader2,
  RotateCw,
  type LucideIcon,
} from 'lucide-react';
import type { Comparand, ComparandOption, DetailTab } from '../types';
import { REPO_BROWSER_QUERY_ROOT } from '../hooks/queryKeys';

/* ────────────────────────────────────────────────────────────────────────────
 * The canonical comparand list
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every comparison SVN can produce, with the consequence of choosing it.
 *
 * Exported so the route, the tests and any other surface that renders a diff
 * describe the same five comparisons in the same words. Never re-word these
 * inline — a comparand that says something different in two places is worse
 * than one that says nothing.
 */
export const COMPARAND_OPTIONS: readonly ComparandOption[] = [
  {
    value: 'wc-base',
    label: 'working copy ↔ BASE',
    consequence: 'your uncommitted edits only — nothing incoming from the server is in this diff',
    requiresWorkingCopy: true,
  },
  {
    value: 'wc-head',
    label: 'working copy ↔ HEAD',
    consequence: 'your edits and theirs, combined — this diff cannot tell you which is which',
    requiresWorkingCopy: true,
  },
  {
    value: 'base-head',
    label: 'BASE ↔ HEAD',
    consequence: 'incoming changes only — your edits are not in this diff',
    requiresWorkingCopy: true,
  },
  {
    value: 'branch-trunk',
    label: 'this branch ↔ trunk',
    consequence: 'divergence between the two paths — neither side is your working copy',
    requiresWorkingCopy: false,
  },
  {
    value: 'rev-rev',
    label: 'revision ↔ revision',
    consequence: 'server-side, no working copy involved — local edits are invisible here',
    requiresWorkingCopy: false,
  },
] as const;

/** Revisions and paths used to render a comparand label concretely. */
export interface ComparandContext {
  /** `svn info` BASE revision of the working copy. */
  baseRevision?: number;
  /** Latest revision on the server for this path. */
  headRevision?: number;
  /** The path `branch-trunk` compares against, e.g. `^/website/trunk`. */
  branchTarget?: string;
  /** The two revisions behind `rev-rev`. */
  revisionRange?: { from: number; to: number };
}

/** Look an option up by value. Returns `undefined` for an unknown comparand. */
export function findComparandOption(
  value: Comparand,
  options: readonly ComparandOption[] = COMPARAND_OPTIONS
): ComparandOption | undefined {
  return options.find((option) => option.value === value);
}

/**
 * Fill a comparand label in with the revisions actually in play — `working copy
 * ↔ BASE r4821` rather than the abstract form. Falls back to the abstract label
 * when the route has not resolved the revisions yet.
 */
export function formatComparandLabel(option: ComparandOption, ctx: ComparandContext = {}): string {
  const base = ctx.baseRevision === undefined ? 'BASE' : `BASE r${ctx.baseRevision}`;
  const head = ctx.headRevision === undefined ? 'HEAD' : `HEAD r${ctx.headRevision}`;

  switch (option.value) {
    case 'wc-base':
      return `working copy ↔ ${base}`;
    case 'wc-head':
      return `working copy ↔ ${head}`;
    case 'base-head':
      return `${base} ↔ ${head}`;
    case 'branch-trunk':
      return ctx.branchTarget ? `this branch ↔ ${ctx.branchTarget}` : option.label;
    case 'rev-rev':
      return ctx.revisionRange
        ? `r${ctx.revisionRange.from} ↔ r${ctx.revisionRange.to}`
        : option.label;
    default:
      return option.label;
  }
}

/** True when the option cannot be offered because there is no checkout on disk. */
export function isComparandDisabled(option: ComparandOption, hasWorkingCopy: boolean): boolean {
  return option.requiresWorkingCopy && !hasWorkingCopy;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared message block — used by the pane and by every view inside it
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DetailMessageProps {
  icon?: LucideIcon;
  title: string;
  /** One or two lines of plain explanation. */
  detail?: ReactNode;
  /** An exact `svn` command, rendered verbatim in mono. */
  command?: string;
  tone?: 'neutral' | 'warning' | 'error';
  /** Spins the icon — for in-flight states. */
  busy?: boolean;
  /** Re-run the failed command. The button renders only when supplied. */
  onRetry?: () => void;
  retryLabel?: string;
}

const TONE_ICON_CLASS: Record<NonNullable<DetailMessageProps['tone']>, string> = {
  neutral: 'text-text-faint',
  warning: 'text-warning',
  error: 'text-error',
};

/**
 * The one empty/loading/error block every detail view uses, so a blank pane is
 * never rendered anywhere in the feature.
 */
export function DetailMessage({
  icon: Icon = FileText,
  title,
  detail,
  command,
  tone = 'neutral',
  busy = false,
  onRetry,
  retryLabel = 'Retry',
}: DetailMessageProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 px-4 py-8 text-center font-sans">
      <Icon
        className={`h-6 w-6 ${TONE_ICON_CLASS[tone]} ${busy ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-text">{title}</p>
      {detail ? (
        <p className="max-w-[42ch] text-xs leading-relaxed text-text-secondary">{detail}</p>
      ) : null}
      {command ? (
        <code className="mt-1 rounded bg-bg-tertiary px-2 py-1 font-mono text-2xs text-text-secondary">
          {command}
        </code>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-secondary btn-sm mt-2 text-xs"
          aria-label={retryLabel}
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Retry the repository browser's mounted reads.
 *
 * Every query this feature issues is keyed under {@link REPO_BROWSER_QUERY_ROOT}
 * (the route's listing key reuses the same root), so one invalidation refetches
 * exactly the views on screen — log, properties, listing — and nothing else.
 * Views whose data arrives via props use this when no narrower retry handler
 * was passed down.
 */
export function useRepoBrowserRetry(): () => void {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [REPO_BROWSER_QUERY_ROOT] });
  }, [queryClient]);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The pane
 * ──────────────────────────────────────────────────────────────────────────── */

const TABS: ReadonlyArray<{ value: DetailTab; label: string }> = [
  { value: 'diff', label: 'Diff' },
  { value: 'blame', label: 'Blame' },
  { value: 'log', label: 'Log' },
  { value: 'properties', label: 'Properties' },
];

export interface RepoDetailPaneProps {
  /**
   * Path of the selected entry, shown verbatim. Truncates from the left so the
   * filename survives — monorepo paths are long and the tail is the useful end.
   */
  path: string | null;
  /** Currently selected tab. Controlled by the route. */
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;

  /** Currently selected comparison. Controlled by the route. */
  comparand: Comparand;
  onComparandChange: (comparand: Comparand) => void;
  /** Defaults to {@link COMPARAND_OPTIONS}; override only in tests. */
  comparandOptions?: readonly ComparandOption[];
  /** Options marked `requiresWorkingCopy` are disabled when this is false. */
  hasWorkingCopy: boolean;
  /** Revisions and paths used to render the comparand labels concretely. */
  comparandContext?: ComparandContext;
  /** Hide the comparand row for tabs where no comparison is in play. */
  showComparand?: boolean;

  /** Facts strip under the tabs — counts, revisions, the `svn` command in play. */
  meta?: ReactNode;
  /** Buttons rendered beside the path, e.g. open externally. */
  actions?: ReactNode;
  /** The active view. */
  children?: ReactNode;

  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function RepoDetailPane({
  path,
  tab,
  onTabChange,
  comparand,
  onComparandChange,
  comparandOptions = COMPARAND_OPTIONS,
  hasWorkingCopy,
  comparandContext,
  showComparand = true,
  meta,
  actions,
  children,
  loading = false,
  error = null,
  className = '',
}: RepoDetailPaneProps): React.JSX.Element {
  const tabsId = useId();
  const selectId = `${tabsId}-comparand`;
  const retryDetailReads = useRepoBrowserRetry();

  const activeOption = findComparandOption(comparand, comparandOptions);
  const hasBlockedOptions = comparandOptions.some((option) =>
    isComparandDisabled(option, hasWorkingCopy)
  );

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const index = TABS.findIndex((entry) => entry.value === tab);
      if (index === -1) return;
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = TABS[(index + delta + TABS.length) % TABS.length];
      if (next) {
        event.preventDefault();
        onTabChange(next.value);
      }
    },
    [tab, onTabChange]
  );

  return (
    <aside
      /* Fills its column so the tab panel scrolls rather than the pane growing. */
      className={`flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-border bg-bg-secondary ${className}`}
      aria-label="Detail pane"
    >
      {/* header — path, actions, tabs */}
      <div className="flex-none border-b border-border bg-bg px-3 pt-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            dir="rtl"
            title={path ?? undefined}
            className="min-w-0 flex-1 truncate text-left font-mono text-xs font-semibold text-text"
          >
            <bdi>{path ?? '—'}</bdi>
          </span>
          {actions ? <span className="flex flex-none items-center gap-1">{actions}</span> : null}
        </div>

        <div
          role="tablist"
          aria-label="Detail view"
          className="mt-2 flex gap-1"
          onKeyDown={handleTabKeyDown}
        >
          {TABS.map((entry) => {
            const selected = entry.value === tab;
            return (
              <button
                key={entry.value}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${entry.value}`}
                aria-selected={selected}
                aria-controls={`${tabsId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTabChange(entry.value)}
                className={`-mb-px border-b-2 px-2.5 py-1.5 text-xs font-bold transition-colors ${
                  selected
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text'
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* comparand — what is being compared, and what that leaves out */}
      {showComparand ? (
        <div className="flex-none border-b border-border-muted bg-bg-secondary px-3 py-1.5">
          <div className="flex items-center gap-2">
            <label
              htmlFor={selectId}
              className="flex-none text-2xs font-bold uppercase tracking-[0.13em] text-text-secondary"
            >
              Compare
            </label>
            <div className="relative min-w-0 flex-1">
              <select
                id={selectId}
                value={comparand}
                onChange={(event) => onComparandChange(event.target.value as Comparand)}
                className="h-[26px] w-full appearance-none rounded-md border border-border bg-bg pl-2 pr-6 font-mono text-xs text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {comparandOptions.map((option) => {
                  const disabled = isComparandDisabled(option, hasWorkingCopy);
                  return (
                    <option key={option.value} value={option.value} disabled={disabled}>
                      {formatComparandLabel(option, comparandContext)}
                      {disabled ? ' — needs a working copy' : ''}
                    </option>
                  );
                })}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Rule 3: say what the diff compares *and* what that means. */}
          <p className="mt-1 flex items-start gap-1.5 text-2xs leading-relaxed text-text-secondary">
            <Info className="mt-px h-3 w-3 flex-none text-text-muted" aria-hidden="true" />
            <span>
              <span className="font-mono text-text">
                {activeOption
                  ? formatComparandLabel(activeOption, comparandContext)
                  : 'unknown comparison'}
              </span>
              {activeOption ? (
                <>
                  {' — '}
                  {activeOption.consequence}
                </>
              ) : (
                ' — this client cannot describe what is being compared; pick a comparison above'
              )}
            </span>
          </p>

          {hasBlockedOptions ? (
            <p className="mt-0.5 text-2xs text-text-muted">
              Comparisons involving a working copy are unavailable — this path is not checked out.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* facts strip */}
      {meta ? (
        <div className="flex flex-none flex-wrap gap-x-3 gap-y-1 border-b border-border-muted bg-bg-secondary px-3 py-1.5 font-mono text-2xs text-text-muted">
          {meta}
        </div>
      ) : null}

      {/* body */}
      <div
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${tab}`}
        className="min-h-0 flex-1 overflow-auto"
      >
        {loading ? (
          <DetailMessage icon={Loader2} title="Loading…" busy />
        ) : error ? (
          <DetailMessage
            icon={AlertTriangle}
            tone="error"
            title="That command failed"
            detail={error}
            onRetry={retryDetailReads}
          />
        ) : path === null ? (
          <DetailMessage
            title="Nothing selected"
            detail="Select a file or folder in the listing to see its diff, blame, log and properties."
          />
        ) : children === undefined || children === null ? (
          <DetailMessage
            title="Nothing to show here yet"
            detail="This view has no data for the selected entry. Try another tab, or a different comparison."
          />
        ) : (
          children
        )}
      </div>
    </aside>
  );
}
