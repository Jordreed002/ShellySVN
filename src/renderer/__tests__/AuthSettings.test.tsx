import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSettings } from '../src/components/settings/SettingsPanels';

const authApi = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  has: vi.fn(),
  clear: vi.fn(),
  isEncryptionAvailable: vi.fn(),
};

describe('AuthSettings credential management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.list.mockResolvedValue([
      {
        realm: 'https://svn.example.com/repo',
        username: 'alice',
        createdAt: 1,
      },
    ]);
    authApi.isEncryptionAvailable.mockResolvedValue(true);
    authApi.set.mockResolvedValue({ success: true });
    authApi.delete.mockResolvedValue({ success: true });
    authApi.clear.mockResolvedValue({ success: true });

    window.api = { auth: authApi } as unknown as Window['api'];
    window.electron = {
      process: { platform: 'win32', versions: { node: '1', chrome: '1', electron: '1' } },
      ipcRenderer: {
        send: vi.fn(),
        invoke: vi.fn(),
        on: vi.fn(),
      },
    };
  });

  it('updates a saved credential from the settings list', async () => {
    render(<AuthSettings isOpen={true} />);

    await screen.findByText('alice');
    fireEvent.click(screen.getByLabelText('Edit credentials for https://svn.example.com/repo'));
    fireEvent.change(screen.getByLabelText('Username for https://svn.example.com/repo'), {
      target: { value: 'bob' },
    });
    fireEvent.change(screen.getByLabelText('New password for https://svn.example.com/repo'), {
      target: { value: 'new-secret' },
    });
    fireEvent.click(screen.getByLabelText('Save credentials for https://svn.example.com/repo'));

    await waitFor(() => {
      expect(authApi.set).toHaveBeenCalledWith(
        'https://svn.example.com/repo',
        'bob',
        'new-secret'
      );
    });
  });

  it('deletes and clears saved credentials from settings', async () => {
    render(<AuthSettings isOpen={true} />);

    await screen.findByText('alice');
    fireEvent.click(screen.getByLabelText('Delete credentials for https://svn.example.com/repo'));

    await waitFor(() => {
      expect(authApi.delete).toHaveBeenCalledWith('https://svn.example.com/repo');
    });

    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('button', { name: /clear all credentials/i }));

    await waitFor(() => {
      expect(authApi.clear).toHaveBeenCalled();
    });
  });
});
