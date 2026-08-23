import { useMemo } from 'react';

/**
 * Live message guide under the commit textarea (#73c).
 *
 * The textarea itself already runs the browser's native spellcheck
 * (`spellCheck={true}` on `AutoCompleteInput`); this adds the numeric half of
 * the guide: subject length against the subject cap (the repository profile's
 * `subjectMaxLength`, default 72) and a word/line count. It is a counter, not
 * a validator — rule violations stay in `validationWarnings` /
 * `validateCommitMessage` so nothing here duplicates those lists.
 */

interface MessageGuideProps {
  message: string;
  /** Repository profile subject cap; falls back to the conventional 72. */
  subjectMaxLength?: number;
  /** Length at which the subject counter turns amber (soft guidepost). */
  subjectSoftLimit?: number;
  className?: string;
}

export const DEFAULT_SUBJECT_MAX_LENGTH = 72;
const DEFAULT_SUBJECT_SOFT_LIMIT = 50;

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

export function MessageGuide({
  message,
  subjectMaxLength,
  subjectSoftLimit = DEFAULT_SUBJECT_SOFT_LIMIT,
  className = '',
}: MessageGuideProps) {
  const max = subjectMaxLength && subjectMaxLength > 0 ? subjectMaxLength : DEFAULT_SUBJECT_MAX_LENGTH;

  const guide = useMemo(() => {
    const trimmed = message.trim();
    if (!trimmed) return null;
    const subject = trimmed.split(/\r?\n/)[0] ?? '';
    return {
      subjectLength: subject.length,
      wordCount: countWords(trimmed),
      lineCount: trimmed.split(/\r?\n/).length,
    };
  }, [message]);

  if (!guide) return null;

  const { subjectLength, wordCount, lineCount } = guide;
  const overHard = subjectLength > max;
  const overSoft = subjectLength > subjectSoftLimit && subjectLength <= max;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-10.5 tabular-nums ${className}`}
      aria-hidden="false"
    >
      <span
        className={
          overHard ? 'text-error' : overSoft ? 'text-warning' : 'text-text-faint'
        }
        title={`First line length against the ${max}-character subject cap`}
      >
        {`Subject ${subjectLength}/${max}`}
      </span>
      <span className="text-text-faint">{`${wordCount} word${wordCount === 1 ? '' : 's'}`}</span>
      <span className="text-text-faint">{`${lineCount} line${lineCount === 1 ? '' : 's'}`}</span>
      {overHard && (
        <span className="text-error" role="status">
          {`Subject exceeds ${max} characters`}
        </span>
      )}
    </div>
  );
}
