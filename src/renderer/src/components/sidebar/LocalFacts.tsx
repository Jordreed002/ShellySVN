/**
 * The two rail sections that describe work sitting on this machine:
 * `PROBLEMS` and `SHELVES` in `prototypes/12-browser.html`.
 *
 * Both are local facts, so both exist only where there is a checkout. Neither
 * ever renders a count it has not measured: a problem count the rail cannot
 * cheaply know is absent, not zero, and a Subversion that cannot shelve says so
 * in words instead of showing an empty list.
 */
import { Archive, AlertTriangle, Plus } from 'lucide-react';

import { RailButtonRow, RailLinkRow, RailSection } from './RepoRow';
import type { RailProblems, RailShelf, RailUnsupportedShelving } from './sidebarInsights';

interface ProblemsSectionProps {
  problems: RailProblems;
  /**
   * Name the owning working copy in every row. Required as soon as the rail
   * holds more than one checkout — otherwise "Needs attention" is ambiguous.
   */
  attributeWorkingCopy: boolean;
}

/**
 * One row per working copy that has something wrong with it, worst first.
 *
 * Renders nothing when no measured working copy has a problem: the section
 * appearing at all is the signal, so there is no confident `0` to misread. When
 * some checkouts have not been measured yet that is stated under the rows
 * rather than folded silently into the total.
 */
export function ProblemsSection({ problems, attributeWorkingCopy }: ProblemsSectionProps) {
  if (problems.rows.length === 0) return null;

  return (
    <>
      <RailSection title="Problems" />
      <div className="space-y-0.5 px-1.5">
        {problems.rows.map((row) => {
          const detail = [
            attributeWorkingCopy ? row.name : null,
            row.problems.summary,
            row.fromCache ? 'cached' : null,
          ]
            .filter((part): part is string => part !== null)
            .join(' · ');

          return (
            <RailLinkRow
              key={row.path}
              path={row.path}
              dialog="problems"
              icon={
                <AlertTriangle
                  className={row.problems.blocking > 0 ? 'text-svn-conflict' : 'text-warning'}
                />
              }
              label="Needs attention"
              detail={detail}
              detailTitle={
                `${row.problems.summary} in ${row.path}` +
                (row.fromCache
                  ? ` — from the offline status cache, ${Math.floor(row.cacheAge / 60_000)} minutes old`
                  : '')
              }
              count={row.problems.total}
              countTone={row.problems.blocking > 0 ? 'conflict' : 'modified'}
              countTitle={
                `${row.problems.total} problem${row.problems.total === 1 ? '' : 's'} from ` +
                `svn status in ${row.name}. Floating externals and incoming revisions are ` +
                `counted in the repository browser, not here.`
              }
            />
          );
        })}
      </div>
      {problems.unmeasured > 0 && (
        <p className="px-3.5 pt-1 font-mono text-9.5 text-text-faint">
          {problems.unmeasured} working {problems.unmeasured === 1 ? 'copy' : 'copies'} not measured
          yet
        </p>
      )}
    </>
  );
}

interface ShelvesSectionProps {
  shelves: RailShelf[];
  unsupported: RailUnsupportedShelving[];
  /** Name the owning working copy in every row — shelves are per checkout. */
  attributeWorkingCopy: boolean;
  /** Opens the shelf manager for one working copy. */
  onOpenShelves: (workingCopyPath: string) => void;
  /**
   * The checkout the `+` acts on, when the rail can name one. `hasChanges`
   * decides the wording: with nothing modified there is nothing to shelve, so
   * the button opens that working copy's shelves instead of promising a shelve.
   */
  shelveTarget?: { path: string; name: string; hasChanges: boolean };
  /** Said only about a working copy whose shelf list we actually read. */
  emptyNote?: string;
}

/**
 * Shelved changes, newest first, each row naming its shelf and how long it has
 * been sitting there.
 *
 * The prototype's `6 files` sub-line is deliberately absent: `svn shelf-list`
 * reports a shelf's name, log message and date, not how many files it holds, so
 * the rail shows the age it knows and does not invent a file count.
 */
export function ShelvesSection({
  shelves,
  unsupported,
  attributeWorkingCopy,
  onOpenShelves,
  shelveTarget,
  emptyNote,
}: ShelvesSectionProps) {
  if (shelves.length === 0 && unsupported.length === 0 && !emptyNote) return null;

  return (
    <>
      <RailSection
        title="Shelves"
        action={
          shelveTarget ? (
            <button
              type="button"
              onClick={() => onOpenShelves(shelveTarget.path)}
              className="text-text-muted hover:text-text transition-fast"
              title={
                shelveTarget.hasChanges
                  ? `Shelve changes in ${shelveTarget.name}`
                  : `Shelves in ${shelveTarget.name}`
              }
              aria-label={
                shelveTarget.hasChanges
                  ? `Shelve changes in ${shelveTarget.name}`
                  : `Shelves in ${shelveTarget.name}`
              }
            >
              <Plus className="h-3 w-3" />
            </button>
          ) : undefined
        }
      />
      <div className="space-y-0.5 px-1.5">
        {shelves.map((shelf) => {
          const detail = [attributeWorkingCopy ? shelf.workingCopyName : null, shelf.age]
            .filter((part): part is string => part !== null && part !== '')
            .join(' · ');

          return (
            <RailButtonRow
              key={`${shelf.workingCopyPath}::${shelf.name}`}
              icon={<Archive />}
              label={shelf.name}
              detail={detail || undefined}
              detailTitle={`${shelf.workingCopyPath}${shelf.date ? ` · ${shelf.date}` : ''}`}
              onActivate={() => onOpenShelves(shelf.workingCopyPath)}
              ariaLabel={`Shelf ${shelf.name} in ${shelf.workingCopyName}`}
              title={
                (shelf.message ? `${shelf.message}\n` : '') +
                `Shelved in ${shelf.workingCopyPath} — svn unshelve ${shelf.name}`
              }
            />
          );
        })}
      </div>
      {unsupported.map((entry) => (
        <p key={entry.path} className="px-3.5 pt-1 text-9.5 text-text-muted" title={entry.reason}>
          {attributeWorkingCopy ? `${entry.name}: ` : ''}this Subversion does not support shelving —
          <span className="font-mono"> svn shelf</span> needs Subversion 1.14 or newer.
        </p>
      ))}
      {emptyNote && <p className="px-3.5 pt-1 font-mono text-9.5 text-text-faint">{emptyNote}</p>}
    </>
  );
}
