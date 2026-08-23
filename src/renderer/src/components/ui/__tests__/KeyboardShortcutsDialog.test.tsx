import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { KeyboardShortcutsDialog } from '../KeyboardShortcutsDialog';

const OVERRIDES_KEY = 'shellysvn:shortcut-overrides:v1';

function mockStore(getValue: unknown) {
  const get = vi.fn().mockResolvedValue(getValue);
  const set = vi.fn().mockResolvedValue(undefined);
  window.api = { store: { get, set } } as unknown as Window['api'];
  return { get, set };
}

async function renderDialog(getValue: unknown = null) {
  const { get, set } = mockStore(getValue);
  render(<KeyboardShortcutsDialog isOpen onClose={vi.fn()} />);
  // Wait for the persisted overrides to load (falling back to the legacy key).
  await waitFor(() => expect(get).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { set };
}

/** The `flex` row that contains a shortcut description. */
function rowFor(description: string): HTMLElement {
  const row = screen.getByText(description).closest('div.flex');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe('KeyboardShortcutsDialog cheat sheet', () => {
  beforeEach(() => {
    window.api = undefined as unknown as Window['api'];
  });

  it('shows the reference groups and dialog shortcuts', async () => {
    render(<KeyboardShortcutsDialog isOpen onClose={vi.fn()} />);
    // Flush the (unmocked, failing) override load on mount.
    await act(async () => {});
    for (const label of [
      'Navigation',
      'Selection',
      'SVN Actions',
      'Conflicts',
      'View',
      'General',
      'Dialogs',
      'Commit changes',
      'Update working copy',
      'Next conflict',
      'Close dialog',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('reflects a remapped binding in the sheet', async () => {
    await renderDialog({ commit: { key: 'Ctrl+Shift+K', enabled: true } });

    // Default tab is the cheat sheet: once overrides load, the Commit row
    // shows the remapped combo instead of the default Ctrl+S.
    const row = rowFor('Commit changes');
    await waitFor(() => expect(within(row).getByText('K')).toBeInTheDocument());
    const keys = within(row).getAllByText(/^(Ctrl|Shift|K)$/);
    expect(keys.map((node) => node.textContent)).toEqual(['Ctrl', 'Shift', 'K']);
  });
});

describe('KeyboardShortcutsDialog customize tab', () => {
  beforeEach(() => {
    window.api = undefined as unknown as Window['api'];
  });

  it('records a new key and persists only the override', async () => {
    const { set } = await renderDialog(null);

    fireEvent.click(screen.getByRole('tab', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record a new key for Commit' }));

    expect(screen.getByText('Press the new key… Esc cancels')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });

    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(OVERRIDES_KEY, {
        commit: { key: 'Ctrl+Shift+K', enabled: true },
      })
    );
    expect(screen.getByText('Ctrl+Shift+K')).toBeInTheDocument();
  });

  it('ignores lone modifier presses and cancels on Escape', async () => {
    await renderDialog(null);

    fireEvent.click(screen.getByRole('tab', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record a new key for Commit' }));

    fireEvent.keyDown(window, { key: 'Shift' });
    fireEvent.keyDown(window, { key: 'Control' });
    expect(screen.getByText('Press the new key… Esc cancels')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Press the new key… Esc cancels')).not.toBeInTheDocument();
  });

  it('warns when the recorded key conflicts with another binding', async () => {
    const { set } = await renderDialog(null);

    fireEvent.click(screen.getByRole('tab', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record a new key for Commit' }));
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('already bound to "Update"');
    // A conflicting key is never persisted.
    expect(set).not.toHaveBeenCalledWith(
      OVERRIDES_KEY,
      expect.objectContaining({ commit: expect.anything() })
    );
  });

  it('offers a per-binding reset and a global reset', async () => {
    const { set } = await renderDialog({ commit: { key: 'Ctrl+Shift+K', enabled: true } });

    fireEvent.click(screen.getByRole('tab', { name: 'Customize' }));
    const resetButton = await screen.findByRole('button', { name: 'Reset Commit to Ctrl+S' });
    fireEvent.click(resetButton);
    await waitFor(() => expect(set).toHaveBeenCalledWith(OVERRIDES_KEY, {}));

    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(OVERRIDES_KEY, expect.objectContaining({})));
  });

  it('persists disabling a binding', async () => {
    const { set } = await renderDialog(null);

    fireEvent.click(screen.getByRole('tab', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Disable Commit' }));

    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(OVERRIDES_KEY, {
        commit: { key: 'Ctrl+S', enabled: false },
      })
    );
  });
});
