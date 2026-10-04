import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { ShelfDialog } from '../components/ShelfDialog';

const target = {
  name: 'trunk',
  repoPath: 'clients/acme/trunk',
  localPath: 'C:/wc/acme/trunk',
  kind: 'dir' as const,
};

function renderDialog(over: { onSaved?: () => void } = {}) {
  return render(
    <ShelfDialog
      isOpen
      onClose={vi.fn()}
      target={target}
      onSaved={over.onSaved ?? vi.fn()}
    />
  );
}

describe('ShelfDialog (repo browser)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
  });

  afterEach(cleanup);

  it('names the path on disk it will shelve, and the command scoped to it', () => {
    renderDialog();

    expect(screen.getByText('C:/wc/acme/trunk')).toBeTruthy();
    // The whole point of shelving from the browser: the command targets the
    // selected path, not the working-copy root.
    expect(screen.getByText(/svn shelve/).textContent).toContain('C:/wc/acme/trunk');
  });

  it('refuses to shelve until a name is given', () => {
    renderDialog();

    expect(
      (screen.getByRole('button', { name: /shelve changes/i }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(window.api.svn.shelve.save).not.toHaveBeenCalled();
  });

  it('shelves the selected path through the save IPC and reports success', async () => {
    const onSaved = vi.fn();
    renderDialog({ onSaved });

    fireEvent.change(screen.getByLabelText(/shelf name/i), { target: { value: 'payments-wip' } });
    fireEvent.change(screen.getByLabelText(/^message/i), {
      target: { value: 'WIP while the CI reruns' },
    });
    fireEvent.click(screen.getByRole('button', { name: /shelve changes/i }));

    await waitFor(() =>
      expect(window.api.svn.shelve.save).toHaveBeenCalledWith(
        'payments-wip',
        'C:/wc/acme/trunk',
        'WIP while the CI reruns'
      )
    );
    expect(await screen.findByTestId('shelf-action-notice')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledWith('payments-wip');
  });

  it('omits the message argument when the field is left blank', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(/shelf name/i), { target: { value: 'quick' } });
    fireEvent.click(screen.getByRole('button', { name: /shelve changes/i }));

    await waitFor(() =>
      expect(window.api.svn.shelve.save).toHaveBeenCalledWith('quick', 'C:/wc/acme/trunk', undefined)
    );
  });

  it('surfaces a failed shelve as a dismissible error and keeps the name', async () => {
    window.api.svn.shelve.save = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'A shelf named "quick" already exists.' });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/shelf name/i), { target: { value: 'quick' } });
    fireEvent.click(screen.getByRole('button', { name: /shelve changes/i }));

    const alert = await screen.findByTestId('shelf-action-error');
    expect(alert.textContent).toContain('already exists');
    // The name is kept so it can be corrected, not re-entered.
    expect((screen.getByLabelText(/shelf name/i) as HTMLInputElement).value).toBe('quick');

    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    expect(screen.queryByTestId('shelf-action-error')).toBeNull();
  });
});
