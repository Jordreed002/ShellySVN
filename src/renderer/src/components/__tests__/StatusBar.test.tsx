/**
 * The status bar's contract: every cell is a measured fact, or it is absent.
 *
 * The traps covered here are the ones that produce a *plausible* wrong answer
 * rather than a crash — a byte total of "0 B" for a checkout nobody measured, a
 * Subversion version copied from the packaging claim, or a "connected" cell that
 * no request ever proved. Each of those is asserted as an omission.
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, SvnStatusChar } from '@shared/types';

import { StatusBar } from '../ui/StatusBar';

const WC = '/wc/atlas';

let search: { path?: string; url?: string; localPath?: string } = {};
let settings: Partial<AppSettings> = {};

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ location: { search } }),
}));

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings }),
}));

const status = vi.fn();
const info = vi.fn();
const diagnostics = vi.fn();
const getFolderSizes = vi.fn();

/** `svn status` entries, given just the status letters. */
function statusEntries(...chars: SvnStatusChar[]) {
  return {
    path: WC,
    revision: 4838,
    entries: chars.map((char, index) => ({ path: `${WC}/file${index}`, status: char })),
  };
}

function renderStatusBar(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<StatusBar />, { wrapper });
  return queryClient;
}

/** Whitespace-insensitive text of the whole strip. */
function stripText(): string {
  return (screen.getByRole('status').textContent || '').replace(/\s+/g, ' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  search = { path: `${WC}/clients/acme-corp` };
  settings = { showStatusBar: true, showFolderSizes: false, recentRepositories: [WC] };
  status.mockResolvedValue(statusEntries('M', 'M', 'C'));
  info.mockResolvedValue({
    path: WC,
    url: 'svn://svn.example.com/atlas/trunk',
    repositoryRoot: 'svn://svn.example.com/atlas',
    repositoryUuid: 'uuid',
    revision: 4838,
    nodeKind: 'dir',
    lastChangedAuthor: 'priya',
    lastChangedRevision: 4838,
    lastChangedDate: '2026-01-01T00:00:00Z',
  });
  getFolderSizes.mockResolvedValue({ [WC]: 19_756_073_287 });

  // `svnCache` is deliberately absent: the offline cache is optional, and its
  // absence must not turn a successful read into an error.
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { svn: { status, info, diagnostics }, fs: { getFolderSizes } },
  });
});

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('StatusBar', () => {
  it('describes the active working copy and its pending changes', async () => {
    renderStatusBar();

    await waitFor(() => expect(stripText()).toContain('atlas'));
    await waitFor(() => expect(stripText()).toContain('r4838'));

    const text = stripText();
    expect(text).toContain('trunk');
    // `svn status` counts every changed node, and the conflict is named as one.
    expect(text).toContain('3 changes');
    expect(text).toContain('1 conflict');
    // Where we are, from the route.
    expect(text).toContain('/wc/atlas/clients/acme-corp');
  });

  it('counts the checkouts on disk but omits their size until it is measured', async () => {
    renderStatusBar();

    await waitFor(() => expect(stripText()).toContain('1 working copy'));

    // Measuring means walking the checkout, so nothing is walked while the
    // preference is off — and no zero is invented in place of the answer.
    expect(getFolderSizes).not.toHaveBeenCalled();
    expect(stripText()).not.toMatch(/\d+(\.\d+)? (B|KB|MB|GB|TB)/);
  });

  it('shows the measured byte total once folder sizes are enabled', async () => {
    settings = { ...settings, showFolderSizes: true };
    renderStatusBar();

    await waitFor(() => expect(screen.getByText('18.4 GB')).toBeInTheDocument());
    expect(getFolderSizes).toHaveBeenCalledWith([WC]);
  });

  it('never reports local facts for a location outside a checkout', async () => {
    search = { url: 'svn://svn.example.com/atlas/trunk' };
    settings = { ...settings, recentRepositories: [] };
    renderStatusBar();

    await waitFor(() => expect(stripText()).toContain('No working copy open'));

    const text = stripText();
    expect(text).not.toContain('change');
    expect(text).not.toContain('conflict');
    expect(text).not.toMatch(/\d+ working cop/);
    // The repository URL is still the location we are looking at.
    expect(text).toContain('svn://svn.example.com/atlas/trunk');
    expect(status).not.toHaveBeenCalled();
  });

  it('shows the Subversion version only once the app has actually run svn --version', async () => {
    const queryClient = renderStatusBar();

    await waitFor(() => expect(stripText()).toContain('atlas'));
    expect(stripText()).not.toContain('svn 1.');

    // The diagnostics panel owns the probe; the strip reads its result.
    act(() => {
      queryClient.setQueryData(['diagnostics', `${WC}/clients/acme-corp`], {
        svnVersion: '1.14.3',
      });
    });

    await waitFor(() => expect(stripText()).toContain('svn 1.14.3'));
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it('reports being offline, and never claims to be connected', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderStatusBar();

    await waitFor(() => expect(stripText()).toContain('offline'));
    expect(stripText()).not.toContain('connected');
  });
  it('names the working copy the repository browser bound, not "No working copy open"', async () => {
    /* The browser discovers the checkout containing the path being viewed and
       records it as `localPath`. If this bar ignored that, one window would show
       "working copy · status from disk" in the listing footer and "No working
       copy open" in the status bar, about the same directory. */
    search = { url: 'svn://demo/atlas', localPath: WC };
    settings = { showStatusBar: true, showFolderSizes: false, recentRepositories: [WC] };
    info.mockResolvedValue({
      path: WC,
      url: 'svn://demo/atlas/clients/acme/trunk',
      repositoryRoot: 'svn://demo/atlas',
      revision: 4838,
    });
    status.mockResolvedValue(statusEntries('M'));

    renderStatusBar();

    await waitFor(() => expect(stripText()).toContain('atlas'));
    expect(stripText()).not.toContain('No working copy open');
  });

  it('opens the status legend from the help affordance (#94)', async () => {
    renderStatusBar();

    await waitFor(() => expect(stripText()).toContain('atlas'));

    // The one help affordance on the strip: the legend button mounts the dialog.
    fireEvent.click(screen.getByRole('button', { name: 'What the status colors mean' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('What the status colors mean');
    // A spot-check of the documented statuses, not the whole legend (the
    // dialog's own suite covers completeness against the shared union).
    expect(dialog).toHaveTextContent('Modified');
    expect(dialog).toHaveTextContent('Conflicted');
  });
});
