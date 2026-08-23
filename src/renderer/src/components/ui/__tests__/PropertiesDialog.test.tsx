import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnProperty } from '@shared/types';
import { PropertiesDialog } from '../PropertiesDialog';

describe('PropertiesDialog structured editors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
    window.api.svn.proplist = vi.fn().mockResolvedValue({
      properties: [
        { name: 'svn:keywords', value: 'Rev' },
        { name: 'svn:externals', value: '^/vendor vendor' },
        { name: 'svn:ignore', value: 'build' },
      ] satisfies SvnProperty[],
    });
  });
  afterEach(cleanup);

  it('feeds svn:keywords edits through the single Save Changes write path', async () => {
    render(<PropertiesDialog isOpen onClose={vi.fn()} path="/wc/src/calc.c" />);

    expect((await screen.findAllByText('svn:keywords')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Open keyword editor' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open keyword editor' }));
    const author = await screen.findByRole('checkbox', { name: 'Author keyword' });
    fireEvent.click(author);
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    // Back in the properties list, the draft changed so Save is enabled.
    const save = await waitFor(() => {
      const button = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(window.api.svn.propset).toHaveBeenCalledWith('/wc/src/calc.c', 'svn:keywords', 'Rev Author')
    );
    // The structured editor never writes on its own in this mode.
    expect(window.api.svn.propset).toHaveBeenCalledTimes(1);
  });

  it('feeds svn:externals edits through the same path', async () => {
    render(<PropertiesDialog isOpen onClose={vi.fn()} path="/wc/trunk" />);

    expect((await screen.findAllByText('svn:externals')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open externals manager' }));

    const remove = await screen.findByLabelText('Remove vendor');
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(window.api.svn.propset).toHaveBeenCalledWith('/wc/trunk', 'svn:externals', '')
    );
    expect(window.api.svn.propset).toHaveBeenCalledTimes(1);
  });

  it('feeds svn:ignore pattern edits through the same path', async () => {
    render(<PropertiesDialog isOpen onClose={vi.fn()} path="/wc/trunk" />);

    expect((await screen.findAllByText('svn:ignore')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open ignore pattern editor' }));

    const input = await screen.findByLabelText('Add pattern');
    fireEvent.change(input, { target: { value: 'dist' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply to draft/i }));

    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(window.api.svn.propset).toHaveBeenCalledWith('/wc/trunk', 'svn:ignore', 'build\ndist')
    );
    expect(window.api.svn.propset).toHaveBeenCalledTimes(1);
  });
});
