import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoDiagnostics } from '@shared/types';
import { RepoDiagnosticsPanel } from '../RepoDiagnostics';
import { createMockElectronAPI } from '../../../../__test-utils__/electron-api-mock';

function createDiagnostics(overrides: Partial<RepoDiagnostics> = {}): RepoDiagnostics {
  return {
    svnClientPath: 'svn',
    svnVersion: '1.14.0',
    minimumSvnVersion: '1.14',
    svnVersionSupported: true,
    encryptionAvailable: true,
    isPackaged: false,
    resourcesPath: null,
    resourceStatus: [],
    isValidWorkingCopy: true,
    workingCopyRoot: '/test/repo',
    repositoryRoot: 'https://svn.example.com/repo',
    repositoryUrl: 'https://svn.example.com/repo/trunk',
    repositoryUuid: 'uuid',
    hasCredentials: false,
    credentialRealm: null,
    credentialUsername: null,
    connectionStatus: 'ssl-error',
    connectionError: 'issuer is not trusted',
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RepoDiagnosticsPanel workingCopyPath="/test/repo" onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

describe('RepoDiagnosticsPanel', () => {
  beforeEach(() => {
    const api = createMockElectronAPI();
    api.svn.diagnostics = vi.fn().mockResolvedValue(createDiagnostics());
    api.svn.trustServerCertificate = vi.fn().mockResolvedValue({ success: true });
    window.api = api;
  });

  it('shows a re-trust button for SSL certificate errors and calls the trust API', async () => {
    renderPanel();

    const button = await screen.findByRole('button', { name: /re-trust certificate/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(window.api.svn.trustServerCertificate).toHaveBeenCalledWith(
        'https://svn.example.com/repo/trunk',
        'issuer is not trusted'
      );
    });
  });

  it('exposes the modal and icon actions with accessible names', async () => {
    renderPanel();

    expect(await screen.findByRole('dialog', { name: 'Repository Diagnostics' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy redacted diagnostics' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh repository diagnostics' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close repository diagnostics' })).toBeTruthy();
  });
});
