import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFocusTrap } from '../src/hooks/useFocusTrap';

function FocusTrapFixture({
  active,
  onEscape = vi.fn(),
}: {
  active: boolean;
  onEscape?: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({
    active,
    onEscape,
    returnFocus: true,
  });

  return (
    <div>
      <button type="button">Before dialog</button>
      <div ref={trapRef} role="dialog" aria-modal="true">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </div>
    </div>
  );
}

describe('useFocusTrap', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return this.parentElement;
      },
    });
  });

  it('focuses the first dialog control and wraps Tab navigation', async () => {
    const onEscape = vi.fn();
    render(<FocusTrapFixture active={true} onEscape={onEscape} />);

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });

    await waitFor(() => expect(first).toHaveFocus());

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the previously focused element when deactivated', async () => {
    const { rerender } = render(<FocusTrapFixture active={false} />);
    const beforeDialog = screen.getByRole('button', { name: 'Before dialog' });
    const first = screen.getByRole('button', { name: 'First action' });

    beforeDialog.focus();
    expect(beforeDialog).toHaveFocus();

    rerender(<FocusTrapFixture active={true} />);
    await waitFor(() => expect(first).toHaveFocus());

    rerender(<FocusTrapFixture active={false} />);
    await waitFor(() => expect(beforeDialog).toHaveFocus());
  });
});
