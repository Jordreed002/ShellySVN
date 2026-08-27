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
  reveal: vi.fn(),
};

const svnApi = {
  nativeAuth: {
    list: vi.fn(),
    remove: vi.fn(),
  },
  verifyCredentials: vi.fn(),
};

const monitorApi = {
  getWorkingCopies: vi.fn(),
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
    svnApi.nativeAuth.list.mockResolvedValue([
      {
        kind: 'svn.simple',
        realm: '<https://tortoise.example.com:443> Company Repo',
        username: 'tortoise-user',
      },
    ]);
    svnApi.nativeAuth.remove.mockResolvedValue({ success: true });
    svnApi.verifyCredentials.mockResolvedValue({ ok: true });
    monitorApi.getWorkingCopies.mockResolvedValue([
      {
        path: 'C:/code/company-trunk',
        url: 'https://tortoise.example.com/company/trunk',
        revision: 42,
        hasChanges: false,
        lastChecked: 1,
        isMonitored: true,
      },
    ]);

    window.api = { auth: authApi, svn: svnApi, monitor: monitorApi } as unknown as Window['api'];
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

  it('adds a credential for a working copy created by another client and verifies it', async () => {
    authApi.list
      .mockResolvedValueOnce([{ realm: 'https://svn.example.com/repo', username: 'alice', createdAt: 1 }])
      .mockResolvedValue([
        { realm: 'https://svn.example.com/repo', username: 'alice', createdAt: 1 },
        { realm: 'https://tortoise.example.com/company/trunk', username: 'carol', createdAt: 2 },
      ]);

    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);

    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('button', { name: /add credential/i }));
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://tortoise.example.com/company/trunk' },
    });
    fireEvent.change(screen.getByLabelText('New credential username'), {
      target: { value: 'carol' },
    });
    fireEvent.change(screen.getByLabelText('New credential password'), {
      target: { value: 'hunter2' },
    });
    fireEvent.click(screen.getByLabelText('Save new credential'));

    await waitFor(() => {
      expect(authApi.beginSession).toHaveBeenCalledWith({
        realm: 'https://tortoise.example.com/company/trunk',
        username: 'carol',
        password: 'hunter2',
        persistence: 'stored',
      });
    });
    await screen.findByText('carol');

    await waitFor(() => {
      expect(svnApi.verifyCredentials).toHaveBeenCalledWith(
        'https://tortoise.example.com/company/trunk',
        'carol',
        'hunter2'
      );
    });
    expect(await screen.findByText(/credentials verified against/i)).toBeInTheDocument();
  });

  it('suggests repository URLs from monitored working copies when adding a credential', async () => {
    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);
    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('button', { name: /add credential/i }));

    await waitFor(() => {
      expect(monitorApi.getWorkingCopies).toHaveBeenCalled();
    });
    expect(
      document.querySelector(
        'datalist#add-credential-known-urls option[value="https://tortoise.example.com/company/trunk"]'
      )
    ).not.toBeNull();
  });

  it('reports a failed verification without discarding the saved credential', async () => {
    svnApi.verifyCredentials.mockResolvedValue({
      ok: false,
      reason: 'auth',
      message: 'svn: E170001',
    });

    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);
    await screen.findByText('alice');

    fireEvent.click(screen.getByRole('button', { name: /add credential/i }));
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://svn.example.com/repo' },
    });
    fireEvent.change(screen.getByLabelText('New credential username'), {
      target: { value: 'carol' },
    });
    fireEvent.change(screen.getByLabelText('New credential password'), {
      target: { value: 'wrong-pass' },
    });
    fireEvent.click(screen.getByLabelText('Save new credential'));

    expect(await screen.findByText(/rejected these credentials/i)).toBeInTheDocument();
    expect(await screen.findByText('alice')).toBeInTheDocument();
  });

  it('reveals and hides the stored password for a saved credential', async () => {
    authApi.reveal.mockResolvedValue({
      realm: 'https://svn.example.com/repo',
      username: 'alice',
      password: 'the-stored-secret',
      createdAt: 1,
      encrypted: true,
    });

    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);
    await screen.findByText('alice');

    expect(screen.queryByText('the-stored-secret')).toBeNull();
    fireEvent.click(screen.getByLabelText('Reveal password for https://svn.example.com/repo'));

    expect(await screen.findByText('the-stored-secret')).toBeInTheDocument();
    expect(authApi.reveal).toHaveBeenCalledWith('https://svn.example.com/repo');

    fireEvent.click(screen.getByLabelText('Hide shown password for alice'));
    expect(screen.queryByText('the-stored-secret')).toBeNull();
  });

  it('flags a stored credential whose password is empty', async () => {
    authApi.reveal.mockResolvedValue({
      realm: 'https://svn.example.com/repo',
      username: 'alice',
      password: '',
      createdAt: 1,
      encrypted: true,
    });

    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);
    await screen.findByText('alice');

    fireEvent.click(screen.getByLabelText('Reveal password for https://svn.example.com/repo'));
    expect(await screen.findByText('(empty — no password stored)')).toBeInTheDocument();
  });

  it('lists native Subversion cache entries and removes them', async () => {
    render(<AuthSettings isOpen={true} settings={DEFAULT_SETTINGS} onChange={vi.fn()} />);

    const entry = await screen.findByText('tortoise-user');
    expect(entry).toBeInTheDocument();
    expect(screen.getByText('<https://tortoise.example.com:443> Company Repo')).toBeInTheDocument();

    fireEvent.click(
      screen.getByLabelText(
        'Delete native cached credential for <https://tortoise.example.com:443> Company Repo'
      )
    );
    await waitFor(() => {
      expect(svnApi.nativeAuth.remove).toHaveBeenCalledWith([
        '<https://tortoise.example.com:443> Company Repo',
      ]);
    });
    expect(
      screen.queryByLabelText(
        'Delete native cached credential for <https://tortoise.example.com:443> Company Repo'
      )
    ).toBeNull();
  });
});
