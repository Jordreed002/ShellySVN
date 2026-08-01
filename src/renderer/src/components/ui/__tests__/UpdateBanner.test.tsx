import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateState } from '@shared/types';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  download: vi.fn(),
  cancelDownload: vi.fn(),
}));

vi.mock('@renderer/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({
    state: mocks.state as AppUpdateState | null,
    download: mocks.download,
    cancelDownload: mocks.cancelDownload,
  }),
}));

import { UpdateBanner } from '../UpdateBanner';

describe('UpdateBanner', () => {
  const restartAndInstall = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
    window.api.updater.restartAndInstall = restartAndInstall;
  });

  afterEach(cleanup);

  it('offers an explicit download for an available update', () => {
    mocks.state = {
      status: 'available',
      installedVersion: '1.1.0-beta.2',
      availableVersion: '1.1.0-rc.1',
      channel: 'preview',
      releaseNotes: 'Updater acceptance candidate',
    } satisfies AppUpdateState;

    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: /download update/i }));

    expect(mocks.download).toHaveBeenCalledOnce();
    expect(screen.getByText('Updater acceptance candidate')).toBeTruthy();
  });

  it('shows actionable feedback when SVN work blocks restart', async () => {
    mocks.state = {
      status: 'downloaded',
      installedVersion: '1.1.0-beta.2',
      availableVersion: '1.1.0-rc.1',
      channel: 'preview',
    } satisfies AppUpdateState;
    restartAndInstall.mockResolvedValue({
      started: false,
      reason: 'svn-operation-active',
    });

    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: /restart and install/i }));

    await waitFor(() => {
      expect(screen.getByText(/finish or cancel the active SVN operation/i)).toBeTruthy();
    });
  });

  it('does not interrupt the workspace for background errors', () => {
    mocks.state = {
      status: 'error',
      installedVersion: '1.1.0-beta.2',
      channel: 'stable',
      code: 'network',
      retryable: true,
      message: 'Network unavailable',
      source: 'scheduled',
    } satisfies AppUpdateState;

    const { container } = render(<UpdateBanner />);
    expect(container.childElementCount).toBe(0);
  });
});
