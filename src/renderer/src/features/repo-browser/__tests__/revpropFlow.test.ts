/**
 * The revprop editing flow (#70): a two-step state machine whose confirmation
 * step exists to state the consequences before the write is allowed.
 */

import { describe, expect, it } from 'vitest';

import {
  canSubmitRevprop,
  currentValueOf,
  initialRevpropState,
  revpropHasChange,
  revpropReducer,
  validateRevpropValue,
  type RevpropCurrentValues,
} from '../lib/revpropFlow';

const CURRENT: RevpropCurrentValues = {
  log: 'Fix the parser edge case',
  author: 'jordan',
  date: '2026-08-23T14:05:09.123456Z',
};

describe('validateRevpropValue', () => {
  it('rejects an empty author', () => {
    expect(validateRevpropValue('svn:author', '   ')).toMatch(/cannot be empty/);
    expect(validateRevpropValue('svn:author', ' someone ')).toBeNull();
  });

  it('requires a Subversion-shaped timestamp for svn:date', () => {
    expect(validateRevpropValue('svn:date', '2026-08-23T14:05:09.123456Z')).toBeNull();
    expect(validateRevpropValue('svn:date', '2026-08-23 14:05:09')).toBeNull();
    expect(validateRevpropValue('svn:date', 'yesterday')).toMatch(/timestamp/);
    expect(validateRevpropValue('svn:date', '2026-13-40T99:00:00Z')).toMatch(/not a real moment/);
    expect(validateRevpropValue('svn:date', '')).toMatch(/cannot be empty/);
  });

  it('lets any log message through, including empty', () => {
    expect(validateRevpropValue('svn:log', '')).toBeNull();
    expect(validateRevpropValue('svn:log', 'typo fix')).toBeNull();
  });
});

describe('revpropReducer flow', () => {
  it('starts editing svn:log pre-filled with the current value', () => {
    const state = initialRevpropState('svn:log', CURRENT);
    expect(state).toEqual({
      phase: 'editing',
      name: 'svn:log',
      draft: CURRENT.log,
      error: null,
    });
  });

  it('switching property resets the draft to that property current value', () => {
    let state = initialRevpropState('svn:log', CURRENT);
    state = revpropReducer(state, { type: 'change-draft', value: 'rewritten' });
    state = revpropReducer(state, { type: 'change-name', name: 'svn:author', value: CURRENT.author });
    expect(state).toEqual({
      phase: 'editing',
      name: 'svn:author',
      draft: 'jordan',
      error: null,
    });
  });

  it('blocks review while validation fails and clears the error once fixed', () => {
    let state = initialRevpropState('svn:author', CURRENT);
    state = revpropReducer(state, { type: 'change-draft', value: '' });
    state = revpropReducer(state, { type: 'review' });
    expect(state.phase).toBe('editing');
    if (state.phase === 'editing') expect(state.error).toMatch(/cannot be empty/);

    state = revpropReducer(state, { type: 'change-draft', value: 'someone-else' });
    expect(state.error).toBeNull();
    state = revpropReducer(state, { type: 'review' });
    expect(state.phase).toBe('confirming');
  });

  it('confirmation starts unacknowledged and cannot be submitted until acknowledged', () => {
    let state = revpropReducer(initialRevpropState('svn:log', CURRENT), { type: 'review' });
    expect(canSubmitRevprop(state)).toBe(false);
    state = revpropReducer(state, { type: 'toggle-acknowledged', acknowledged: true });
    expect(canSubmitRevprop(state)).toBe(true);
  });

  it('saving succeeds only from confirming, and end-states are terminal', () => {
    let state = revpropReducer(initialRevpropState('svn:log', CURRENT), { type: 'review' });
    // begin-save is refused without acknowledgement… the dialog disables the
    // button; the reducer enforces the same rule.
    const unacknowledged = revpropReducer(state, { type: 'begin-save' });
    expect(unacknowledged.phase).toBe('confirming');

    state = revpropReducer(state, { type: 'toggle-acknowledged', acknowledged: true });
    state = revpropReducer(state, { type: 'begin-save' });
    expect(state.phase).toBe('saving');
    state = revpropReducer(state, { type: 'save-succeeded' });
    expect(state.phase).toBe('saved');
    // Editing cannot be re-entered from saved — the dialog closes.
    expect(revpropReducer(state, { type: 'back-to-edit' }).phase).toBe('saved');
  });

  it('a failed save returns to an error state that can go back to editing with the draft intact', () => {
    let state = revpropReducer(initialRevpropState('svn:log', CURRENT), { type: 'review' });
    state = revpropReducer(state, { type: 'toggle-acknowledged', acknowledged: true });
    state = revpropReducer(state, { type: 'begin-save' });
    state = revpropReducer(state, {
      type: 'save-failed',
      error: 'E175008: revprop change blocked by pre-revprop-change hook',
    });
    expect(state.phase).toBe('error');
    if (state.phase === 'error') expect(state.error).toContain('pre-revprop-change');

    state = revpropReducer(state, { type: 'back-to-edit' });
    expect(state.phase).toBe('editing');
    // The draft survives so the user can retry without retyping.
    expect(state.draft).toBe(CURRENT.log);
  });
});

describe('revpropHasChange', () => {
  it('is false until the draft differs from the stored value', () => {
    const unchanged = initialRevpropState('svn:log', CURRENT);
    expect(revpropHasChange(unchanged, CURRENT)).toBe(false);
    const changed = revpropReducer(unchanged, { type: 'change-draft', value: 'fixed typo' });
    expect(revpropHasChange(changed, CURRENT)).toBe(true);
  });

  it('compares against the property actually selected', () => {
    let state = initialRevpropState('svn:log', CURRENT);
    // Same text as the current author, but selected as svn:log: a real change.
    state = revpropReducer(state, { type: 'change-draft', value: CURRENT.author });
    expect(revpropHasChange(state, CURRENT)).toBe(true);
  });
});

describe('currentValueOf', () => {
  it('maps each property name to its value', () => {
    expect(currentValueOf('svn:log', CURRENT)).toBe(CURRENT.log);
    expect(currentValueOf('svn:author', CURRENT)).toBe(CURRENT.author);
    expect(currentValueOf('svn:date', CURRENT)).toBe(CURRENT.date);
  });
});
