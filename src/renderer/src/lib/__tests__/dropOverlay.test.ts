import { describe, expect, it } from 'vitest';

import { DROP_OVERLAY_IDLE, dropOverlayReducer } from '../dropOverlay';

describe('dropOverlayReducer', () => {
  it('goes idle → dragging on drag-enter and back on drag-leave', () => {
    let state = dropOverlayReducer(DROP_OVERLAY_IDLE, { type: 'drag-enter' });
    expect(state.phase).toBe('dragging');
    state = dropOverlayReducer(state, { type: 'drag-leave' });
    expect(state).toEqual(DROP_OVERLAY_IDLE);
  });

  it('a drop with a folder path moves to inspecting and carries the path', () => {
    const state = dropOverlayReducer(
      { phase: 'dragging' },
      { type: 'drop', path: '/dropped/wc' }
    );
    expect(state).toEqual({ phase: 'inspecting', path: '/dropped/wc' });
  });

  it('a drop without a readable path lands on a dismissible error', () => {
    const state = dropOverlayReducer({ phase: 'dragging' }, { type: 'drop' });
    expect(state.phase).toBe('error');
    expect(state.message).toBe('Drop a working-copy folder to open it.');
  });

  it('inspection resolves to idle on success and to a sticky error on failure', () => {
    const inspecting = { phase: 'inspecting' as const, path: '/w' };
    expect(dropOverlayReducer(inspecting, { type: 'inspect-ok' })).toEqual(DROP_OVERLAY_IDLE);
    expect(dropOverlayReducer(inspecting, { type: 'inspect-fail', message: 'not a WC' })).toEqual({
      phase: 'error',
      path: '/w',
      message: 'not a WC',
    });
  });

  it('dismiss clears everything, including errors', () => {
    expect(dropOverlayReducer({ phase: 'error', message: 'x' }, { type: 'dismiss' })).toEqual(
      DROP_OVERLAY_IDLE
    );
  });

  it('guards against impossible transitions', () => {
    // Leaves while inspecting do not cancel the inspection.
    expect(dropOverlayReducer({ phase: 'inspecting', path: '/w' }, { type: 'drag-leave' }).phase).toBe(
      'inspecting'
    );
    // A second drag can interrupt an error but not an inspection.
    expect(dropOverlayReducer({ phase: 'error', message: 'x' }, { type: 'drag-enter' }).phase).toBe(
      'dragging'
    );
    // Drops only count while dragging.
    expect(dropOverlayReducer(DROP_OVERLAY_IDLE, { type: 'drop', path: '/w' }).phase).toBe('idle');
    // Success/failure only count while inspecting.
    expect(dropOverlayReducer({ phase: 'dragging' }, { type: 'inspect-ok' }).phase).toBe('dragging');
    expect(dropOverlayReducer(DROP_OVERLAY_IDLE, { type: 'inspect-fail', message: 'x' }).phase).toBe(
      'idle'
    );
  });
});
