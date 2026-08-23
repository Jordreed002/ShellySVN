import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

export interface AiPrivacyNoticeProps {
  title: string;
  /** One or two sentences explaining what was blocked and why (#18). */
  children: ReactNode;
  /** Primary recovery action, e.g. "Review consent settings". */
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary action, e.g. retry after fixing the cause. */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/**
 * Actionable panel shown when an AI call fails a consent gate or trips the
 * privacy scanner (#18): explains that nothing left the machine and points at
 * the per-working-copy consent toggle.
 */
export function AiPrivacyNotice({
  title,
  children,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: AiPrivacyNoticeProps) {
  return (
    <div
      role="alert"
      className="border border-svn-modified/50 bg-svn-modified/5 p-3"
      data-testid="ai-privacy-notice"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-modified" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h4 className="text-12 font-semibold text-text">{title}</h4>
          <div className="mt-1 text-11 leading-relaxed text-text-secondary">{children}</div>
          {(actionLabel || secondaryLabel) && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {actionLabel && onAction && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onAction}>
                  {actionLabel}
                </button>
              )}
              {secondaryLabel && onSecondary && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onSecondary}>
                  {secondaryLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
