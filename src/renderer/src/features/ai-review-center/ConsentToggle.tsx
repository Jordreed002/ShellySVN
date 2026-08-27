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

  const state =
    choice === 'on'
      ? {
          Icon: ShieldCheck,
          tone: 'text-success',
          hint: 'AI features may run for this working copy.',
        }
      : choice === 'off'
        ? {
            Icon: ShieldOff,
            tone: 'text-warning',
            hint: 'AI features are blocked for this working copy.',
          }
        : {
            Icon: HelpCircle,
            tone: 'text-text-faint',
            hint: 'No choice recorded yet — nothing runs until you opt in or out.',
          };

  return (
    <div
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-9 border border-border bg-bg-sunk/60 px-2.5 py-2"
      role="radiogroup"
      aria-label="AI consent for this working copy"
    >
      <state.Icon className={`h-3.5 w-3.5 flex-shrink-0 ${state.tone}`} aria-hidden="true" />
      <span className="text-11 font-semibold text-text">AI for this working copy</span>

      {/* A three-way segmented control: the middle state is "no answer yet",
          which is not the same as "off" and must stay visibly distinct. */}
      <div
        className="flex items-center gap-0.5 rounded-8 bg-bg p-0.5"
        data-testid="ai-consent-choices"
      >
        {CHOICES.map((option) => {
          const selected = choice === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isBusy}
              onClick={() => void choose(option.id)}
              className={`rounded-6 px-2 py-0.5 text-10.5 font-medium transition-fast disabled:opacity-60 ${
                selected
                  ? option.id === 'on'
                    ? 'bg-success/15 text-success'
                    : option.id === 'off'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {isBusy && (
        <Loader2
          className="h-3 w-3 animate-spin text-text-muted motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 flex-1 truncate text-10.5 text-text-faint" title={state.hint}>
        {state.hint}
      </span>
    </div>
  );
}
