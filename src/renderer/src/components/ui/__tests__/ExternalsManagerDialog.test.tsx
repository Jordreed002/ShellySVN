import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { ExternalsManagerDialog } from '../ExternalsManagerDialog';

const INITIAL_VALUE = [
  '# deps managed here',
  'http://svn.example.com/vendor@1335 -r 1335 vendor',
  'deps -r HEAD https://svn.example.com/deps',
  'garbage line here',
].join('\n');

function renderDialog(overrides: Partial<React.ComponentProps<typeof ExternalsManagerDialog>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    path: '/wc/trunk',
    initialValue: INITIAL_VALUE,
    ...overrides,
  };
  render(<ExternalsManagerDialog {...props} />);
  return props;
}

describe('ExternalsManagerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
  });
  afterEach(cleanup);

  it('renders a table row per definition plus comments and parse errors', async () => {
    renderDialog();

    const table = await screen.findByLabelText('svn:externals definitions');
    expect(table.textContent).toContain('vendor');
    expect(table.textContent).toContain('http://svn.example.com/vendor');
    expect(table.textContent).toContain('1335');
    expect(table.textContent).toContain('deps');
    expect(table.textContent).toContain('# deps managed here');
    // Unparseable line is surfaced, not dropped.
    expect(table.textContent).toContain('garbage line here');
    expect(table.textContent).toContain('Too many tokens');
    // Legacy layout is called out inline.
    expect(table.textContent).toContain('legacy layout');
  });

  it('validates edited fields and blocks the row save on bad input', async () => {
    renderDialog();

    const editButtons = await screen.findAllByLabelText(/^Edit /);
    fireEvent.click(editButtons[0]);

    const urlInput = screen.getByLabelText('External URL');
    fireEvent.change(urlInput, { target: { value: 'not a url' } });
    expect(await screen.findByText(/Expected a URL/i)).toBeTruthy();
    expect((screen.getByLabelText('Save row') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(urlInput, { target: { value: '^/vendor/zlib@1335' } });
    expect((screen.getByLabelText('Save row') as HTMLButtonElement).disabled).toBe(false);
  });

  it('adds a definition, edits peg/operative revisions, and formats canonically on apply', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onApply, onClose });

    await screen.findByText('vendor');

    fireEvent.click(screen.getByRole('button', { name: /add definition/i }));
    fireEvent.change(screen.getByLabelText('Local path'), { target: { value: 'third-party' } });
    fireEvent.change(screen.getByLabelText('External URL'), { target: { value: '^/vendor/zlib' } });
    fireEvent.change(screen.getByLabelText('Peg revision'), { target: { value: '1335' } });
    fireEvent.change(screen.getByLabelText('Operative revision'), { target: { value: 'HEAD' } });
    fireEvent.click(screen.getByLabelText('Save row'));

    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const value = onApply.mock.calls[0][0] as string;
    const lines = value.split('\n');
    expect(lines[0]).toBe('# deps managed here');
    expect(lines).toContain('http://svn.example.com/vendor@1335 -r 1335 vendor');
    // Legacy row is rewritten URL-first.
    expect(lines).toContain('https://svn.example.com/deps -r HEAD deps');
    expect(lines).toContain('^/vendor/zlib@1335 -r HEAD third-party');
    // Unparseable line preserved verbatim.
    expect(lines).toContain('garbage line here');
    expect(onClose).toHaveBeenCalledOnce();
    expect(window.api.svn.propset).not.toHaveBeenCalled();
  });

  it('removes rows', async () => {
    const onApply = vi.fn();
    renderDialog({ onApply });

    const removeVendor = await screen.findByLabelText('Remove vendor');
    fireEvent.click(removeVendor);
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    const value = onApply.mock.calls[0][0] as string;
    expect(value).not.toContain('vendor');
    expect(value).toContain('https://svn.example.com/deps -r HEAD deps');
  });

  it('self-write mode: asks for confirmation and propsets the formatted value', async () => {
    renderDialog(); // no onApply -> self-write

    await screen.findByText('vendor');
    fireEvent.click(screen.getByRole('button', { name: /set svn:externals/i }));

    expect(window.api.dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('/wc/trunk'),
        confirmLabel: 'Set Property',
      })
    );
    await waitFor(() =>
      expect(window.api.svn.propset).toHaveBeenCalledWith(
        '/wc/trunk',
        'svn:externals',
        expect.stringContaining('http://svn.example.com/vendor@1335 -r 1335 vendor')
      )
    );
    expect(await screen.findByText('svn:externals updated')).toBeTruthy();
  });

  it('reports a failed write instead of pretending success', async () => {
    (window.api.svn.propset as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('E200009: could not set property')
    );
    renderDialog();

    await screen.findByText('vendor');
    fireEvent.click(screen.getByRole('button', { name: /set svn:externals/i }));

    expect(await screen.findByText(/E200009/)).toBeTruthy();
    expect(screen.queryByText('svn:externals updated')).toBeNull();
  });
});
