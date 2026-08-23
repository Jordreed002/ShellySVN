/**
 * EmptyState (#93) — the one shape an empty surface takes.
 *
 * An icon chip (or a custom illustration), a title, a description that says
 * what would make the surface non-empty, and up to two actions — primary and
 * secondary — so every "nothing here yet" answers "so what do I do next?" in
 * the same visual language as the welcome screen (`.eyebrow` tone, hairline
 * cards, `btn btn-primary` / `btn btn-secondary`).
 *
 * Error states are NOT this: a failed read is `ErrorPanel`'s job, with a Retry.
 *
 * Sizes:
 * - `panel` — centred in a full surface (the surface's whole body is the
 *   empty list), e.g. History with no working copy selected.
 * - `section` — the tighter, card-mounted variant used inside sections, e.g.
 *   the Home briefing's first-run welcome.
 */

import type { ComponentType, ReactNode } from 'react';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** lucide icon rendered beside the label. */
  icon?: ComponentType<{ className?: string }>;
}

export interface EmptyStateProps {
  /** lucide icon for the icon chip. Provide either this or `illustration`. */
  icon?: ComponentType<{ className?: string }>;
  /** Custom illustration slot (replaces the icon chip). */
  illustration?: ReactNode;
  title: string;
  /** What is empty, and what would make it non-empty. */
  description?: ReactNode;
  /** The one action that moves things forward. */
  primaryAction?: EmptyStateAction;
  /** A secondary way in, rendered beside the primary. */
  secondaryAction?: EmptyStateAction;
  /** Quiet mono line under the actions (hints, shortcuts). */
  hint?: ReactNode;
  variant?: 'panel' | 'section';
  /** id for the heading (for aria-labelledby on a wrapping section). */
  titleId?: string;
  /** Extra classes on the root. */
  className?: string;
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  primaryAction,
  secondaryAction,
  hint,
  variant = 'panel',
  titleId,
  className = '',
}: EmptyStateProps) {
  const actions =
    primaryAction || secondaryAction ? (
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {primaryAction && <EmptyStateButton action={primaryAction} primary />}
        {secondaryAction && <EmptyStateButton action={secondaryAction} />}
      </div>
    ) : null;

  const head = illustration ? (
    <div className="mb-4 flex justify-center">{illustration}</div>
  ) : Icon ? (
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-14 bg-bg-tertiary/70">
      <Icon aria-hidden="true" className="h-7 w-7 text-text-faint" />
    </div>
  ) : null;

  if (variant === 'section') {
    return (
      <div className={`px-4 py-8 text-center ${className}`}>
        {head}
        <h3 id={titleId} className="text-14 font-semibold tracking-tight text-text">
          {title}
        </h3>
        {description && (
          <p className="mx-auto mt-1 max-w-prose text-12.5 leading-relaxed text-text-secondary">
            {description}
          </p>
        )}
        {actions}
        {hint && (
          <p className="mt-3 font-mono text-9.5 leading-relaxed text-text-faint">{hint}</p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center px-6 text-center ${className}`}
    >
      {head}
      <h3 id={titleId} className="text-14 font-semibold tracking-tight text-text">
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-xs text-12.5 leading-relaxed text-text-muted">{description}</p>
      )}
      {actions}
      {hint && <p className="mt-3 font-mono text-9.5 leading-relaxed text-text-faint">{hint}</p>}
    </div>
  );
}

function EmptyStateButton({ action, primary }: { action: EmptyStateAction; primary?: boolean }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      onClick={action.onClick}
      className={`btn gap-2 px-3 py-1.5 text-11.5 ${primary ? 'btn-primary' : 'btn-secondary'}`}
    >
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5" />}
      {action.label}
    </button>
  );
}
