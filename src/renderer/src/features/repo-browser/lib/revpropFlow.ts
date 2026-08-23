/**
 * The state machine behind revision-property editing (#70).
 *
 * Editing `svn:log` / `svn:author` / `svn:date` rewrites history metadata:
 * the change is **permanent** (the old value is not recoverable) and, on most
 * servers, **logged** (`pre-revprop-change` hooks commonly record who changed
 * what, when — many refuse the change outright without one). The flow is
 * therefore deliberately two-step: an edit step that can be abandoned freely,
 * then an explicit confirmation step whose acknowledgement checkbox names both
 * consequences before the IPC call is allowed.
 *
 * Pure reducer, no React and no IPC — the dialog maps states onto markup and
 * the single effectful call (`svn:revpropset`) stays in the component.
 */

/** The three unversioned revprops Subversion defines; everything else is versioned. */
export type RevpropName = 'svn:log' | 'svn:author' | 'svn:date';

export const REVPROP_NAMES: readonly RevpropName[] = ['svn:log', 'svn:author', 'svn:date'];

export interface RevpropCurrentValues {
  log: string;
  author: string;
  date: string;
}

export type RevpropState =
  | { phase: 'editing'; name: RevpropName; draft: string; error: string | null }
  | {
      phase: 'confirming';
      name: RevpropName;
      draft: string;
      acknowledged: boolean;
    }
  | { phase: 'saving'; name: RevpropName; draft: string }
  | { phase: 'saved'; name: RevpropName }
  | { phase: 'error'; name: RevpropName; draft: string; error: string };

export type RevpropEvent =
  /**
   * Switch which property is being edited. Carries that property's current
   * value because the reducer must reset the draft to it, and only the
   * component knows the values the log entry reported.
   */
  | { type: 'change-name'; name: RevpropName; value: string }
  | { type: 'change-draft'; value: string }
  | { type: 'review' }
  | { type: 'back-to-edit' }
  | { type: 'toggle-acknowledged'; acknowledged: boolean }
  | { type: 'begin-save' }
  | { type: 'save-succeeded' }
  | { type: 'save-failed'; error: string }
  | { type: 'reset' };

export function initialRevpropState(
  name: RevpropName,
  current: RevpropCurrentValues
): RevpropState {
  return { phase: 'editing', name, draft: currentValueOf(name, current), error: null };
}

/** The stored value of a property, as `revpropget` (or the log entry) reports it. */
export function currentValueOf(name: RevpropName, current: RevpropCurrentValues): string {
  if (name === 'svn:log') return current.log;
  if (name === 'svn:author') return current.author;
  return current.date;
}

/**
 * Validate a draft before the review step is offered.
 *
 * `svn:date` must be a timestamp Subversion accepts; in practice that means
 * the ISO-8601 form `svn` itself prints (`2026-08-23T14:05:09.123456Z`).
 * `svn:author` cannot be empty — an unattributable revision serves nobody.
 */
export function validateRevpropValue(name: RevpropName, value: string): string | null {
  if (name === 'svn:author' && value.trim() === '') {
    return 'svn:author cannot be empty — a revision must be attributable to someone.';
  }
  if (name === 'svn:date') {
    const trimmed = value.trim();
    if (trimmed === '') return 'svn:date cannot be empty.';
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(trimmed)) {
      return 'svn:date must be a timestamp like 2026-08-23T14:05:09.000000Z — Subversion rejects anything else.';
    }
    if (Number.isNaN(Date.parse(trimmed))) {
      return 'That date is not a real moment in time.';
    }
  }
  return null;
}

export function revpropReducer(state: RevpropState, event: RevpropEvent): RevpropState {
  switch (event.type) {
    case 'change-name': {
      // Only meaningful while editing; after saving the flow is over.
      if (state.phase !== 'editing') return state;
      return { phase: 'editing', name: event.name, draft: event.value, error: null };
    }
    case 'change-draft': {
      if (state.phase !== 'editing') return state;
      return { ...state, draft: event.value, error: null };
    }
    case 'review': {
      if (state.phase !== 'editing') return state;
      const error = validateRevpropValue(state.name, state.draft);
      if (error) return { ...state, error };
      return { phase: 'confirming', name: state.name, draft: state.draft, acknowledged: false };
    }
    case 'back-to-edit': {
      if (state.phase !== 'confirming' && state.phase !== 'error') return state;
      return { phase: 'editing', name: state.name, draft: state.draft, error: null };
    }
    case 'toggle-acknowledged': {
      if (state.phase !== 'confirming') return state;
      return { ...state, acknowledged: event.acknowledged };
    }
    case 'begin-save': {
      // The dialog disables the button; the reducer enforces the same rule —
      // the acknowledgement is what licenses the write, not the click landing.
      if (state.phase !== 'confirming' || !state.acknowledged) return state;
      return { phase: 'saving', name: state.name, draft: state.draft };
    }
    case 'save-succeeded': {
      if (state.phase !== 'saving') return state;
      return { phase: 'saved', name: state.name };
    }
    case 'save-failed': {
      if (state.phase !== 'saving') return state;
      return { phase: 'error', name: state.name, draft: state.draft, error: event.error };
    }
    case 'reset': {
      // From 'saved' there is no draft to keep — the dialog closes on success,
      // and a reset that lands there starts the editor empty rather than
      // showing the last value as if it were still editable.
      const draft = state.phase === 'saved' ? '' : state.draft;
      return { phase: 'editing', name: state.name, draft, error: null };
    }
    default:
      return state;
  }
}

/** Guard for the confirmation step's Save button. */
export function canSubmitRevprop(state: RevpropState): boolean {
  return state.phase === 'confirming' && state.acknowledged === true;
}

/** Whether the draft would actually change anything — pure no-op guard. */
export function revpropHasChange(state: RevpropState, current: RevpropCurrentValues): boolean {
  if (state.phase === 'saved') return false;
  return state.draft !== currentValueOf(state.name, current);
}

/**
 * The notice the confirmation step must state, verbatim in intent: permanent,
 * and on most servers logged. Kept as data so the dialog cannot drift from
 * the wording the flow was designed around.
 */
export const REVPROP_CONSEQUENCE_NOTICE =
  'Revprop changes are permanent — the previous value cannot be recovered afterwards. On most servers the change is also logged (a pre-revprop-change hook records who changed what, and when; some servers refuse revprop changes entirely).';
