import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnProperty, SvnStatusEntry } from '@shared/types';
import { IgnoreDialog } from '../IgnoreDialog';

function statusEntry(path: string, status: SvnStatusEntry['status'], isDirectory: boolean): SvnStatusEntry {
  return { path, status, isDirectory };
}

describe('IgnoreDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
    window.api.svn.proplist = vi.fn().mockResolvedValue({
      properties: [
        { name: 'svn:ignore', value: '*.tmp\nexisting' },
        { name: 'svn:global-ignores', value: 'node_modules', inherited: true, inheritedFrom: '/wc' },
      ] satisfies SvnProperty[],
    });
    window.api.svn.status = vi.fn().mockResolvedValue({
      path: '/wc/dir',
      revision: 1,
      entries: [
        statusEntry('/wc/dir/debug.log', '?', false),
        statusEntry('/wc/dir/notes.txt', '?', false),
        statusEntry('/wc/dir/node_modules', '?', true),
      ],
    });
    window.api.svn.childCommits = vi.fn().mockResolvedValue({});
    window.api.fs.listDirectory = vi.fn().mockResolvedValue([]);
  });

  afterEach(cleanup);

  it('delegate mode: shows existing patterns as locked and applies only new ones', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <IgnoreDialog
        isOpen
        onClose={onClose}
        path="/wc/dir/debug.log"
        fileName="debug.log"
        onApply={onApply}
      />
    );

    // Existing svn:ignore patterns load as locked rows.
    const patternList = await screen.findByLabelText('Ignore patterns');
    expect(within(patternList).getByText('*.tmp')).toBeTruthy();
    expect(within(patternList).getByText('existing')).toBeTruthy();

    // The file-name suggestion is pre-filled in the input.
    const input = screen.getByLabelText('Add pattern') as HTMLInputElement;
    expect(input.value).toBe('debug.log');
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    fireEvent.click(screen.getByRole('button', { name: /ignore 1 pattern/i }));

    expect(onApply).toHaveBeenCalledWith(['debug.log']);
    expect(onClose).toHaveBeenCalledOnce();
    expect(window.api.svn.propset).not.toHaveBeenCalled();
  });

  it('flags duplicate patterns and blocks apply while a lint error exists', async () => {
    const onApply = vi.fn();
    render(
      <IgnoreDialog isOpen onClose={vi.fn()} path="/wc/dir/debug.log" fileName="debug.log" onApply={onApply} />
    );

    const patternList = await screen.findByLabelText('Ignore patterns');
    expect(within(patternList).getByText('*.tmp')).toBeTruthy();

    // Try to add a pattern that duplicates a pre-existing one.
    const input = screen.getByLabelText('Add pattern');
    fireEvent.change(input, { target: { value: 'existing' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(await screen.findByText(/Pattern already in the list/)).toBeTruthy();
    // Apply stays disabled: no addable pattern would remain and lint errors block it.
    expect(
      (screen.getByRole('button', { name: /ignore \d+ patterns?/i }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('editor mode: live preview shows matched vs unmatched unversioned files', async () => {
    render(<IgnoreDialog isOpen onClose={vi.fn()} path="/wc/dir" />);

    await screen.findByLabelText('Ignore patterns');
    const matchedList = await screen.findByRole('list', { name: /unversioned items that match/i });
    // *.tmp does not match debug.log — the preview is honest about that.
    // The inherited svn:global-ignores participates in the effective set:
    expect(matchedList.textContent).toContain('node_modules');

    const unmatched = screen.getByRole('list', { name: /unversioned items that do not match/i });
    expect(unmatched.textContent).toContain('debug.log');
    expect(unmatched.textContent).toContain('notes.txt');
  });

  it('editor mode: explicit confirmation, then propset with the full merged value', async () => {
    const confirm = window.api.dialog.confirm as ReturnType<typeof vi.fn>;
    const onClose = vi.fn();
    render(<IgnoreDialog isOpen onClose={onClose} path="/wc/dir" />);

    await screen.findByLabelText('Ignore patterns');

    const input = screen.getByLabelText('Add pattern');
    fireEvent.change(input, { target: { value: 'dist' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    fireEvent.click(screen.getByRole('button', { name: /set svn:ignore/i }));

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('/wc/dir'), confirmLabel: 'Set Property' })
    );
    await waitFor(() =>
      expect(window.api.svn.propset).toHaveBeenCalledWith('/wc/dir', 'svn:ignore', '*.tmp\nexisting\ndist')
    );
    expect(await screen.findByText('svn:ignore set')).toBeTruthy();
  });

  it('apply-to-siblings writes the same value per sibling and reports failures honestly', async () => {
    (window.api.fs.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'dir', path: '/wc/dir', isDirectory: true, size: 0, modifiedTime: '' },
      { name: 'beta', path: '/wc/beta', isDirectory: true, size: 0, modifiedTime: '' },
      { name: 'file.txt', path: '/wc/file.txt', isDirectory: false, size: 0, modifiedTime: '' },
    ]);
    (window.api.svn.childCommits as ReturnType<typeof vi.fn>).mockResolvedValue({
      dir: { revision: 1, author: '', date: '' },
      beta: { revision: 1, author: '', date: '' },
      'file.txt': { revision: 1, author: '', date: '' },
    });
    (window.api.svn.propset as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('E155007: not a working copy'));

    render(<IgnoreDialog isOpen onClose={vi.fn()} path="/wc/dir" />);

    await screen.findByLabelText('Ignore patterns');

    fireEvent.click(screen.getByRole('button', { name: /apply to sibling directories/i }));
    const betaLabel = await screen.findByText('beta');
    fireEvent.click(betaLabel.closest('label')!.querySelector('input')!);

    fireEvent.click(screen.getByRole('button', { name: /set svn:ignore/i }));

    await waitFor(() =>
      expect(window.api.svn.propset).toHaveBeenCalledTimes(2)
    );
    expect(window.api.svn.propset).toHaveBeenNthCalledWith(
      1,
      '/wc/dir',
      'svn:ignore',
      '*.tmp\nexisting'
    );
    expect(window.api.svn.propset).toHaveBeenNthCalledWith(
      2,
      '/wc/beta',
      'svn:ignore',
      '*.tmp\nexisting'
    );
    // The failing sibling is reported, not swallowed.
    expect(await screen.findByText(/1 of 2 directories failed/)).toBeTruthy();
    const results = screen.getByRole('list', { name: /property write results/i });
    expect(results.textContent).toContain('/wc/beta');
    expect(results.textContent).toContain('E155007');
  });

  it('draft mode: hands the full value to onApplyValue without touching IPC', async () => {
    const onApplyValue = vi.fn();
    const onClose = vi.fn();
    render(
      <IgnoreDialog
        isOpen
        onClose={onClose}
        path="/wc/dir"
        initialValue="*.tmp"
        propertyName="svn:ignore"
        onApplyValue={onApplyValue}
      />
    );

    await screen.findByLabelText('Ignore patterns');

    const input = screen.getByLabelText('Add pattern');
    fireEvent.change(input, { target: { value: 'dist' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply to draft/i }));

    expect(onApplyValue).toHaveBeenCalledWith('*.tmp\ndist');
    expect(onClose).toHaveBeenCalledOnce();
    expect(window.api.svn.propset).not.toHaveBeenCalled();
  });
});
