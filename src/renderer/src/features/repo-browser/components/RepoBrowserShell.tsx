/**
 * The four-pane frame of the repository browser: rail | tree | contents | detail.
 *
 * Design source: `prototypes/12-browser.html` (`.body`, `body.nodetail .body`).
 *
 * The one subtlety worth stating out loud: **the detail pane steals width from the
 * contents pane.** In the prototype the contents grid drops the author and size
 * columns whenever the detail pane is open, because eight columns simply do not fit
 * in ~440px. An earlier version instead let the columns share the space, which
 * starved the Name column into nothing. So the shell publishes its layout state —
 * via `useRepoBrowserLayout()` or by handing it to any slot supplied as a function —
 * and each pane decides what it can afford to show.
 *
 * Presentational only: every pane arrives as a slot, no data access lives here.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/** How much horizontal room the contents pane has to work with. */
export type ContentsDensity =
  /** Detail pane open — the contents pane is squeezed; drop optional columns. */
  | 'narrow'
  /** Detail pane closed — the contents pane owns the remaining width. */
  | 'wide';

/** Layout facts the shell publishes to whatever it renders inside itself. */
export interface RepoBrowserLayout {
  /** True when the detail pane is on screen. */
  detailOpen: boolean;
  /** Derived from `detailOpen`; the thing panes should actually branch on. */
  contentsDensity: ContentsDensity;
}

/** A pane slot: either plain content, or a render prop given the layout state. */
export type RepoPaneSlot = ReactNode | ((layout: RepoBrowserLayout) => ReactNode);

const DEFAULT_LAYOUT: RepoBrowserLayout = {
  detailOpen: false,
  contentsDensity: 'wide',
};

const RepoBrowserLayoutContext = createContext<RepoBrowserLayout>(DEFAULT_LAYOUT);

/**
 * Read the shell's layout state. Safe to call outside a shell (tests, isolated
 * harnesses): it then reports the roomy, detail-closed layout.
 */
export function useRepoBrowserLayout(): RepoBrowserLayout {
  return useContext(RepoBrowserLayoutContext);
}

function renderSlot(slot: RepoPaneSlot | undefined, layout: RepoBrowserLayout): ReactNode {
  return typeof slot === 'function' ? slot(layout) : slot;
}

export interface RepoBrowserShellProps {
  /**
   * Far-left rail: working copies, repository shortcuts, disk usage.
   * Omit it when the host app already provides a sidebar — two rails side by
   * side is duplication, and the columns need the width.
   */
  rail?: RepoPaneSlot;
  /** The `role="tree"` directory tree. */
  tree: RepoPaneSlot;
  /** The `role="grid"` directory contents. */
  contents: RepoPaneSlot;
  /** Detail pane (diff / blame / log / properties). Only mounted when `detailOpen`. */
  detail?: RepoPaneSlot;
  /** Navigation bar, pinned above the panes. */
  navBar?: RepoPaneSlot;
  /** Status bar, pinned below the panes. */
  statusBar?: RepoPaneSlot;
  /** Whether the detail pane occupies a column. Drives `contentsDensity`. */
  detailOpen?: boolean;
  className?: string;
}

/*
 * Column tracks, spelled out as complete class strings so Tailwind's scanner sees
 * them. The minmax() floors keep every pane usable: nothing may collapse below
 * legibility, and the detail column is removed outright rather than squeezed.
 */
const COLUMNS_WITH_DETAIL =
  'grid-cols-[minmax(168px,206px)_minmax(184px,240px)_minmax(360px,1.5fr)_minmax(300px,0.95fr)]';
const COLUMNS_WITHOUT_DETAIL =
  'grid-cols-[minmax(168px,206px)_minmax(184px,240px)_minmax(360px,1fr)]';
/* Without the rail there is room to give the remaining panes a higher floor. */
const COLUMNS_NO_RAIL_WITH_DETAIL =
  'grid-cols-[minmax(184px,260px)_minmax(360px,1.5fr)_minmax(300px,0.95fr)]';
const COLUMNS_NO_RAIL_WITHOUT_DETAIL = 'grid-cols-[minmax(184px,260px)_minmax(360px,1fr)]';

function columnTracks(hasRail: boolean, detailOpen: boolean): string {
  if (hasRail) return detailOpen ? COLUMNS_WITH_DETAIL : COLUMNS_WITHOUT_DETAIL;
  return detailOpen ? COLUMNS_NO_RAIL_WITH_DETAIL : COLUMNS_NO_RAIL_WITHOUT_DETAIL;
}

export function RepoBrowserShell({
  rail,
  tree,
  contents,
  detail,
  navBar,
  statusBar,
  detailOpen = false,
  className,
}: RepoBrowserShellProps): JSX.Element {
  // A detail slot that was never supplied cannot be open, whatever the prop says.
  const isDetailOpen = detailOpen && detail !== undefined && detail !== null;
  const hasRail = rail !== undefined && rail !== null;

  const layout = useMemo<RepoBrowserLayout>(
    () => ({
      detailOpen: isDetailOpen,
      contentsDensity: isDetailOpen ? 'narrow' : 'wide',
    }),
    [isDetailOpen]
  );

  return (
    <RepoBrowserLayoutContext.Provider value={layout}>
      <div
        className={['flex h-full min-h-0 w-full flex-col bg-bg text-text', className]
          .filter(Boolean)
          .join(' ')}
      >
        {navBar ? <div className="flex-none">{renderSlot(navBar, layout)}</div> : null}

        <div
          className={[
            'grid min-h-0 flex-1 overflow-hidden',
            columnTracks(hasRail, isDetailOpen),
          ].join(' ')}
        >
          {hasRail ? (
            <aside
              aria-label="Working copies and repository shortcuts"
              className="flex min-h-0 min-w-0 flex-col overflow-auto border-r border-border bg-bg-secondary"
            >
              {renderSlot(rail, layout)}
            </aside>
          ) : null}

          <div
            role="group"
            aria-label="Directory tree"
            className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-bg"
          >
            {renderSlot(tree, layout)}
          </div>

          <section
            aria-label="Directory contents"
            className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg"
          >
            {renderSlot(contents, layout)}
          </section>

          {isDetailOpen ? (
            <aside
              aria-label="Details"
              className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-bg-secondary"
            >
              {renderSlot(detail, layout)}
            </aside>
          ) : null}
        </div>

        {statusBar ? <div className="flex-none">{renderSlot(statusBar, layout)}</div> : null}
      </div>
    </RepoBrowserLayoutContext.Provider>
  );
}
