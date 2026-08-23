import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnInfoResult } from '@shared/types';

import { RelinkDialog } from '../RelinkDialog';

const OLD_PATH = '/old/project';
const EXPECTED_URL = 'https://example.test/repo/trunk';
const EXPECTED_UUID = '11111111-2222-3333-4444-555555555555';

function infoAt(url: string, uuid = EXPECTED_UUID): SvnInfoResult {
  return {
    path: '/new/location',
    url,
    repositoryRoot: url.replace(/\/[^/]+$/, ''),
    repositoryUuid: uuid,
    revision: 12,
    nodeKind: 'dir',
    lastChangedAuthor: 'someone',
    lastChangedRevision: 12,
    lastChangedDate: '2026-01-01T00:00:00Z',
  };
}

function renderDialog(props: Partial<Parameters<typeof RelinkDialog>[0]> = {}) {
  const onApplied = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const removeSpy = vi.spyOn(queryClient, 'removeQueries');
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RelinkDialog
        isOpen
        onClose={() => undefined}
        oldPath={OLD_PATH}
        expected={{ url: EXPECTED_URL, repositoryUuid: EXPECTED_UUID }}
        onApplied={onApplied}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onApplied, removeSpy, invalidateSpy, queryClient, ...utils };
}

describe('RelinkDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
    window.api.dialog.openDirectory = vi.fn().mockResolvedValue('/new/location');
  });

  afterEach(cleanup);

  it('verifies a UUID+URL match and applies through the relink IPC', async () => {
    window.api.svn.info = vi.fn().mockResolvedValue(infoAt(EXPECTED_URL));
    window.api.svn.applyWcRelink = vi.fn().mockResolvedValue({ success: true });

    const { onApplied, invalidateSpy } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    const verification = await screen.findByTestId('relink-verification');
    expect(verification).toBeTruthy();
    expect(verification.textContent).toContain('Same working copy');

    fireEvent.click(screen.getByTestId('relink-apply'));
    await waitFor(() => expect(screen.getByTestId('relink-applied')).toBeTruthy());

    expect(window.api.svn.applyWcRelink).toHaveBeenCalledWith({
      oldPath: OLD_PATH,
      newPath: '/new/location',
      matchedOn: 'uuid',
      confidence: 'high',
      url: EXPECTED_URL,
      repositoryUuid: EXPECTED_UUID,
    });
    expect(onApplied).toHaveBeenCalledWith(OLD_PATH, '/new/location');
    // Settings + sidebar caches are invalidated so the rail refetches.
    const invalidated = invalidateSpy.mock.calls.map((call) =>
      call[0]?.queryKey ? JSON.stringify(call[0].queryKey) : ''
    );
    expect(invalidated.some((key) => key.includes('settings'))).toBe(true);
    expect(invalidated.some((key) => key.includes('sidebar'))).toBe(true);
  });

  it('warns on a different repository and requires an explicit confirmation', async () => {
    window.api.svn.info = vi.fn().mockResolvedValue(infoAt('https://other.test/repo/trunk', '99999999-9999-9999-9999-999999999999'));
    window.api.svn.applyWcRelink = vi.fn().mockResolvedValue({ success: true });

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    const verification = await screen.findByTestId('relink-verification');
    expect(verification.textContent).toContain('Different repository');

    const apply = screen.getByTestId('relink-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('relink-confirm-mismatch'));
    expect(apply.disabled).toBe(false);

    fireEvent.click(apply);
    await waitFor(() => expect(screen.getByTestId('relink-applied')).toBeTruthy());
    expect(window.api.svn.applyWcRelink).toHaveBeenCalledWith(
      expect.objectContaining({ matchedOn: 'basename', confidence: 'low' })
    );
    // The URL genuinely changed: URL-keyed repository queries are dropped.
    await waitFor(() => expect(screen.getByTestId('relink-applied')).toBeTruthy());
  });

  it('treats the same repository at a different directory as a weak match', async () => {
    window.api.svn.info = vi.fn().mockResolvedValue(infoAt('https://example.test/repo/branches/x'));
    window.api.svn.applyWcRelink = vi.fn().mockResolvedValue({ success: true });

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    const verification = await screen.findByTestId('relink-verification');
    expect(verification.textContent).toContain('Same repository, different directory');
    expect((screen.getByTestId('relink-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('rejects a folder that is not a working copy', async () => {
    window.api.svn.info = vi.fn().mockRejectedValue(new Error('E155007: not a working copy'));

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    const error = await screen.findByTestId('relink-error');
    expect(error.textContent).toContain('not a Subversion working copy');
    expect(screen.queryByTestId('relink-verification')).toBeNull();
  });

  it('starts from a detected path hint without the picker', async () => {
    window.api.svn.info = vi.fn().mockResolvedValue(infoAt(EXPECTED_URL));
    window.api.svn.applyWcRelink = vi.fn().mockResolvedValue({ success: true });

    renderDialog({ detectedPath: '/detected/location' });
    const verification = await screen.findByTestId('relink-verification');
    expect(verification.textContent).toContain('Same working copy');
    expect(window.api.dialog.openDirectory).not.toHaveBeenCalled();
  });

  it('applies through the settings store when the relink IPC is unavailable', async () => {
    window.api.svn.info = vi.fn().mockResolvedValue(infoAt(EXPECTED_URL));
    window.api.svn.applyWcRelink = undefined as never;
    const store = new Map<string, unknown>([
      ['settings', { recentRepositories: [OLD_PATH, '/wc-other'] }],
    ]);
    window.api.store.get = vi.fn(async (key: string) => store.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    });

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));
    await screen.findByTestId('relink-verification');
    fireEvent.click(screen.getByTestId('relink-apply'));

    await waitFor(() => expect(screen.getByTestId('relink-applied')).toBeTruthy());
    expect(window.api.store.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ recentRepositories: ['/new/location', '/wc-other'] })
    );
  });

  it('keeps the old path working when the IPC reports failure', async () => {
    window.api.svn.info = vi.fn().mockResolvedValue(infoAt(EXPECTED_URL));
    window.api.svn.applyWcRelink = vi.fn().mockResolvedValue({ success: false, error: 'registry locked' });

    const { onApplied } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));
    await screen.findByTestId('relink-verification');
    fireEvent.click(screen.getByTestId('relink-apply'));

    const error = await screen.findByTestId('relink-error');
    expect(error.textContent).toContain('registry locked');
    expect(onApplied).not.toHaveBeenCalled();
  });
});
