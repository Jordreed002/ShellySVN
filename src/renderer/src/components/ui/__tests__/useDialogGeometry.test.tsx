import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogBase } from '../DialogBase';
import {
  DIALOG_GEOMETRY_PREFIX,
  clampDialogGeometry,
  dialogGeometryStorageKey,
  sanitizeDialogGeometry,
} from '../../../hooks/useDialogGeometry';

/**
 * Store bridge mock mirroring `src/renderer/__tests__/onboarding.state.test.tsx`.
 */
function mockStore(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const get = vi.fn(async (key: string) => values.get(key));
  const set = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });
  window.api = { store: { get, set } } as unknown as Window['api'];
  return { get, set, values };
}

describe('clampDialogGeometry', () => {
  const viewport = { viewportWidth: 1024, viewportHeight: 768 };

  it('keeps a dialog fully inside the viewport', () => {
    const clamped = clampDialogGeometry(
      { x: 5000, y: -40, width: 400, height: 300 },
      viewport
    );
    expect(clamped.x).toBeLessThanOrEqual(1024 - 400);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBe(0);
  });

  it('shrinks oversized dialogs to the viewport and pins them to the origin', () => {
    const clamped = clampDialogGeometry(
      { x: 2000, y: 2000, width: 9999, height: 9999 },
      viewport
    );
    expect(clamped).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  });

  it('enforces minimum sizes', () => {
    const clamped = clampDialogGeometry(
      { x: 10, y: 10, width: 10, height: 10 },
      { ...viewport, minWidth: 300, minHeight: 240 }
    );
    expect(clamped).toEqual({ x: 10, y: 10, width: 300, height: 240 });
  });

  it('rounds to integer pixels', () => {
    const clamped = clampDialogGeometry(
      { x: 10.49, y: 20.51, width: 400.4, height: 300.6 },
      viewport
    );
    expect(clamped).toEqual({ x: 10, y: 21, width: 400, height: 301 });
  });

  it('leaves null sizes untouched (CSS-driven sizing)', () => {
    const clamped = clampDialogGeometry({ x: 5, y: 6, width: null, height: null }, viewport);
    expect(clamped).toEqual({ x: 5, y: 6, width: null, height: null });
  });
});

describe('sanitizeDialogGeometry', () => {
  it('accepts a valid persisted payload', () => {
    expect(sanitizeDialogGeometry({ x: 1, y: 2, width: 300, height: 200 })).toEqual({
      x: 1,
      y: 2,
      width: 300,
      height: 200,
    });
  });

  it('rejects malformed payloads', () => {
    expect(sanitizeDialogGeometry(undefined)).toBeNull();
    expect(sanitizeDialogGeometry('nope')).toBeNull();
    expect(sanitizeDialogGeometry({ x: 'a', y: 2 })).toBeNull();
    expect(sanitizeDialogGeometry({ y: 2 })).toBeNull();
    expect(sanitizeDialogGeometry({ x: NaN, y: 2 })).toBeNull();
  });

  it('drops non-positive sizes but keeps valid positions', () => {
    expect(sanitizeDialogGeometry({ x: 1, y: 2, width: -20, height: 'big' })).toEqual({
      x: 1,
      y: 2,
      width: null,
      height: null,
    });
  });
});

describe('dialog geometry persistence (DialogBase integration)', () => {
  beforeEach(() => {
    window.api = undefined as unknown as Window['api'];
  });

  afterEach(() => {
    window.api = undefined as unknown as Window['api'];
    document.body.style.overflow = '';
  });

  it('uses the documented store key namespace', () => {
    expect(dialogGeometryStorageKey('checkout-dialog')).toBe(
      `${DIALOG_GEOMETRY_PREFIX}checkout-dialog`
    );
  });

  it('restores persisted geometry on reopen, clamped to the viewport', async () => {
    const { set } = mockStore({
      [dialogGeometryStorageKey('geometry-dialog')]: {
        x: 5000,
        y: -100,
        width: 4096,
        height: 300,
      },
    });

    render(
      <DialogBase
        isOpen
        onClose={vi.fn()}
        dialogId="geometry-dialog"
        title="Geometry"
        className="w-[400px]"
        draggable
        resizable
      >
        <div className="modal-body">Body</div>
      </DialogBase>
    );

    const dialog = screen.getByRole('dialog', { name: 'Geometry' });
    // jsdom defaults to a 1024x768 viewport: everything above collapses to it.
    await waitFor(() => expect(dialog.style.left).toBe('0px'));
    expect(dialog.style.top).toBe('0px');
    expect(dialog.style.width).toBe('1024px');
    expect(dialog.style.height).toBe('300px');
    expect(set).not.toHaveBeenCalled();
  });

  it('saves clamped geometry when a drag gesture ends', async () => {
    const { set } = mockStore();

    render(
      <DialogBase
        isOpen
        onClose={vi.fn()}
        dialogId="draggable-dialog"
        title="Draggable"
        draggable
        resizable
        minWidth={200}
        minHeight={150}
      >
        <div className="modal-body">Body</div>
      </DialogBase>
    );

    const dialog = screen.getByRole('dialog', { name: 'Draggable' });
    const heading = screen.getByRole('heading', { name: 'Draggable' });

    // No stored geometry yet: the dialog stays CSS-centered.
    expect(dialog.style.position).toBe('');

    // Drag the header 60x30px.
    fireEvent.pointerDown(heading, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 230 });
    await waitFor(() => expect(dialog.style.left).toBe('60px'));
    expect(dialog.style.top).toBe('30px');

    // Releasing persists the clamped geometry through the store bridge.
    // A move-only seed leaves the size CSS-driven (null), so only the
    // position is recorded.
    fireEvent.pointerUp(window);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith(dialogGeometryStorageKey('draggable-dialog'), {
      x: 60,
      y: 30,
      width: null,
      height: null,
    });
  });

  it('saves geometry when a resize gesture ends, respecting minimums', async () => {
    const { set } = mockStore();

    render(
      <DialogBase
        isOpen
        onClose={vi.fn()}
        dialogId="resizable-dialog"
        title="Resizable"
        resizable
        minWidth={300}
        minHeight={200}
      >
        <div className="modal-body">Body</div>
      </DialogBase>
    );

    const dialog = screen.getByRole('dialog', { name: 'Resizable' });
    const handle = dialog.querySelector('[data-dialog-resize-handle]') as HTMLElement;
    expect(handle).toBeInTheDocument();

    // Shrink far below the minimums; the clamp keeps 300x200.
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: -500, clientY: -500 });
    fireEvent.pointerUp(window);

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    const [, persisted] = set.mock.calls[0] as [string, ReturnType<typeof sanitizeDialogGeometry>];
    expect(persisted?.width).toBe(300);
    expect(persisted?.height).toBe(200);
    expect(persisted?.x).toBe(0);
    expect(persisted?.y).toBe(0);
    expect(dialog.style.width).toBe('300px');
    expect(dialog.style.height).toBe('200px');
  });

  it('does not start a drag from interactive header controls', async () => {
    const { set } = mockStore();

    render(
      <DialogBase
        isOpen
        onClose={vi.fn()}
        dialogId="no-drag-dialog"
        title="No Drag"
        draggable
      >
        <div className="modal-body">Body</div>
      </DialogBase>
    );

    const dialog = screen.getByRole('dialog', { name: 'No Drag' });
    const closeButton = screen.getByRole('button', { name: 'Close dialog' });

    fireEvent.pointerDown(closeButton, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 400 });
    fireEvent.pointerUp(window);

    expect(dialog.style.position).toBe('');
    expect(set).not.toHaveBeenCalled();
  });
});
