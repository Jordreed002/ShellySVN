import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSettings } from '../src/components/settings/SettingsPanels';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';

const authApi = {
  getStatus: vi.fn(),
  beginSession: vi.fn(),
  resumeSession: vi.fn(),
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
    authApi.beginSession.mockResolvedValue({
      id: 'opaque-session',
      realm: 'https://svn.example.com/repo',
      username: 'bob',
      persistent: true,
      expiresAt: null,
    });
    authApi.delete.mockResolvedValue({ success: true });
    authApi.clear.mockResolvedValue({ success: true });

    window.api = { auth: authApi } as unknown as Window['api'];
  });

  it('updates a saved credential from the settings list', async () => {
    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);

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
      expect(authApi.beginSession).toHaveBeenCalledWith({
        realm: 'https://svn.example.com/repo',
        username: 'bob',
        password: 'new-secret',
        persistence: 'stored',
      });
    });
  });

  it('deletes and clears saved credentials from settings', async () => {
    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);

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

  it('wires SSH client and agent settings into the saved application settings', async () => {
    const onChange = vi.fn();
    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={onChange} />);
    await screen.findByText('alice');

    fireEvent.change(screen.getByLabelText('SSH client'), {
      target: { value: '/usr/local/bin/ssh' },
    });
    expect(onChange).toHaveBeenCalledWith('sshSettings', {
      sshClientPath: '/usr/local/bin/ssh',
      useAgent: true,
      keys: [],
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /use ssh-agent/i }));
    expect(onChange).toHaveBeenCalledWith('sshSettings', {
      sshClientPath: '',
      useAgent: false,
      keys: [],
    });
  });
});
