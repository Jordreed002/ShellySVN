import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../src/components/ui/CommandPalette';
import { Toolbar } from '../src/components/ui/Toolbar';

describe('core workflow keyboard accessibility', () => {
  it('executes command palette actions with arrow navigation and Enter', () => {
    const onCommit = vi.fn();
    const onUpdate = vi.fn();
    const onClose = vi.fn();

    render(
      <CommandPalette
        isOpen={true}
        onClose={onClose}
        onCommit={onCommit}
        onUpdate={onUpdate}
      />
    );

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes command palette with Escape without executing an action', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();

    render(<CommandPalette isOpen={true} onClose={onClose} onCommit={onCommit} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps toolbar view options keyboard dismissible', () => {
    render(<Toolbar onViewModeChange={vi.fn()} />);

    const viewOptions = screen.getByRole('button', { name: 'View options' });
    fireEvent.click(viewOptions);

    const menu = screen.getByRole('menu', { name: 'View options' });
    expect(menu).toBeInTheDocument();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'View options' })).not.toBeInTheDocument();
  });
});
