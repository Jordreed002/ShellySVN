/**
 * Rail primitives for the global sidebar.
 *
 * These mirror `prototypes/12-browser.html`'s `.rail`: an uppercase
 * letter-spaced section heading (`.rsec`/`.eyebrow`), compact 32px rows
 * (`.ritem`), taller 46px working-copy rows (`.ritem.tall`) carrying a
 * local-presence dot and a mono sub-line, and mono count badges (`.c`).
 */
import { type MouseEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { FolderGit2, MoreHorizontal, Star } from 'lucide-react';

import { m, variants } from '../../lib/motion';
import {
  describeRepo,
  PRESENCE_LABEL,
  type RepoStatusCounts,
  type SidebarPresence,
  type WorkingCopyInfo,
} from './sidebarData';

/* ── section heading (.rsec / .eyebrow) ──────────────────────────────────── */

interface RailSectionProps {
  title: string;
  /** Optional trailing control, e.g. an add button. */
  action?: ReactNode;
}

/** Uppercase, letter-spaced heading that opens each rail section. */
export function RailSection({ title, action }: RailSectionProps) {
  return (
    <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-1">
      <span className="flex-1 text-2xs font-bold uppercase tracking-[0.13em] text-text-muted">
        {title}
      </span>
      {action}
    </div>
  );
}

/* ── count badge (.c) ────────────────────────────────────────────────────── */

interface RailCountProps {
  value: number;
  /** Renders in the modified/conflict tint rather than the neutral one. */
  tone?: 'neutral' | 'modified' | 'conflict';
  title?: string;
}

/** Mono pill carrying a count — entries, changes, working copies. */
export function RailCount({ value, tone = 'neutral', title }: RailCountProps) {
  const tones = {
    neutral: 'bg-bg-tertiary border-border text-text-muted',
    modified: 'bg-svn-modified/15 border-svn-modified/40 text-svn-modified',
    conflict: 'bg-svn-conflict/15 border-svn-conflict/40 text-svn-conflict',
  } as const;

  return (
    <span
      className={`flex-shrink-0 rounded-full border px-1.5 py-px font-mono text-2xs tabular-nums ${tones[tone]}`}
      title={title}
    >
      {value}
    </span>
  );
}

/* ── local presence dot (.dot) ───────────────────────────────────────────── */

/**
 * How much of a working copy is on disk: filled = checked out, half = sparse,
 * hollow = not checked out. Always paired with a spoken label — never
 * colour-only.
 */
function PresenceDot({ presence }: { presence: SidebarPresence }) {
  const label = PRESENCE_LABEL[presence];
  const shape = {
    full: 'bg-svn-added',
    sparse: 'ring-1 ring-inset ring-svn-added',
    none: 'ring-1 ring-inset ring-text-faint',
    unknown: 'ring-1 ring-inset ring-border-strong',
  } as const;

  return (
    <>
      <span
        aria-hidden="true"
        title={label}
        className={`relative flex-shrink-0 h-2 w-2 overflow-hidden rounded-full ${shape[presence]}`}
      >
        {presence === 'sparse' && <span className="absolute inset-y-0 left-0 w-1/2 bg-svn-added" />}
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/* ── rows ────────────────────────────────────────────────────────────────── */

/** Shared `.ritem` shape. `tall` matches the prototype's 46px working-copy row. */
export function railRowClass(active: boolean, tall = false): string {
  return [
    'group/row relative flex items-center gap-2.5 rounded-lg border px-2.5 text-xs transition-fast',
    tall ? 'h-[46px]' : 'h-8',
    active
      ? 'border-accent/30 bg-accent/10 font-semibold text-accent'
      : 'border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text',
  ].join(' ');
}

interface RailRowContentProps {
  icon: ReactNode;
  label: string;
  /** Mono second line, typically a path, URL or a local-state summary. */
  detail?: string;
  /** Full value behind a shortened `detail`. */
  detailTitle?: string;
  count?: number;
  countTone?: RailCountProps['tone'];
  countTitle?: string;
}

/** Shared innards of every compact rail row, whether it is a link or a button. */
function RailRowContent({
  icon,
  label,
  detail,
  detailTitle,
  count,
  countTone,
  countTitle,
}: RailRowContentProps) {
  return (
    <>
      <span className="flex-shrink-0 opacity-85 [&>svg]:h-[15px] [&>svg]:w-[15px]">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate leading-tight">{label}</span>
        {detail && (
          <span
            className="block truncate font-mono text-2xs font-normal leading-tight text-text-muted"
            title={detailTitle ?? detail}
          >
            {detail}
          </span>
        )}
      </span>
      {typeof count === 'number' && <RailCount value={count} tone={countTone} title={countTitle} />}
    </>
  );
}

interface RailLinkRowProps extends RailRowContentProps {
  /** Every rail location opens in the file explorer. */
  path: string;
  isActive?: boolean;
  onSelect?: () => void;
  /** Hover-revealed trailing control, e.g. remove. */
  trailing?: ReactNode;
}

/** Compact rail row: icon, name, optional mono sub-line and count badge. */
export function RailLinkRow({
  path,
  isActive = false,
  onSelect,
  trailing,
  ...content
}: RailLinkRowProps) {
  return (
    <div className="group/row relative">
      <Link
        to="/files"
        search={{ path }}
        onClick={onSelect}
        className={`${railRowClass(isActive, Boolean(content.detail))} ${trailing ? 'pr-8' : ''}`}
      >
        <RailRowContent {...content} />
      </Link>
      {trailing}
    </div>
  );
}

interface RailButtonRowProps extends RailRowContentProps {
  /** Rows that act on the working copy rather than navigating to a location. */
  onActivate: () => void;
  /** Spoken name — the label alone is rarely enough (e.g. a bare shelf name). */
  ariaLabel: string;
  title?: string;
}

/**
 * Same shape as `RailLinkRow`, but it runs a command instead of navigating.
 * Used where a rail row opens a dialog — a shelf, for instance, is not a place.
 */
export function RailButtonRow({ onActivate, ariaLabel, title, ...content }: RailButtonRowProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={ariaLabel}
      title={title}
      className={`${railRowClass(false, Boolean(content.detail))} w-full`}
    >
      <RailRowContent {...content} />
    </button>
  );
}

interface WorkingCopyRowProps {
  repo: string;
  isActive: boolean;
  isPinned: boolean;
  isMenuOpen: boolean;
  presence: SidebarPresence;
  status?: RepoStatusCounts;
  info?: WorkingCopyInfo;
  onOpen: (repo: string) => void;
  onMenu: (event: MouseEvent, repo: string) => void;
}

/**
 * A working copy in the rail: presence dot, name, a mono sub-line naming the
 * repository path and revision, and a pending-change count.
 */
export function WorkingCopyRow({
  repo,
  isActive,
  isPinned,
  isMenuOpen,
  presence,
  status,
  info,
  onOpen,
  onMenu,
}: WorkingCopyRowProps) {
  const { name, parent } = describeRepo(repo);
  const changes = status?.changes ?? 0;
  const conflicts = status?.conflicts ?? 0;

  // Prefer the repository fact (branch · revision); fall back to where the
  // checkout lives on disk. Both are real — neither is invented.
  const detail = info ? `${info.branch} · r${info.revision}` : parent || repo;

  return (
    <m.div className="group relative" variants={variants.listItem}>
      <Link
        to="/files"
        search={{ path: repo }}
        onClick={() => onOpen(repo)}
        onContextMenu={(e) => onMenu(e, repo)}
        className={`${railRowClass(isActive || isMenuOpen, true)} pr-8`}
      >
        <PresenceDot presence={presence} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium leading-tight">{name}</span>
          <span
            className="block truncate font-mono text-2xs font-normal leading-tight text-text-muted"
            title={info ? `${info.url} · r${info.revision}` : repo}
          >
            {detail}
          </span>
        </span>

        {/* Change count / pin — hidden on hover so the actions button can take the slot. */}
        <span className="flex flex-shrink-0 items-center gap-1.5 transition-opacity group-hover:opacity-0">
          {changes > 0 && (
            <RailCount
              value={changes}
              tone={conflicts > 0 ? 'conflict' : 'modified'}
              title={
                conflicts > 0
                  ? `${changes} change${changes === 1 ? '' : 's'}, ${conflicts} conflict${conflicts === 1 ? '' : 's'}`
                  : `${changes} pending change${changes === 1 ? '' : 's'}`
              }
            />
          )}
          {isPinned && <Star className="h-3.5 w-3.5 fill-current text-accent" />}
        </span>
      </Link>

      <button
        type="button"
        onClick={(e) => onMenu(e, repo)}
        className={`btn-icon-sm absolute right-1.5 top-1/2 -translate-y-1/2 transition-opacity ${
          isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
        }`}
        aria-label={`Actions for ${name}`}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </m.div>
  );
}

interface RepoRailItemProps {
  repo: string;
  isActive: boolean;
  isPinned: boolean;
  status?: RepoStatusCounts;
  onOpen: (repo: string) => void;
  onMenu: (event: MouseEvent, repo: string) => void;
}

/** Compact icon-only repository entry shown in the collapsed sidebar rail. */
export function RepoRailItem({
  repo,
  isActive,
  isPinned,
  status,
  onOpen,
  onMenu,
}: RepoRailItemProps) {
  const { name } = describeRepo(repo);
  const conflicts = status?.conflicts ?? 0;
  const changes = status?.changes ?? 0;

  return (
    <Link
      to="/files"
      search={{ path: repo }}
      onClick={() => onOpen(repo)}
      onContextMenu={(e) => onMenu(e, repo)}
      title={name}
      aria-label={name}
      className={`rail-item ${isActive ? 'rail-item-active' : ''}`}
    >
      <FolderGit2 className="w-5 h-5" />
      {changes > 0 && (
        <span
          className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-2 ring-bg-secondary ${
            conflicts > 0 ? 'bg-svn-conflict' : 'bg-svn-modified'
          }`}
        />
      )}
      {isPinned && (
        <Star className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 text-accent fill-current" />
      )}
    </Link>
  );
}
