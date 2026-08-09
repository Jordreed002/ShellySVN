import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, HardDrive, Home } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Breadcrumb / address bar — the local half of the prototype's `.address`
 * (`prototypes/12-browser.html`).
 *
 * The idiom is copied from `features/repo-browser/components/RepoAddressBar`:
 * a 32px hairline field on an 8px radius, 24px mono crumbs, a `/` separator and
 * a trailing slot where the browser puts `@HEAD`. It is a *copy*, not a reuse,
 * because these are local filesystem paths, not repository URLs: there is no
 * peg revision, no `^/` shorthand and no pasteable URL to click-to-edit, and
 * pretending otherwise would be a lie about what the address means.
 *
 * Paths never break the layout (SPEC: "Paths must never break the layout"):
 *
 * 1. A deep path collapses in the middle, exactly as `RepoAddressBar` does —
 *    root + first segment + `…` + the last three. The `…` is a menu, so no
 *    ancestor becomes unreachable by hiding it.
 * 2. What remains truncates from the left: the ancestors shrink and ellipsize,
 *    the folder you are actually in is `flex-none` and is the last thing to go.
 */

/** `.crumb` — 24px, mono, 11.5px, never wraps. */
const CRUMB_BASE =
  'inline-flex h-control-xs max-w-[10rem] items-center gap-1.5 rounded-6 px-[7px] font-mono text-11.5 whitespace-nowrap transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** A clickable ancestor. Shrinks — and ellipsizes — before the leaf does. */
/*
 * Ancestors shrink, but never below a readable stub. Plain `min-w-0 shrink`
 * let them collapse to zero width while their separators stayed, so a squeezed
 * bar rendered `// … /// src` — punctuation with the path missing. A crumb is
 * either legible or it belongs in the `…` menu; it is never a sliver.
 */
const CRUMB_ANCESTOR = `${CRUMB_BASE} min-w-[3.75rem] shrink text-text-secondary hover:bg-bg-tertiary hover:text-text`;

/** The directory you are actually in. Never shrinks. */
const CRUMB_CURRENT = `${CRUMB_BASE} flex-none cursor-default font-semibold text-text`;

/** `.ctx` — the elision menu shares the context menu's surface. */
const MENU_SURFACE =
  'absolute left-0 top-full z-50 mt-1.5 min-w-[220px] max-w-[22rem] rounded-11 border border-border-strong bg-bg-secondary p-[5px] shadow-overlay';

/** `.ci` — a menu row. */
const MENU_ITEM =
  'flex w-full items-center gap-2.5 rounded-7 px-[9px] py-[7px] text-left font-mono text-11.5 leading-tight text-text hover:bg-accent hover:text-white';

/** Keep the root and the last three segments; everything between hides behind `…`. */
const TAIL_SEGMENTS = 3;

interface BreadcrumbItem {
  name: string;
  path: string;
  isRoot?: boolean;
}

interface BreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
  className?: string;
  /** Crumbs shown before the middle collapses behind `…`. */
  maxItems?: number;
  /** Destination for the home button (user's home dir). Falls back to drives. */
  homePath?: string;
}

function splitPath(path: string): { separator: string; items: BreadcrumbItem[] } {
  const separator = path.includes('\\') ? '\\' : '/';
  const segments = path.split(separator).filter(Boolean);

  const items: BreadcrumbItem[] = [];
  let currentPath = '';

  segments.forEach((segment, index) => {
    // Handle Windows drive letter
    if (separator === '\\' && segment.endsWith(':')) {
      currentPath = segment + '\\';
    } else {
      currentPath = currentPath ? currentPath + separator + segment : separator + segment;
    }

    items.push({
      name: segment,
      path: currentPath,
      isRoot: index === 0,
    });
  });

  return { separator, items };
}

