import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { PATCH_HUB_INDEX_KEY } from '@renderer/lib/patchHub';
import { PatchHubDialog } from '../PatchHubDialog';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const STORED_PATCHES = [
  {
    id: 'patch-1',
    name: 'feature.patch',
    path: '/patches/feature.patch',
    workingCopyPath: '/wc',
    createdAt: '2026-01-01T10:00:00.000Z',
  },
];

const REJECT_CONTENT = [
  '--- src/app.ts\t(revision 42)',
  '+++ src/app.ts',
  '@@ -2,3 +2,4 @@',
  ' alpha',
  '-beta',
  '+BETA',
  ' gamma',
].join('\n');

const TARGET_CONTENT = ['start', 'alpha', 'beta', 'gamma', 'end'].join('\n');

describe('PatchHubDialog', () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new Map([[PATCH_HUB_INDEX_KEY, STORED_PATCHES]]);
    window.api = createMockElectronAPI();
    window.api.store.get = vi.fn(async (key: string) => store.get(key));
    window.api.store.set = vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    });

    window.api.fs.listDirectory = vi.fn(async (path: string) => {
      if (path !== '/wc') return [];
      return [
        { name: 'src', path: '/wc/src', isDirectory: true, size: 0, modifiedTime: '' },
        {
          name: 'app.ts.svnpatch.rej',
          path: '/wc/src/app.ts.svnpatch.rej',
          isDirectory: false,
          size: 40,
          modifiedTime: '',
        },
      ];
    });

    window.api.fs.readFile = vi.fn(async (path: string) => {
      if (path.endsWith('.rej')) return { success: true, content: REJECT_CONTENT };
      if (path.endsWith('app.ts')) return { success: true, content: TARGET_CONTENT };
      return { success: false, error: 'not found' };
    });
  });

  afterEach(cleanup);

  it('lists stored patches and removes one from the hub on request', async () => {
    renderWithQueryClient(
      <PatchHubDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    expect(await screen.findByText('feature.patch')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /remove patch feature.patch/i }));
    await waitFor(() => expect(store.get(PATCH_HUB_INDEX_KEY)).toEqual([]));
    await waitFor(() => expect(screen.queryByText('feature.patch')).toBeNull());
  });

  it('shares a patch by copying its path and revealing it in the folder', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithQueryClient(
      <PatchHubDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    fireEvent.click(await screen.findByRole('button', { name: /share patch feature.patch/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/patches/feature.patch'));
    expect(window.api.external.revealPath).toHaveBeenCalledWith('/patches/feature.patch');
  });

  it('opens the create-patch flow, which records the saved patch in the index', async () => {
    window.api.svn.diff = vi.fn().mockResolvedValue({
      files: [],
      hasChanges: true,
      rawDiff: '--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n',
    });
    window.api.dialog.saveFile = vi.fn().mockResolvedValue('/patches/new.patch');
    window.api.svn.patch.create = vi.fn().mockResolvedValue({ success: true, output: '' });

    renderWithQueryClient(
      <PatchHubDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    fireEvent.click(await screen.findByRole('button', { name: /new patch/i }));
    expect(await screen.findByText('Create Patch')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /generate patch/i }));
    await waitFor(() => screen.getByRole('button', { name: /save patch/i }));
    fireEvent.click(screen.getByRole('button', { name: /save patch/i }));

    await waitFor(() => {
      const entries = store.get(PATCH_HUB_INDEX_KEY) as Array<{ path: string }>;
      expect(entries.some((entry) => entry.path === '/patches/new.patch')).toBe(true);
    });
  });

  it('shows a dry-run conflict preview, then recover rejected hunks after applying', async () => {
    window.api.svn.patch.apply = vi.fn(
      async (_patchPath: string, _target: string, dryRun?: boolean) => {
        if (dryRun) {
          return {
            success: false,
            appliedWithConflicts: true,
            filesPatched: 2,
            rejects: 1,
            rejectFiles: ['/wc/src/app.ts.svnpatch.rej'],
            offsetHunks: 0,
            fuzzedHunks: 0,
            output: 'U    src/ok.ts\nC    src/app.ts\n> rejected hunk #1',
          };
        }
        return {
          success: false,
          appliedWithConflicts: true,
          filesPatched: 1,
          rejects: 1,
          rejectFiles: ['/wc/src/app.ts.svnpatch.rej'],
          offsetHunks: 0,
          fuzzedHunks: 0,
          output: 'C    src/app.ts',
        };
      }
    );

    renderWithQueryClient(
      <PatchHubDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );

    fireEvent.click(await screen.findByRole('button', { name: /^apply/i }));

    // Dry-run preview with the conflict caveat.
    await screen.findByText('Dry-run preview');
    expect(screen.getAllByText(/src\/app\.ts/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/conflicts possible: 1 file\(s\) would conflict/i)
    ).toBeTruthy();

    // Real apply → rejected hunks with file context and an open-file action.
    fireEvent.click(screen.getByRole('button', { name: /apply patch/i }));

    const recovery = await screen.findByTestId('reject-recovery');
    expect(within(recovery).getByText('@@ -2,3 +2,4 @@')).toBeTruthy();
    expect(within(recovery).getByText('+BETA')).toBeTruthy();
    expect(within(recovery).getByText('rejected hunks (1)', { exact: false })).toBeTruthy();

    fireEvent.click(within(recovery).getByRole('button', { name: /open file/i }));
    expect(window.api.external.openFile).toHaveBeenCalledWith('/wc/src/app.ts');

    // The dry-run ran first with dryRun=true, the apply with false.
    const calls = (window.api.svn.patch.apply as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((call) => call[2])).toEqual([true, false]);
  });

  it('renders an empty state when the index has no patches', async () => {
    store.set(PATCH_HUB_INDEX_KEY, []);
    renderWithQueryClient(
      <PatchHubDialog isOpen onClose={vi.fn()} workingCopyPath="/wc" />
    );
    expect(await screen.findByText('No patches yet')).toBeTruthy();
  });
});
