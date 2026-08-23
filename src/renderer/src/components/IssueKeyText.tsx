import { useMemo } from 'react';
import { isSafeExternalUrl, linkifyIssueKeys, type IssueTrackerPresetId } from '@renderer/lib/issueTracker';

/**
 * Shared linkified rendering of issue keys (#74).
 *
 * LogViewer / CommitHistory (and any future surface) can adopt this with two
 * lines:
 *
 *   import { IssueKeyText } from '../IssueKeyText';
 *   // where the commit message is rendered:
 *   <IssueKeyText text={entry.message} pattern={config.issueIdPattern}
 *                urlTemplate={config.issueUrlTemplate} />
 *
 * Links open through the app's external-open bridge (`window.api.app
 * .openExternal`) — never `window.open` — and only when the produced URL is a
 * safe http(s) URL. Unsafe or unresolvable keys render as plain text.
 */

interface IssueKeyTextProps {
  text: string;
  /** Issue ID regex (source string). Invalid or empty renders plain text. */
  pattern: string;
  /** URL template with `{id}` / `{issue}` placeholders. */
  urlTemplate: string;
  /** Preset flavor; `github` handles `org/repo#123` references. */
  preset?: IssueTrackerPresetId;
  className?: string;
  linkClassName?: string;
}

const DEFAULT_LINK_CLASS_NAME =
  'text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent';

export function IssueKeyText({
  text,
  pattern,
  urlTemplate,
  preset,
  className = '',
  linkClassName = DEFAULT_LINK_CLASS_NAME,
}: IssueKeyTextProps) {
  const segments = useMemo(
    () => (pattern.trim() && urlTemplate.trim()
      ? linkifyIssueKeys(text, { pattern, urlTemplate, preset })
      : []),
    [text, pattern, urlTemplate, preset]
  );

  if (segments.length === 0) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        const url = segment.type === 'link' ? segment.url : undefined;
        if (!url || !isSafeExternalUrl(url)) {
          return <span key={index}>{segment.text}</span>;
        }
        return (
          <button
            key={index}
            type="button"
            className={linkClassName}
            title={url}
            aria-label={`Open issue ${segment.text} in tracker`}
            onClick={() => void window.api?.app?.openExternal?.(url)}
          >
            {segment.text}
          </button>
        );
      })}
    </span>
  );
}
