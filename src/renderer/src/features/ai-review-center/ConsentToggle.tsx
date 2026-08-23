import { useCallback, useEffect, useState } from 'react';
import { HelpCircle, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { clearAiConsent, readAiConsent, writeAiConsent } from './lib/aiConsent';

export type ConsentChoice = 'unset' | 'on' | 'off';

const CHOICES: Array<{ id: ConsentChoice; label: string }> = [
  { id: 'unset', label: 'Not set' },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

/**
 * Per-working-copy AI consent switch (#113). New working copies start with no
 * entry ("Not set") and the user must choose; the record persists via
 * get-merge-set so other working copies' entries are never clobbered.
 */
export function ConsentToggle({ workingCopyPath }: { workingCopyPath: string }) {
  const [choice, setChoice] = useState<ConsentChoice>('unset');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setChoice('unset');
    readAiConsent(workingCopyPath)
      .then((entry) => {
        if (active) setChoice(entry ? (entry.aiEnabled ? 'on' : 'off') : 'unset');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workingCopyPath]);

  const choose = useCallback(
    async (next: ConsentChoice) => {
      if (next === choice || isBusy) return;
      setIsBusy(true);
      try {
        if (next === 'unset') await clearAiConsent(workingCopyPath);
        else await writeAiConsent(workingCopyPath, next === 'on');
        setChoice(next);
      } catch {
        // Leave the previous state showing; store failures are transient.
      } finally {
        setIsBusy(false);
      }
    },
    [choice, isBusy, workingCopyPath]
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2 border border-border bg-bg px-2.5 py-2"
      role="radiogroup"
      aria-label="AI consent for this working copy"
    >
      {choice === 'on' ? (
        <ShieldCheck className="h-3.5 w-3.5 text-svn-normal" aria-hidden="true" />
      ) : choice === 'off' ? (
        <ShieldOff className="h-3.5 w-3.5 text-svn-modified" aria-hidden="true" />
      ) : (
        <HelpCircle className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
      )}
      <span className="text-10.5 font-semibold">AI for this working copy</span>
      <div className="flex overflow-hidden border border-border-muted" data-testid="ai-consent-choices">
        {CHOICES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={choice === option.id}
            disabled={isBusy}
            onClick={() => void choose(option.id)}
            className={`min-w-14 border-l border-border-muted px-2 py-1 font-mono text-9.5 uppercase tracking-wider transition-fast first:border-l-0 ${
              choice === option.id
                ? option.id === 'on'
                  ? 'bg-svn-normal/15 text-svn-normal'
                  : option.id === 'off'
                    ? 'bg-svn-modified/15 text-svn-modified'
                    : 'bg-bg-tertiary text-text'
                : 'bg-bg text-text-muted hover:text-text'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {isBusy && (
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-9.5 text-text-faint">
        {choice === 'on'
          ? 'AI features may run for this working copy.'
          : choice === 'off'
            ? 'AI features are blocked for this working copy.'
            : 'No choice recorded yet — nothing runs until you opt in or out.'}
      </span>
    </div>
  );
}
