import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoDiagnostics, WorkingCopyHealthReport } from '@shared/types';
import { RepoDiagnosticsPanel } from '../RepoDiagnostics';
import { dialogStackIds } from '@renderer/lib/dialogStack';
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

function createHealthReport(): WorkingCopyHealthReport {
  return {
    workingCopyPath: '/test/repo',
    scannedAt: new Date().toISOString(),
    minimumRevision: 100,
    maximumRevision: 200,
    counts: { changes: 1, conflicts: 0, switched: 0, externals: 0, unversioned: 0, ignored: 0 },
    issues: [
      {
        id: 'missing-1',
        kind: 'missing',
        severity: 'warning',
        title: 'Missing versioned paths',
        detail: '1 versioned path is absent locally.',
        paths: ['/test/repo/missing.txt'],
      },
    ],
  };
}

function renderPanel(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RepoDiagnosticsPanel workingCopyPath="/test/repo" onClose={onClose} />
      </QueryClientProvider>
    ),
  };
}

describe('RepoDiagnosticsPanel', () => {
  beforeEach(() => {
    const api = createMockElectronAPI();
    api.svn.diagnostics = vi.fn().mockResolvedValue(createDiagnostics());
    api.svn.workingCopyHealth = vi.fn().mockResolvedValue(createHealthReport());
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

  it('stacks the fix wizard above itself; Escape closes only the wizard', async () => {
    const { onClose } = renderPanel();

    fireEvent.click(await screen.findByTestId('open-fix-wizard'));

    expect(await screen.findByRole('dialog', { name: 'Fix working copy' })).toBeTruthy();
    expect(dialogStackIds().at(-1)).toBe('working-copy-fix-wizard');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Fix working copy' })).toBeNull();
    });
    expect(screen.getByRole('dialog', { name: 'Repository Diagnostics' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
