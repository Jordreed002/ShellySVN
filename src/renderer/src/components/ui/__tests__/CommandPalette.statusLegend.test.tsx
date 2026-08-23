/**
 * The status-legend palette action (#94): it registers only when the
 * controller wires it, and executing it calls back and closes the palette.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CommandPalette } from '../CommandPalette';

async function renderPalette(props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  render(
    <CommandPalette
      isOpen
      onClose={vi.fn()}
      onShowShortcuts={vi.fn()}
      onShowStatusLegend={vi.fn()}
      {...props}
    />
  );
  // Flush the async recent-usage load triggered on open.
  await act(async () => {});
}

describe('CommandPalette — status legend action', () => {
  beforeEach(() => {
    window.api = undefined as unknown as Window['api'];
  });

  it('registers the legend action under Help when wired', async () => {
    await renderPalette();
    expect(screen.getByText('What the status colors mean')).toBeInTheDocument();
  });

  it('omits the legend action when no handler is wired', async () => {
    await renderPalette({ onShowStatusLegend: undefined });
    expect(screen.queryByText('What the status colors mean')).not.toBeInTheDocument();
  });

  it('executes the action and closes the palette', async () => {
    const onShowStatusLegend = vi.fn();
    const onClose = vi.fn();
    await renderPalette({ onShowStatusLegend, onClose });

    fireEvent.click(screen.getByText('What the status colors mean').closest('.command-palette-item')!);
    expect(onShowStatusLegend).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('matches the legend by keyword search', async () => {
    await renderPalette();
    fireEvent.change(screen.getByPlaceholderText('Run a command…'), {
      target: { value: 'legend' },
    });
    expect(screen.getByText('What the status colors mean')).toBeInTheDocument();
  });
});
