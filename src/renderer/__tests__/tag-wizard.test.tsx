import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TagWizard } from '../src/components/ui/TagWizard';
import { BranchTagDialog } from '../src/components/ui/BranchTagDialog';
import { TAG_TEMPLATES_KEY } from '../src/lib/tagTemplateStore';

describe('tag wizard (#51)', () => {
  const list = vi.fn();
  const copy = vi.fn();
  const getRepositoryLayout = vi.fn();
  const infoUrl = vi.fn();
  const storeGet = vi.fn();
  const storeSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getRepositoryLayout.mockResolvedValue({
      kind: 'single',
      rootUrl: 'svn://host/repo',
      trunk: 'svn://host/repo/trunk',
      branches: 'svn://host/repo/branches',
      tags: 'svn://host/repo/tags',
      customDirs: [],
      empty: false,
      youngestRevision: 42,
    });
    infoUrl.mockResolvedValue({
      path: 'trunk',
      url: 'svn://host/repo/trunk',
      repositoryRoot: 'svn://host/repo',
      repositoryUuid: 'uuid',
      revision: 42,
      nodeKind: 'dir',
      lastChangedAuthor: 'alice',
      lastChangedRevision: 42,
      lastChangedDate: '2026-01-01T00:00:00Z',
    });
    list.mockResolvedValue({
      path: 'svn://host/repo/tags',
      entries: [
        { name: '1.2.0', path: 'tags/1.2.0', url: 'svn://host/repo/tags/1.2.0', kind: 'dir', revision: 30, author: 'alice', date: '2026-01-01T00:00:00Z' },
        { name: '1.1.0', path: 'tags/1.1.0', url: 'svn://host/repo/tags/1.1.0', kind: 'dir', revision: 20, author: 'alice', date: '2026-01-01T00:00:00Z' },
      ],
    });
    copy.mockResolvedValue({ success: true, revision: 43 });
    storeGet.mockResolvedValue(undefined);
    storeSet.mockResolvedValue(undefined);

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        svn: { list, copy, getRepositoryLayout, infoUrl },
        store: { get: storeGet, set: storeSet },
      },
    });
  });

  function createWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it('walks source → name/template → dry run → execute, bumping the last detected tag', async () => {
    render(
      <TagWizard
        isOpen
        onClose={vi.fn()}
        sourcePath="/wc"
        sourceUrl="svn://host/repo/trunk"
      />,
      { wrapper: createWrapper() }
    );

    // Step 1: source prefilled from the URL, HEAD revision resolved.
    expect(screen.getByLabelText('Source URL')).toHaveValue('svn://host/repo/trunk');
    await waitFor(() => {
      expect(screen.getByText('HEAD (r42)')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 2: tags directory detected from the repository layout; existing tags listed.
    await waitFor(() => {
      expect(getRepositoryLayout).toHaveBeenCalledWith('svn://host/repo/trunk');
    });
    await waitFor(() => {
      expect(screen.getByText(/newest version detected: 1\.2\.0/)).toBeInTheDocument();
    });

    // The release preset suggests the next patch above the newest tag.
    fireEvent.click(screen.getByRole('button', { name: 'release/x.y.z' }));
    expect(screen.getByLabelText('Tag name')).toHaveValue('release/1.2.1');

    // Bump buttons re-render the template with the bumped version.
    fireEvent.click(screen.getByRole('button', { name: 'Bump minor version' }));
    expect(screen.getByLabelText('Tag name')).toHaveValue('release/1.3.0');

    // Commit message pre-filled per the mission's template.
    expect(screen.getByLabelText('Commit message')).toHaveValue(
      'Tag 1.3.0 from svn://host/repo/trunk@r42'
    );

    fireEvent.click(screen.getByRole('button', { name: /dry run/i }));

    // Step 3: exact svn copy command preview.
    expect(
      await screen.findByText(
        'svn copy svn://host/repo/trunk svn://host/repo/tags/release/1.3.0 -m "Tag 1.3.0 from svn://host/repo/trunk@r42"'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create tag/i }));

    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith(
        'svn://host/repo/trunk',
        'svn://host/repo/tags/release/1.3.0',
        'Tag 1.3.0 from svn://host/repo/trunk@r42'
      );
    });

    // Success state + recent template persisted.
    expect(await screen.findByText('Tag created')).toBeInTheDocument();
    expect(screen.getByText('Committed as revision r43')).toBeInTheDocument();
    await waitFor(() => {
      expect(storeSet).toHaveBeenCalledWith(TAG_TEMPLATES_KEY, [
        { template: 'release/{version}', usedAt: expect.any(Number) },
      ]);
    });
  });

  it('pins an arbitrary revision as a peg revision on the source', async () => {
    render(
      <TagWizard
        isOpen
        onClose={vi.fn()}
        sourcePath="/wc"
        sourceUrl="svn://host/repo/trunk"
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Revision:' }));
    fireEvent.change(screen.getByLabelText('Specific revision'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByText(/newest version detected: 1\.2\.0/);
    fireEvent.click(screen.getByRole('button', { name: 'x.y.z' }));
    fireEvent.click(screen.getByRole('button', { name: /dry run/i }));

    expect(
      await screen.findByText(/svn copy svn:\/\/host\/repo\/trunk@40 /)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create tag/i }));
    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith(
        'svn://host/repo/trunk@40',
        expect.stringContaining('/tags/1.2.1'),
        expect.stringContaining('@r40')
      );
    });
  });

  it('copies from the working copy when that source is chosen', async () => {
    render(
      <TagWizard
        isOpen
        onClose={vi.fn()}
        sourcePath="/wc"
        sourceUrl="svn://host/repo/trunk"
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('Working copy (includes local changes)'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'tags/#{rev}' }));
    expect(screen.getByLabelText('Tag name')).toHaveValue('tags/#42');

    fireEvent.click(screen.getByRole('button', { name: /dry run/i }));
    fireEvent.click(screen.getByRole('button', { name: /create tag/i }));

    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith(
        '/wc',
        'svn://host/repo/tags/tags/#42',
        expect.any(String)
      );
    });
  });

  it('rejects invalid semver names for version templates', async () => {
    render(
      <TagWizard
        isOpen
        onClose={vi.fn()}
        sourcePath="/wc"
        sourceUrl="svn://host/repo/trunk"
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'release/x.y.z' }));

    fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: 'release/tomorrow' } });
    expect(
      await screen.findByText(/'tomorrow' is not a valid semver version/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDisabled();
  });

  it('surfaces copy failures without leaving the review step', async () => {
    copy.mockResolvedValue({ success: false, error: 'Path already exists', revision: null });

    render(
      <TagWizard
        isOpen
        onClose={vi.fn()}
        sourcePath="/wc"
        sourceUrl="svn://host/repo/trunk"
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'release/x.y.z' }));
    fireEvent.click(screen.getByRole('button', { name: /dry run/i }));
    fireEvent.click(screen.getByRole('button', { name: /create tag/i }));

    expect(await screen.findByText('Path already exists')).toBeInTheDocument();
    expect(screen.queryByText('Tag created')).not.toBeInTheDocument();
  });
});

describe('branch/tag dialog tag-wizard handoff (#51)', () => {
  it('swaps to the wizard only on explicit opt-in, leaving the default form intact', async () => {
    const list = vi.fn().mockResolvedValue({ path: '', entries: [] });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        svn: { list, copy: vi.fn(), getRepositoryLayout: vi.fn(), infoUrl: vi.fn() },
        store: { get: vi.fn().mockResolvedValue(undefined), set: vi.fn() },
      },
    });

    // The dialog navigates to the repo browser after a successful tag, so it
    // needs a router context (FileExplorer always provides one).
    const RootRoute = createRootRoute({
      component: () => (
        <BranchTagDialog
          isOpen
          onClose={vi.fn()}
          sourcePath="/wc"
          sourceUrl="svn://host/repo/trunk"
          mode="tag"
        />
      ),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const router = createRouter({
      routeTree: RootRoute,
      history: createMemoryHistory(),
      context: { queryClient },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    // Default form first (title + submit button both say "Create Tag").
    expect((await screen.findAllByText('Create Tag')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText(/to url/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /use the tag wizard/i }));

    // Now the wizard shell.
    expect(await screen.findByText('Source', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/to url/i)).not.toBeInTheDocument();
  });
});