export function Breadcrumb({
  path,
  onNavigate,
  className = '',
  maxItems = 4,
  homePath,
}: BreadcrumbProps) {
  const [showElided, setShowElided] = useState(false);

  /*
   * How many trailing crumbs are shown. Reduced while the row overflows, so a
   * narrow bar hides *whole* ancestors — which stay reachable in the `…` menu —
   * instead of squeezing every crumb until none of them can be read.
   */
  const navRef = useRef<HTMLElement>(null);
  const [tailSegments, setTailSegments] = useState(TAIL_SEGMENTS);
  /**
   * Whether the first crumb is shown. It is the last thing given up, after the
   * tail has already been reduced to the folder you are in — because a clipped
   * leaf is the one outcome that must never happen, and flex clips from the
   * right. Everything hidden stays reachable in the `…` menu.
   */
  const [showHead, setShowHead] = useState(true);
  /**
   * Last resort, after every ancestor has already gone to the `…` menu: let the
   * folder you are in ellipsize. It is not the outcome we want, but the
   * alternative is the container's `overflow-hidden` hard-clipping it — cut mid
   * glyph, with nothing to say it was cut.
   */
  const [shrinkLeaf, setShrinkLeaf] = useState(false);

  useLayoutEffect(() => {
    setTailSegments(TAIL_SEGMENTS);
    setShowHead(true);
    setShrinkLeaf(false);
  }, [path]);

  useLayoutEffect(() => {
    const element = navRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const fit = () => {
      const overflowing = element.scrollWidth > element.clientWidth + 1;
      if (!overflowing) return;
      // Give up whole crumbs, in order: extra tail, then the head, and only
      // then let the leaf itself ellipsize.
      setTailSegments((current) => (current > 1 ? current - 1 : current));
      setShowHead((current) => (tailSegments <= 1 ? false : current));
      setShrinkLeaf((current) => (tailSegments <= 1 && !showHead ? true : current));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [path, tailSegments, showHead, shrinkLeaf]);

  // Handle special DRIVES:// path
  if (path === 'DRIVES://') {
    return (
      <nav
        className={`breadcrumb flex min-w-0 flex-1 items-center gap-px overflow-hidden ${className}`}
        aria-label="Breadcrumb"
      >
        <span className={`breadcrumb-current ${CRUMB_CURRENT}`}>
          <HardDrive className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />
          <span>This PC</span>
        </span>
      </nav>
    );
  }

  const { separator, items } = splitPath(path);

  const shouldCollapse = items.length > maxItems || tailSegments < TAIL_SEGMENTS || !showHead;
  const head = shouldCollapse ? (showHead ? items.slice(0, 1) : []) : items;
  const elided = shouldCollapse ? items.slice(showHead ? 1 : 0, -tailSegments) : [];
  const tail = shouldCollapse ? items.slice(-tailSegments) : [];
  const elidedTitle = elided.map((item) => item.name).join(` ${separator} `);
  const lastPath = items.length > 0 ? items[items.length - 1].path : '';

  const renderSeparator = (key: string) => (
    <span
      key={key}
      aria-hidden="true"
      className="breadcrumb-separator flex-none px-px font-mono text-11 text-text-faint"
    >
      {separator}
    </span>
  );

  const renderCrumb = (item: BreadcrumbItem, showIcon: boolean) => {
    const isCurrent = item.path === lastPath;
    return (
      <button
        key={`crumb-${item.path}`}
        type="button"
        onClick={() => !isCurrent && onNavigate(item.path)}
        disabled={isCurrent}
        title={item.path}
        aria-current={isCurrent ? 'page' : undefined}
        className={
          isCurrent
            ? `breadcrumb-current ${CRUMB_CURRENT}${shrinkLeaf ? ' min-w-0 shrink' : ''}`
            : `breadcrumb-item ${CRUMB_ANCESTOR}`
        }
      >
        {showIcon && <Folder className="h-3.5 w-3.5 flex-none text-accent" aria-hidden="true" />}
        <span className="overflow-hidden text-ellipsis">{item.name}</span>
      </button>
    );
  };

  /**
   * One crumb and the separator before it. The group that holds the folder you
   * are in never shrinks; every ancestor group does, so the path runs out of
   * room from the left and the leaf is the last thing standing.
   */
  const renderCrumbGroup = (item: BreadcrumbItem, key: string, showIcon: boolean) => (
    <span
      key={key}
      className={`flex items-center gap-px ${
        item.path === lastPath ? (shrinkLeaf ? 'min-w-0 shrink' : 'flex-none') : 'min-w-0 shrink'
      }`}
    >
      {renderSeparator(`sep-${key}`)}
      {renderCrumb(item, showIcon)}
    </span>
  );

  return (
    <nav
      ref={navRef}
      className={`breadcrumb flex min-w-0 flex-1 items-center gap-px overflow-hidden text-11.5 ${className}`}
      aria-label="Breadcrumb"
    >
      <button
        type="button"
        onClick={() => onNavigate(homePath || 'DRIVES://')}
        className="grid h-control-xs w-control-xs flex-none place-items-center rounded-6 text-text-muted transition-fast hover:bg-bg-tertiary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        title={homePath ? 'Go to home folder' : 'Go to drives'}
        aria-label={homePath ? 'Go to home folder' : 'Go to drives'}
      >
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {head.map((item, index) =>
        renderCrumbGroup(item, `head-${item.path}`, index === 0 && !shouldCollapse)
      )}

      {elided.length > 0 && (
        <span className="flex flex-none items-center gap-px">
          {renderSeparator('sep-elided')}
          <span className="relative flex-none">
            <button
              type="button"
              onClick={() => setShowElided((value) => !value)}
              title={elidedTitle}
              aria-label={`Show the full path — ${elided.length} hidden folders: ${elidedTitle}`}
              aria-haspopup="menu"
              aria-expanded={showElided}
              className="inline-flex h-control-xs flex-none items-center rounded-6 px-[7px] text-11.5 font-bold tracking-caps text-text-faint transition-fast hover:bg-bg-tertiary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              …
            </button>
            {showElided && (
              <>
                <span
                  className="fixed inset-0 z-40 block"
                  onClick={() => setShowElided(false)}
                  aria-hidden="true"
                />
                <span
                  className={MENU_SURFACE}
                  role="menu"
                  aria-label="Hidden folders"
                  onKeyDown={(event) => event.key === 'Escape' && setShowElided(false)}
                >
                  {elided.map((item) => (
                    <button
                      key={`elided-${item.path}`}
                      type="button"
                      role="menuitem"
                      title={item.path}
                      onClick={() => {
                        setShowElided(false);
                        onNavigate(item.path);
                      }}
                      className={MENU_ITEM}
                    >
                      <Folder className="h-[15px] w-[15px] flex-none" aria-hidden="true" />
                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                        {item.name}
                      </span>
                    </button>
                  ))}
                </span>
              </>
            )}
          </span>
        </span>
      )}

      {tail.map((item) => renderCrumbGroup(item, `tail-${item.path}`, false))}
    </nav>
  );
}

export interface PathAddressBarProps {
  /** Absolute local path being browsed. */
  path: string;
  onNavigate: (path: string) => void;
  /** Destination for the crumbs' home button. */
  homePath?: string;
  /**
   * Trailing control pinned to the right of the crumbs — the prototype's
   * `.revbtn` slot. The explorer puts the branch chip here.
   */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The address field itself: `.address` — 32px, hairline, 8px radius, a leading
 * glyph, the crumbs, and one trailing control.
 */
export function PathAddressBar({
  path,
  onNavigate,
  homePath,
  trailing,
  className = '',
}: PathAddressBarProps) {
  return (
    <div
      /*
       * The floor is what a home button, an elision menu and the folder you are
       * in actually need — measured, not guessed. Below `6rem` the leaf crumb
       * was clipped, which is the one thing the path may never do.
       */
      className={`flex h-control min-w-[16.5rem] flex-1 items-center gap-1 rounded-8 border border-border bg-bg-secondary pl-2 pr-1 transition-fast hover:border-border-focus/60 ${className}`}
    >
      <HardDrive className="h-3.5 w-3.5 flex-none text-text-muted" aria-hidden="true" />
      <Breadcrumb path={path} onNavigate={onNavigate} homePath={homePath} />
      {trailing && <span className="flex flex-none items-center">{trailing}</span>}
    </div>
  );
}

// Compact breadcrumb for title bar
export function BreadcrumbCompact({ path, onNavigate, className = '' }: BreadcrumbProps) {
  const segments = path.split('/').filter(Boolean);
  const repoName = segments[0] || 'Repository';
  const currentFolder = segments[segments.length - 1] || repoName;

  return (
    <div className={`flex items-center gap-1.5 text-12.5 ${className}`}>
      <Folder className="h-3.5 w-3.5 flex-none text-accent" aria-hidden="true" />
      <button
        type="button"
        onClick={() => onNavigate('/' + segments[0])}
        className="font-mono font-semibold text-text transition-fast hover:text-accent"
      >
        {repoName}
      </button>
      {segments.length > 1 && (
        <>
          <ChevronRight className="h-3 w-3 flex-none text-text-faint" aria-hidden="true" />
          <span className="truncate font-mono text-text-secondary">
            {segments.length > 2 ? '… / ' : ''}
            {currentFolder}
          </span>
        </>
      )}
    </div>
  );
}
