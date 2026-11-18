import type { ReactNode } from 'react';

/**
 * PageHeader — the one quiet header a top-level view opens with.
 *
 * A 44px row on the page surface: a sentence-case title, an optional muted
 * one-line summary, and trailing actions. No eyebrow caps, no tinted band —
 * the top bar already says where you are; this says what the page holds and
 * what it lets you do.
 */
export interface PageHeaderProps {
  title: string;
  /** id for the heading so a region can be labelled by it. */
  titleId?: string;
  /** One line of context: a count, a scope, a caveat. */
  summary?: ReactNode;
  summaryTitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  titleId,
  summary,
  summaryTitle,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`page-header flex h-11 flex-shrink-0 items-center gap-3 border-b border-border bg-bg px-4 ${className}`}
    >
      <h1 id={titleId} className="flex-shrink-0 text-13 font-semibold text-text">
        {title}
      </h1>
      {summary !== undefined && summary !== null && summary !== '' ? (
        <span className="min-w-0 flex-1 truncate text-12 text-text-muted" title={summaryTitle}>
          {summary}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {actions && <div className="flex flex-shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}
