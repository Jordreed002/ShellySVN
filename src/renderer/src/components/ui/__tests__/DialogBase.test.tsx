import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogBase } from '../DialogBase';
import { dialogStackDepth } from '../../../lib/dialogStack';

/** Mirrors the nested-confirm shape used by LockManagementDialog. */
function NestedDialogsFixture() {
  const [parentClosed, setParentClosed] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const closeChild = vi.fn(() => setChildOpen(false));
  const closeParent = vi.fn(() => setParentClosed(true));

  return (
    <div>
      <button type="button" onClick={() => setParentClosed(false)}>
        Reset parent
      </button>
      {!parentClosed && (
        <DialogBase
          isOpen
          onClose={closeParent}
          dialogId="parent-dialog"
          title="Parent Dialog"
          className="w-[400px]"
        >
          <div className="modal-body">
            <button type="button" onClick={() => setChildOpen(true)}>
              Open child
            </button>
          </div>
          {childOpen && (
            <DialogBase
              isOpen
              onClose={closeChild}
              dialogId="child-dialog"
              title="Child Dialog"
              className="w-[300px]"
            >
              <div className="modal-body">
                <button type="button">Child action</button>
              </div>
            </DialogBase>
          )}
        </DialogBase>
      )}
    </div>
  );
}

describe('DialogBase', () => {
  beforeEach(() => {
    window.api = undefined as unknown as Window['api'];
  });

  afterEach(() => {
    window.api = undefined as unknown as Window['api'];
    document.body.style.overflow = '';
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <DialogBase isOpen={false} onClose={vi.fn()} title="Hidden">
        <p>content</p>
      </DialogBase>
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes dialog semantics: role, aria-modal, labelled heading', () => {
    render(
      <DialogBase isOpen onClose={vi.fn()} dialogId="semantics" title="Semantics Dialog">
        <div className="modal-body">Body</div>
      </DialogBase>
    );
    const dialog = screen.getByRole('dialog', { name: 'Semantics Dialog' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes only the top-most dialog on Escape; the parent survives', async () => {
    render(<NestedDialogsFixture />);

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Parent Dialog' })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open child' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Child Dialog' })).toBeInTheDocument()
    );
    expect(dialogStackDepth()).toBe(2);

    // Escape with the child on top closes the child only.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Child Dialog' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('dialog', { name: 'Parent Dialog' })).toBeInTheDocument();
    expect(dialogStackDepth()).toBe(1);

    // A second Escape now closes the parent.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Parent Dialog' })).not.toBeInTheDocument()
    );
    expect(dialogStackDepth()).toBe(0);
  });

  it('ignores Escape when focus lives in an outside surface (e.g. command palette)', async () => {
    const onClose = vi.fn();
    render(
      <div>
        <input aria-label="Outside surface" />
        <DialogBase isOpen onClose={onClose} dialogId="outside-focus" title="Outside Focus">
          <div className="modal-body">Body</div>
        </DialogBase>
      </div>
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    (screen.getByLabelText('Outside surface') as HTMLElement).focus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the heading on open and restores focus to the trigger on close', async () => {
    function FocusFixture() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen((prev) => !prev)}>
            Toggle dialog
          </button>
          <DialogBase isOpen={open} onClose={() => setOpen(false)} dialogId="focus" title="Focus">
            <div className="modal-body">
              <button type="button">Inner control</button>
            </div>
          </DialogBase>
        </div>
      );
    }

    render(<FocusFixture />);
    const toggle = screen.getByRole('button', { name: 'Toggle dialog' });
    toggle.focus();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Focus' })).toHaveFocus());

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('can focus the first control instead of the heading', async () => {
    render(
      <DialogBase
        isOpen
        onClose={vi.fn()}
        dialogId="first-control"
        title="First Control"
        initialFocus="first-control"
      >
        <div className="modal-body">
          <button type="button">Inner control</button>
        </div>
      </DialogBase>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inner control' })).toHaveFocus());
  });

  it('wraps Tab and Shift+Tab focus inside the dialog', async () => {
    render(
      <div>
        <button type="button">Outside page control</button>
        <DialogBase isOpen onClose={vi.fn()} dialogId="tab-trap" title="Tab Trap">
          <div className="modal-body">
            <button type="button">First action</button>
            <button type="button">Last action</button>
          </div>
        </DialogBase>
      </div>
    );

    const last = screen.getByRole('button', { name: 'Last action' });
    // The header close button precedes the body controls in DOM order, so it
    // is the first focusable stop of the wrap cycle.
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const outside = screen.getByRole('button', { name: 'Outside page control' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tab Trap' })).toHaveFocus());

    // Forward wrap: last control cycles back to the first focusable (close).
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    // Backward wrap: from the first focusable cycle to the last control.
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    // Focus that escaped to the page is pulled back inside on Tab.
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('locks background scroll while open and unlocks when closed', async () => {
    function ScrollFixture() {
      const [open, setOpen] = useState(true);
      return (
        <DialogBase isOpen={open} onClose={() => setOpen(false)} dialogId="scroll" title="Scroll">
          <div className="modal-body">Body</div>
        </DialogBase>
      );
    }

    render(<ScrollFixture />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the scroll lock while a nested dialog closes first', async () => {
    render(<NestedDialogsFixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Open child' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Child Dialog' })).toBeInTheDocument()
    );
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Child Dialog' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('dialog', { name: 'Parent Dialog' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
  });
});
