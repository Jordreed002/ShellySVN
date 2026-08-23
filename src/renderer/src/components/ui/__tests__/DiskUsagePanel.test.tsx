import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { confirmAppAction } from '@renderer/utils/dialogs';
import type { PristineAnalysisResult } from '@shared/types';

import { DiskUsagePanel, pristineAnalysisKey } from '../DiskUsagePanel';

vi.mock('@renderer/utils/dialogs', () => ({
  confirmAppAction: vi.fn().mockResolvedValue(true),
}));

function analysis(overrides: Partial<PristineAnalysisResult> = {}): PristineAnalysisResult {
  return {
    available: true,
    workingCopyPath: '/wc/project',
    pristineRoot: '/wc/project/.svn/pristine',
    totalBytes: 10 * 1024 * 1024,
    fileCount: 240,
    largestFileBytes: 2 * 1024 * 1024,
    largestFiles: [{ name: 'ab/abcd.svn-base', bytes: 2 * 1024 * 1024 }],
    histogram: [{ label: '64 KiB – 512 KiB', minBytes: 1, maxBytes: 2, fileCount: 200, totalBytes: 8 * 1024 * 1024 }],
    orphanEstimate: {
      storeOrphaned: false,
      malformedFileCount: 3,
      malformedBytes: 1024,
      limitationNote: 'checksum walk requires wc.db access',
    },
    workingCopySize: { bytes: 40 * 1024 * 1024, truncated: false },
    vacuumRecommendation: { recommended: true, reasons: ['PRISTINE_TO_WC_RATIO'], confidence: 'high' },
    cancelled: false,
    errors: [],
    durationMs: 120,
    scannedAt: '2026-08-23T00:00:00Z',
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DiskUsagePanel isOpen onClose={() => undefined} workingCopyPath="/wc/project" />
    </QueryClientProvider>
  );
}

describe('DiskUsagePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
    vi.mocked(confirmAppAction).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('renders the analyzer breakdown when the IPC is available', async () => {
    window.api.svn.analyzePristine = vi.fn().mockResolvedValue(analysis());

    renderPanel();

    expect(await screen.findByText('10.0 MB')).toBeTruthy();
    expect(screen.getByText(/240 files/)).toBeTruthy();
    expect(screen.getByText(/40.0 MB/)).toBeTruthy();
    expect(screen.getByText(/pristine ≈ 25% of payload/)).toBeTruthy();
    expect(screen.getByText('Vacuum recommended')).toBeTruthy();
    expect(screen.getByText('ab/abcd.svn-base')).toBeTruthy();
    expect(screen.getByText('64 KiB – 512 KiB')).toBeTruthy();
    expect(window.api.svn.analyzePristine).toHaveBeenCalledWith('/wc/project', {
      computeWorkingCopySize: true,
    });
  });

  it('runs the vacuum through svn cleanup after confirmation', async () => {
    window.api.svn.analyzePristine = vi.fn().mockResolvedValue(analysis());

    renderPanel();
    await screen.findByText('10.0 MB');

    fireEvent.click(screen.getByTestId('disk-usage-vacuum'));
    await waitFor(() =>
      expect(window.api.svn.cleanup).toHaveBeenCalledWith('/wc/project', { vacuumPristines: true })
    );
    // The analysis is re-measured after the cleanup.
    await waitFor(() => expect(window.api.svn.analyzePristine).toHaveBeenCalledTimes(2));
  });

  it('does not vacuum when the confirmation is declined', async () => {
    window.api.svn.analyzePristine = vi.fn().mockResolvedValue(analysis());
    vi.mocked(confirmAppAction).mockResolvedValue(false);

    renderPanel();
    await screen.findByText('10.0 MB');

    fireEvent.click(screen.getByTestId('disk-usage-vacuum'));
    await waitFor(() => expect(confirmAppAction).toHaveBeenCalled());
    expect(window.api.svn.cleanup).not.toHaveBeenCalled();
  });

  it('degrades to the pending-backend panel without the analyzer IPC', async () => {
    window.api.svn.analyzePristine = undefined as never;
    window.api.fs.getFolderSizes = vi.fn().mockResolvedValue({ '/wc/project': 5 * 1024 * 1024 * 1024 });

    renderPanel();

    const pending = await screen.findByTestId('disk-usage-pending-backend');
    expect(pending.textContent).toContain('pending backend');
    // The folder size from the fs IPC replaces the analyzer's figures.
    await waitFor(() => expect(pending.textContent).toContain('5.0 GB'));
    // Cleanup remains available even without the analyzer.
    expect(screen.getByTestId('disk-usage-vacuum')).toBeTruthy();
    expect(window.api.fs.getFolderSizes).toHaveBeenCalledWith(['/wc/project']);
  });

  it('keys the analysis query per working copy', () => {
    expect(pristineAnalysisKey('/a')).toEqual(['pristine:analysis', '/a']);
  });
});
