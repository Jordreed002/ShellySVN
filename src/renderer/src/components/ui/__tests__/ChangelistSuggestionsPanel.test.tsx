import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnStatusEntry } from '@shared/types';
import {
  ChangelistSuggestionsEntry,
  ChangelistSuggestionsList,
  isChangelistCandidate,
} from '../ChangelistSuggestionsPanel';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function statusEntry(path: string, status: SvnStatusEntry['status']): SvnStatusEntry {
  return { path, status, isDirectory: false };
}

describe('isChangelistCandidate', () => {
  it('excludes unversioned, ignored and external entries and directories', () => {
    expect(isChangelistCandidate('M', false)).toBe(true);
    expect(isChangelistCandidate('A', false)).toBe(true);
    expect(isChangelistCandidate('?', false)).toBe(false);
    expect(isChangelistCandidate('I', false)).toBe(false);
    expect(isChangelistCandidate('X', false)).toBe(false);
    expect(isChangelistCandidate(' ', false)).toBe(false);
    expect(isChangelistCandidate('M', true)).toBe(false);
  });
});

describe('ChangelistSuggestionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
  });

  afterEach(cleanup);

  const paths = [
    '/wc/src/core/alpha.ts',
    '/wc/src/core/beta.ts',
    '/wc/src/core/alpha.test.ts',
  ];

  it('renders suggestion cards with confidence and members', () => {
    renderWithQueryClient(<ChangelistSuggestionsList paths={paths} rootPath="/wc" />);
    expect(screen.getByText('Suggested changelists')).toBeTruthy();
    expect(screen.getByText('high confidence')).toBeTruthy();
    expect(screen.getByText('/wc/src/core/alpha.ts')).toBeTruthy();
  });

  it('accepts a suggestion with the (adjusted) name and selected members only', async () => {
    renderWithQueryClient(<ChangelistSuggestionsList paths={paths} rootPath="/wc" />);

    const card = within(screen.getByRole('group', { name: 'Suggestion src: core' }));
    const nameInput = card.getByLabelText(
      'Changelist name for src: core suggestion'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'core refactor' } });

    fireEvent.click(card.getByLabelText('/wc/src/core/beta.ts'));

    fireEvent.click(card.getByRole('button', { name: /create changelist \(1\)/i }));

    await waitFor(() => {
      expect(window.api.svn.changelist.add).toHaveBeenCalledWith(
        ['/wc/src/core/alpha.ts'],
        'core refactor'
      );
    });
  });

  it('dismissing a suggestion removes its card', () => {
    renderWithQueryClient(<ChangelistSuggestionsList paths={paths} rootPath="/wc" />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss suggestion tests/i }));
    expect(screen.queryByText('/wc/src/core/alpha.test.ts')).toBeNull();
    // The other suggestion is untouched.
    expect(screen.getByText('/wc/src/core/alpha.ts')).toBeTruthy();
  });

  it('reports when there is nothing to group', () => {
    renderWithQueryClient(<ChangelistSuggestionsList paths={['/wc/a.ts']} rootPath="/wc" />);
    expect(screen.getByText(/no changelist groupings found/i)).toBeTruthy();
    expect(window.api.svn.changelist.add).not.toHaveBeenCalled();
  });
});

describe('ChangelistSuggestionsEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
  });

  afterEach(cleanup);

  it('renders nothing when fewer than two files changed', async () => {
    window.api.svn.status = vi.fn().mockResolvedValue({
      path: '/wc',
      entries: [statusEntry('/wc/only.ts', 'M')],
      revision: 1,
    });
    const { container } = renderWithQueryClient(
      <ChangelistSuggestionsEntry workingCopyPath="/wc" />
    );
    await waitFor(() => expect(window.api.svn.status).toHaveBeenCalled());
    expect(container.querySelector('button')).toBeNull();
  });

  it('filters out unversioned entries and opens the dialog with suggestions', async () => {
    window.api.svn.status = vi.fn().mockResolvedValue({
      path: '/wc',
      revision: 1,
      entries: [
        statusEntry('/wc/src/core/alpha.ts', 'M'),
        statusEntry('/wc/src/core/beta.ts', 'M'),
        statusEntry('/wc/unversioned.txt', '?'),
      ],
    });
    window.api.svn.getWorkingCopyContext = vi.fn().mockResolvedValue({
      workingCopyRoot: '/wc',
      repositoryRoot: 'https://svn.example.com/repo',
      repositoryUuid: 'uuid',
      url: 'https://svn.example.com/repo/trunk',
      localPath: '/wc',
      nearestVersionedPath: '/wc',
      nearestVersionedUrl: 'https://svn.example.com/repo/trunk',
      derived: false,
    });

    renderWithQueryClient(<ChangelistSuggestionsEntry workingCopyPath="/wc" />);

    const trigger = await screen.findByRole('button', {
      name: /suggest changelists/i,
    });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    const card = within(dialog).getByRole('group', { name: 'Suggestion src: core' });
    expect(within(card).getByText('/wc/src/core/alpha.ts')).toBeTruthy();
    expect(screen.queryByText('/wc/unversioned.txt')).toBeNull();

    fireEvent.click(
      within(card).getByRole('button', { name: /create changelist \(2\)/i }) 
    );
    await waitFor(() => {
      expect(window.api.svn.changelist.add).toHaveBeenCalledWith(
        ['/wc/src/core/alpha.ts', '/wc/src/core/beta.ts'],
        'src: core'
      );
    });
  });
});
