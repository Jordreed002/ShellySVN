import { AlertCircle, RotateCw } from 'lucide-react';

/**
 * The one error state every async surface shows: what failed, in the app's
 * banner language, with a Retry button.
 *
 * It exists so a failed (or timed-out — see `lib/queryTimeout.ts`) read can
 * never render as a bare sentence or, worse, an eternal spinner. Two variants:
 *
 *  - `panel` — centred in the surface that failed, for views whose whole body
 *    is the read (log lists, previews, history).
 *  - `banner` — a slim strip, for errors that sit alongside other content.
 *
 * `onRetry` is optional only because some errors genuinely cannot be retried
 * (the file is gone); when a retry exists, render the button rather than
 * making the user find the refresh control elsewhere in the chrome.
 */

export interface ErrorPanelProps {
  /** What went wrong, in one line. Usually `error.message`. */
  message: string;
  /** Optional lead-in naming the read that failed, e.g. "Failed to load log". */
  title?: string;
  /** Re-run the failed read. The Retry button renders only when supplied. */
  onRetry?: () => void;
  retryLabel?: string;
  variant?: 'panel' | 'banner';
  /** True while the retry is in flight — spins the button's icon. */
  isRetrying?: boolean;
  className?: string;
}

export function ErrorPanel({
  message,
  title,
  onRetry,
  retryLabel = 'Retry',
  variant = 'panel',
  isRetrying = false,
  className = '',
}: ErrorPanelProps) {
  const retryButton = onRetry ? (
    <button
      type="button"
      onClick={onRetry}
      disabled={isRetrying}
      className={`btn btn-secondary btn-sm text-xs ${variant === 'banner' ? 'flex-none' : 'mt-2'}`}
      aria-label={retryLabel}
    >
      <RotateCw
        className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin motion-reduce:animate-none' : ''}`}
        aria-hidden="true"
      />
      {retryLabel}
    </button>
  ) : null;

  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className={`flex items-center gap-2 border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error ${className}`}
      >
        <AlertCircle className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {title ? <span className="font-medium">{title} — </span> : null}
          {message}
        </span>
        {retryButton}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`flex h-full flex-col items-center justify-center gap-1 p-6 text-center ${className}`}
    >
      <AlertCircle className="mb-2 h-8 w-8 text-error" aria-hidden="true" />
      {title ? <p className="text-sm font-medium text-error">{title}</p> : null}
      <p className="max-w-[42ch] break-words text-xs leading-relaxed text-error/90">{message}</p>
      {retryButton}
    </div>
  );
}
