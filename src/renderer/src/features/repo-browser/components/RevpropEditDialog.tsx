/**
 * RevpropEditDialog — edit `svn:log` / `svn:author` / `svn:date` on one
 * revision (#70), through the two-step flow in `lib/revpropFlow`.
 *
 * The consequence the confirmation step must state is not boilerplate: the
 * previous value is gone for good, and on most servers a
 * `pre-revprop-change` hook logs who changed what. Some servers refuse revprop
 * edits entirely — that surfaces as the error state, not as a surprise.
 *
 * The current values arrive from the log entry already on screen, so the draft
 * starts pre-filled and the old→new preview is exact. The single IPC call
 * (`svn:revpropset`) is injected so the flow is testable without a server.
 */

import { useReducer } from 'react';
import { History, Loader2, PencilLine, ShieldAlert } from 'lucide-react';

import { AccessibleDialog, AccessibleDialogBody, AccessibleDialogFooter } from '@renderer/components/AccessibleDialog';

import {
  canSubmitRevprop,
  currentValueOf,
  initialRevpropState,
  REVPROP_CONSEQUENCE_NOTICE,
  REVPROP_NAMES,
  revpropHasChange,
  revpropReducer,
  type RevpropCurrentValues,
  type RevpropName,
} from '../lib/revpropFlow';

export interface RevpropEditDialogProps {
  /** The revision whose properties are being edited. */
  revision: number;
  /** Path label, e.g. `trunk/src` — for copy only; the IPC call uses `targetUrl`. */
  path: string;
  /** Target `svn revpropset` accepts: full URL or working-copy path. */
  targetUrl: string;
  /** Current values, as the log entry reported them. */
  current: RevpropCurrentValues;
  onClose: () => void;
  /**
   * Persist the change. Returns `{ success, error }` rather than throwing so
   * the dialog can show the server's refusal verbatim.
   */
  onSave: (name: RevpropName, value: string) => Promise<{ success: boolean; error?: string }>;
  /** Fired after a successful save; the view refreshes the log. */
  onSaved?: (name: RevpropName, value: string) => void;
}

const PROP_LABEL: Record<RevpropName, string> = {
  'svn:log': 'Log message',
  'svn:author': 'Author',
  'svn:date': 'Date',
};

const PROP_HINT: Record<RevpropName, string> = {
  'svn:log': 'The commit message. Typos and missing detail are the usual reasons to edit it.',
  'svn:author': 'Who made the commit. Cannot be empty.',
  'svn:date': 'When the commit happened, e.g. 2026-08-23T14:05:09.000000Z.',
};

