/**
 * Skeleton loading primitives (#92, #95).
 *
 * Three shapes cover every loading surface in the app:
 *
 * - `SkeletonLine` — a text-line-shaped bar.
 * - `SkeletonBlock` — an arbitrary block (chips, avatars, panels).
 * - `SkeletonList` — an accessible list-shaped placeholder: one
 *   `role="status"` + `aria-busy` container with a screen-reader label, and
 *   rows of lines that approximate the real content's geometry, so the layout
 *   does not jump when data lands.
 *
 * Motion: the shimmer is a CSS animation on `.skeleton-shimmer`
 * (styles/global.css). The global `prefers-reduced-motion: reduce` blocks kill
 * it, leaving a static two-tone placeholder — never a frozen mid-animation
 * frame.
 */

import type { ReactNode } from 'react';

const SHIMMER = 'skeleton-shimmer rounded-6';

/** One text line. Width is the caller's; height defaults to a 12px text line. */
export function SkeletonLine({ className = 'h-3' }: { className?: string }) {
  return <div aria-hidden="true" className={`${SHIMMER} ${className}`} />;
}

/** An arbitrary block — chips, icons, thumbnails, panels. */
export function SkeletonBlock({ className = 'h-8 w-8' }: { className?: string }) {
  return <div aria-hidden="true" className={`${SHIMMER} ${className}`} />;
}

export interface SkeletonListProps {
  /** Placeholder rows to render. */
  rows?: number;
  /** Screen-reader label, e.g. "Loading history". */
  label?: string;
  /** Row content. Defaults to a log-entry-shaped row (chip + two lines). */
  row?: (index: number) => ReactNode;
  /** Classes for the container (it fills its scroll parent by default). */
  className?: string;
}

/** Default row: a revision-chip block plus two text lines, like a log entry. */
function defaultRow(index: number) {
  return (
    <div className="flex items-start gap-3 px-4 py-3" aria-hidden="true">
      <SkeletonBlock className="h-6 w-14 flex-shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonLine className={`h-3 ${index % 3 === 0 ? 'w-11/12' : 'w-3/4'}`} />
        <SkeletonLine className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

/**
 * A list-shaped loading placeholder. Announced once via `role="status"` (not
 * per-row), with `aria-busy` on the container; individual shapes are decorative.
 */
export function SkeletonList({
  rows = 5,
  label = 'Loading…',
  row = defaultRow,
  className = '',
}: SkeletonListProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={`w-full ${className}`}
      data-testid="skeleton-list"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index}>{row(index)}</div>
      ))}
    </div>
  );
}
