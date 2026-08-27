/**
 * The resting state of a Review Center tab.
 *
 * Every tab used to share one dashed box with a warning triangle — including
 * "Review queue clear", where the triangle told the user something was wrong
 * about good news. Each state now names its own icon, and a cleared queue gets
 * a positive medallion.
 */

import type { LucideIcon } from 'lucide-react';

interface ReviewEmptyStateProps {
  icon: LucideIcon;
  title: string;
  detail: string;
  tone?: 'neutral' | 'positive';
}

export function ReviewEmptyState({
  icon: Icon,
  title,
  detail,
  tone = 'neutral',
}: ReviewEmptyStateProps) {
  return (
    <div className="grid min-h-[18rem] place-items-center px-6 py-12 text-center">
      <div className="max-w-sm">
        <div
          className={`mx-auto grid h-11 w-11 place-items-center rounded-full border ${
            tone === 'positive'
              ? 'border-success/25 bg-success/10 text-success'
              : 'border-border bg-bg-secondary text-text-faint'
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <h3 className="mt-3.5 text-13 font-semibold text-text">{title}</h3>
        <p className="mt-1.5 text-11.5 leading-relaxed text-text-muted">{detail}</p>
      </div>
    </div>
  );
}