export function RevpropEditDialog({
  revision,
  path,
  targetUrl,
  current,
  onClose,
  onSave,
  onSaved,
}: RevpropEditDialogProps): JSX.Element {
  const [state, dispatch] = useReducer(
    revpropReducer,
    undefined,
    () => initialRevpropState('svn:log', current)
  );

  const run = async (): Promise<void> => {
    if (state.phase !== 'confirming') return;
    // Captured before the dispatch narrows the union away from the draft.
    const { name, draft } = state;
    dispatch({ type: 'begin-save' });
    try {
      const result = await onSave(name, draft);
      if (result.success) {
        dispatch({ type: 'save-succeeded' });
        onSaved?.(name, draft);
      } else {
        dispatch({ type: 'save-failed', error: result.error ?? 'The server refused the change.' });
      }
    } catch (thrown) {
      dispatch({ type: 'save-failed', error: (thrown as Error)?.message ?? String(thrown) });
    }
  };

  const busy = state.phase === 'saving';

  const original = currentValueOf(state.name, current);

  return (
    <AccessibleDialog
      isOpen
      onClose={state.phase === 'saving' ? () => undefined : onClose}
      title={`Edit revision properties — r${revision}`}
      icon={History}
      tone="accent"
      size="md"
      description={`Rewrite history metadata on r${revision} (${path}). Nothing about the revision's content changes.`}
    >
      <AccessibleDialogBody>
        {state.phase === 'saved' ? (
          <div className="flex items-start gap-2.5 rounded-9 border border-svn-added/40 bg-svn-added/10 p-3 text-xs leading-relaxed text-text-secondary">
            <span className="font-semibold text-svn-added">Saved.</span>
            <span>
              <b className="font-mono">{state.name}</b> on r{revision} now reads the new value. Refresh the
              log to see it there.
            </span>
          </div>
        ) : state.phase === 'confirming' || state.phase === 'saving' ? (
          <>
            <b className="text-xs font-bold text-text">
              {PROP_LABEL[state.name]} on r{revision} — old → new
            </b>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-9 border border-border bg-bg-tertiary/40 p-2.5">
                <span className="eyebrow mb-1 block">Old (current)</span>
                <code className="block max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-secondary">
                  {original === '' ? '(empty)' : original}
                </code>
              </div>
              <div className="rounded-9 border border-accent/40 bg-accent/10 p-2.5">
                <span className="eyebrow mb-1 block">New</span>
                <code className="block max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text">
                  {state.draft === '' ? '(empty)' : state.draft}
                </code>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2.5 rounded-9 border border-svn-modified/40 bg-svn-modified/10 p-3 text-xs leading-relaxed text-text-secondary">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-svn-modified" aria-hidden="true" />
              <p>{REVPROP_CONSEQUENCE_NOTICE}</p>
            </div>

            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-text">
              <input
                type="checkbox"
                className="mt-0.5 h-[15px] w-[15px] accent-accent"
                checked={state.phase === 'confirming' ? state.acknowledged : true}
                disabled={busy}
                onChange={(event) =>
                  dispatch({ type: 'toggle-acknowledged', acknowledged: event.target.checked })
                }
              />
              <span>
                I understand this change is permanent and will likely be recorded in the server's log.
              </span>
            </label>

            <div className="mt-3 rounded-9 border border-border bg-bg-tertiary/40 p-3">
              <b className="block text-xs font-bold text-text">Command that will run</b>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {`svn propset --revprop -r ${revision} ${state.name} "<new value>" "${targetUrl}"`}
              </code>
            </div>
          </>
        ) : (
          <>
            <div>
              <span id="revprop-name-label" className="mb-1.5 block text-xs font-bold text-text">
                Property
              </span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="revprop-name-label">
                {REVPROP_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={state.name === name}
                    onClick={() =>
                      dispatch({ type: 'change-name', name, value: currentValueOf(name, current) })
                    }
                    disabled={busy}
                    className={`rounded-lg border px-2.5 py-1 font-mono text-2xs font-semibold ${
                      state.name === name
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-border bg-bg-secondary text-text-secondary hover:border-accent/40 hover:text-text'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-2xs text-text-muted">{PROP_HINT[state.name]}</p>
            </div>

            <div className="mt-3">
              <label htmlFor="revprop-draft" className="mb-1.5 block text-xs font-bold text-text">
                {PROP_LABEL[state.name]} — pre-filled with the current value
              </label>
              <textarea
                id="revprop-draft"
                className={`input ${state.name === 'svn:log' ? 'min-h-[96px]' : 'min-h-[40px]'} resize-y font-mono`}
                value={state.draft}
                onChange={(event) => dispatch({ type: 'change-draft', value: event.target.value })}
                rows={state.name === 'svn:log' ? 4 : 1}
              />
            </div>

            {state.phase === 'error' ? (
              <p
                role="alert"
                className="mt-3 rounded-9 border border-svn-conflict/40 bg-svn-conflict/10 p-3 text-xs leading-relaxed text-text-secondary"
              >
                {state.error}
              </p>
            ) : null}

            {state.phase === 'editing' && state.error ? (
              <p role="alert" className="mt-2 text-xs text-svn-modified">
                {state.error}
              </p>
            ) : null}
          </>
        )}
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          {state.phase === 'saved'
            ? 'Close when ready.'
            : 'Revprop changes are permanent and, on most servers, logged.'}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={
            state.phase === 'confirming' || state.phase === 'error'
              ? () => dispatch({ type: 'back-to-edit' })
              : onClose
          }
          disabled={busy}
        >
          {state.phase === 'confirming' || state.phase === 'error'
            ? 'Back'
            : state.phase === 'saved'
              ? 'Close'
              : 'Cancel'}
        </button>
        {state.phase === 'saved' ? null : state.phase === 'confirming' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={!canSubmitRevprop(state)}
          >
            <PencilLine className="h-4 w-4" aria-hidden="true" />
            Save permanent change
          </button>
        ) : state.phase === 'saving' ? (
          <button type="button" className="btn btn-primary" disabled aria-busy="true">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Saving…
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => dispatch({ type: 'review' })}
            disabled={state.phase !== 'editing' || !revpropHasChange(state, current)}
          >
            Review change…
          </button>
        )}
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default RevpropEditDialog;
