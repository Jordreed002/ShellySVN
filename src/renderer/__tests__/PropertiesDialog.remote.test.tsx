import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertiesDialog } from '../src/components/ui/PropertiesDialog';

const svnApi = {
  proplist: vi.fn(),
  propset: vi.fn(),
  propdel: vi.fn(),
  propsetRemote: vi.fn(),
  propdelRemote: vi.fn(),
  revpropget: vi.fn(),
  revpropset: vi.fn(),
  revpropdel: vi.fn(),
};
const confirmAction = vi.fn();

describe('PropertiesDialog repository properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svnApi.proplist.mockResolvedValue({
      properties: [
        { name: 'custom:owner', value: 'old-team' },
        {
          name: 'svn:mergeinfo',
          value: '/branches/feature:1-3',
          inherited: true,
          inheritedFrom: 'https://svn.example.com/repo/trunk',
        },
      ],
    });
    svnApi.propsetRemote.mockResolvedValue({ success: true });
    svnApi.revpropget.mockResolvedValue({ value: 'original log message' });
    svnApi.revpropset.mockResolvedValue({ success: true });
    confirmAction.mockResolvedValue(true);
    window.api = {
      svn: svnApi,
      dialog: { confirm: confirmAction },
    } as unknown as Window['api'];
  });

  it('loads operative and inherited URL properties without making inherited values editable', async () => {
    render(
      <PropertiesDialog
        isOpen
        onClose={vi.fn()}
        path="https://svn.example.com/repo/trunk/child"
        revision="42"
      />
    );

    expect(await screen.findByText('custom:owner')).toBeInTheDocument();
    expect(
      screen.getByText(/inherited from https:\/\/svn\.example\.com\/repo\/trunk/i)
    ).toBeInTheDocument();
    expect(screen.getAllByTitle('Edit')).toHaveLength(1);
    expect(svnApi.proplist).toHaveBeenCalledWith('https://svn.example.com/repo/trunk/child', {
      revision: '42',
      showInherited: true,
    });
  });

  it('commits an edited URL property through the remote property endpoint', async () => {
    render(<PropertiesDialog isOpen onClose={vi.fn()} path="https://svn.example.com/repo/trunk" />);

    await screen.findByText('custom:owner');
    fireEvent.click(screen.getByTitle('Edit'));
    fireEvent.change(screen.getByDisplayValue('old-team'), { target: { value: 'new-team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(screen.getByLabelText('Commit message'), {
      target: { value: 'change repository owner' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(svnApi.propsetRemote).toHaveBeenCalledWith(
        'https://svn.example.com/repo/trunk',
        'custom:owner',
        'new-team',
        'change repository owner'
      );
    });
    expect(svnApi.propset).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before rewriting a revision property', async () => {
    render(
      <PropertiesDialog
        isOpen
        onClose={vi.fn()}
        path="https://svn.example.com/repo"
        revision="42"
      />
    );

    await screen.findByText('custom:owner');
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByLabelText('Revision property value')).toHaveValue(
      'original log message'
    );
    fireEvent.change(screen.getByLabelText('Revision property value'), {
      target: { value: 'corrected log message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Revision Property' }));

    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(svnApi.revpropset).toHaveBeenCalledWith(
      'https://svn.example.com/repo',
      'svn:log',
      'corrected log message',
      '42'
    );
  });
});
