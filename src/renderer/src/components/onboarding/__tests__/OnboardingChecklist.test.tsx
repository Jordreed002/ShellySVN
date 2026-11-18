/**
 * OnboardingChecklist card (#88): renders the steps, auto-checks from the
 * observed state, dismisses, and disappears once everything completable is
 * done. The step CTAs are real buttons wired to navigation/events.
 */

import React, { type ReactNode } from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnCommandTimelineEntry } from '@shared/types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  onOpenWorkingCopy: vi.fn(),
  addRecentRepo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({}),
}));

let settings: { recentRepositories?: string[] } = {};
vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings, addRecentRepo: mocks.addRecentRepo }),
}));

import { REVIEW_CENTER_OPEN_EVENT } from '@renderer/features/ai-review-center/reviewCenterEvents';
import { OnboardingChecklist } from '../OnboardingChecklist';
import {
  getOnboardingChecklist,
  markOnboardingStepsDone,
  ONBOARDING_CHECKLIST_KEY,
  resetOnboardingChecklistForTests,
} from '@renderer/lib/onboardingStore';

function timeline(...entries: Partial<SvnCommandTimelineEntry>[]): SvnCommandTimelineEntry[] {
  return entries.map((entry, index) => ({
    id: `e${index}`,
    operation: 'status',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 10,
    status: 'success',
    affectedPathCount: 1,
    ...entry,
  }));
}

function renderChecklist() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(<OnboardingChecklist onOpenWorkingCopy={mocks.onOpenWorkingCopy} />, {
    wrapper,
  });
  // Re-render the same tree (same container, same provider) so a mutated
  // `settings` mock is picked up without duplicating the DOM.
  return {
    ...view,
    rerenderChecklist: () =>
      view.rerender(<OnboardingChecklist onOpenWorkingCopy={mocks.onOpenWorkingCopy} />),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOnboardingChecklistForTests();
  settings = {};
  window.api = createMockElectronAPI();
  const data = new Map<string, unknown>();
  window.api.store.get = vi.fn(async (key: string) => data.get(key));
  window.api.store.set = vi.fn(async (key: string, value: unknown) => {
    data.set(key, value);
  });
  window.api.svn.commandTimeline = vi
    .fn()
    .mockResolvedValue(timeline({ operation: 'status' }));
});

afterEach(() => {
  resetOnboardingChecklistForTests();
});

describe('OnboardingChecklist', () => {
  it('renders every step, with the sample repo step ready to run', async () => {
    renderChecklist();

    expect(await screen.findByTestId('onboarding-checklist')).toBeInTheDocument();
    expect(screen.getByText('Open a working copy')).toBeInTheDocument();
    expect(screen.getByText('Run your first update')).toBeInTheDocument();
    expect(screen.getByText('Commit a change')).toBeInTheDocument();
    expect(screen.getByText('Open the Review Center')).toBeInTheDocument();

    const sample = screen.getByRole('button', { name: /Go: Create a sample repo playground/ });
    expect(sample).not.toBeDisabled();
  });

  it('auto-checks steps from observed state and persists them', async () => {
    settings = { recentRepositories: ['/wc/atlas'] };
    window.api.svn.commandTimeline = vi
      .fn()
      .mockResolvedValue(
        timeline(
          { operation: 'update', status: 'success' },
          { operation: 'commit', status: 'success' },
          { operation: 'merge', status: 'failed' }
        )
      );
    renderChecklist();

    await waitFor(() => {
      // listitem textContent runs title + detail together, so match by substring.
      const doneTitles = screen
        .getAllByRole('listitem')
        .filter((item) => item.querySelector('button')?.textContent === 'Done')
        .map((item) => item.textContent ?? '')
        .join('\n');
      expect(doneTitles).toContain('Open a working copy');
      expect(doneTitles).toContain('Run your first update');
      expect(doneTitles).toContain('Commit a change');
    });

    // Seen-done marks are persisted under the store key.
    await waitFor(() => {
      const state = getOnboardingChecklist();
      expect(state.completedAt['open-working-copy']).toBeTruthy();
      expect(state.completedAt['first-update']).toBeTruthy();
      expect(state.completedAt['first-commit']).toBeTruthy();
    });
    expect(window.api.store.set).toHaveBeenCalledWith(
      ONBOARDING_CHECKLIST_KEY,
      expect.objectContaining({ version: 1 })
    );
  });

  it('dismisses via the X button and stays dismissed in the store', async () => {
    renderChecklist();
    fireEvent.click(await screen.findByRole('button', { name: /Hide the getting-started checklist/ }));
    await waitFor(() => expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument());
    expect(getOnboardingChecklist().dismissed).toBe(true);
  });

  it('marks the review-center step done when its CTA (or the open event) fires', async () => {
    renderChecklist();

    fireEvent.click(screen.getByRole('button', { name: /Go: Open the Review Center/ }));
    await waitFor(() =>
      expect(getOnboardingChecklist().completedAt['review-center']).toBeTruthy()
    );

    // The same event from any other source (e.g. the palette) also checks it.
    resetOnboardingChecklistForTests();
    await act(async () => {
      fireEvent(window, new CustomEvent(REVIEW_CENTER_OPEN_EVENT));
    });
    renderChecklist();
    await waitFor(() =>
      expect(getOnboardingChecklist().completedAt['review-center']).toBeTruthy()
    );
  });

  it('hides itself once every completable step is done', async () => {
    settings = { recentRepositories: ['/wc/atlas'] };
    window.api.svn.commandTimeline = vi
      .fn()
      .mockResolvedValue(
        timeline({ operation: 'update' }, { operation: 'commit' })
      );
    // The sample repo completes through its own CTA; seed its persisted record
    // so only the review-center step remains.
    markOnboardingStepsDone(['sample-repo']);
    renderChecklist();

    // Complete the last completable step (review center) via its CTA.
    fireEvent.click(await screen.findByRole('button', { name: /Go: Open the Review Center/ }));
    await waitFor(() =>
      expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument()
    );
  });

  it('runs the step CTAs: open dialog, and navigate to the working-copy view', async () => {
    settings = { recentRepositories: ['/wc/atlas'] };
    const { rerenderChecklist } = renderChecklist();

    fireEvent.click(await screen.findByRole('button', { name: /Go: Run your first update/ }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/files', search: { path: '/wc/atlas' } });

    fireEvent.click(screen.getByRole('button', { name: /Go: Commit a change/ }));
    expect(mocks.navigate).toHaveBeenCalledTimes(2);

    // "Open a working copy" defers to the home screen's dialog. The step was
    // auto-checked (a recent exists) and persisted, so reset the seen-done
    // record and re-render with no recents before its CTA becomes clickable.
    settings = {};
    resetOnboardingChecklistForTests();
    rerenderChecklist();
    fireEvent.click(await screen.findByRole('button', { name: /Go: Open a working copy/ }));
    expect(mocks.onOpenWorkingCopy).toHaveBeenCalledTimes(1);
  });

  it('creates the sample repo, checks it out into the picked folder and opens it', async () => {
    window.api.svn.createSampleRepository = vi.fn().mockResolvedValue({
      success: true,
      url: 'file:///sample/repo/trunk',
      repositoryUrl: 'file:///sample/repo',
      path: '/sample/repo',
      created: true,
    });
    window.api.dialog.openDirectory = vi.fn().mockResolvedValue('/projects');
    window.api.svn.checkout = vi.fn().mockResolvedValue({ success: true, revision: 4 });

    renderChecklist();

    fireEvent.click(
      await screen.findByRole('button', { name: /Go: Create a sample repo playground/ })
    );

    await waitFor(() =>
      expect(window.api.svn.checkout).toHaveBeenCalledWith('file:///sample/repo/trunk', '/projects/shellysvn-sample')
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/files',
        search: { path: '/projects/shellysvn-sample' },
      })
    );
    await waitFor(() =>
      expect(getOnboardingChecklist().completedAt['sample-repo']).toBeTruthy()
    );
  });

  it('marks the sample repo step done even when the checkout folder is not picked', async () => {
    window.api.svn.createSampleRepository = vi.fn().mockResolvedValue({
      success: true,
      url: 'file:///sample/repo/trunk',
      repositoryUrl: 'file:///sample/repo',
      path: '/sample/repo',
      created: true,
    });
    window.api.dialog.openDirectory = vi.fn().mockResolvedValue(null);

    renderChecklist();

    fireEvent.click(
      await screen.findByRole('button', { name: /Go: Create a sample repo playground/ })
    );

    await waitFor(() =>
      expect(getOnboardingChecklist().completedAt['sample-repo']).toBeTruthy()
    );
    expect(window.api.svn.checkout).not.toHaveBeenCalled();
  });

  it('surfaces a failed sample-repository creation without marking the step done', async () => {
    window.api.svn.createSampleRepository = vi.fn().mockResolvedValue({
      success: false,
      url: '',
      repositoryUrl: '',
      path: '',
      created: false,
      error: "svnadmin: E165001: can't create",
    });

    renderChecklist();

    fireEvent.click(
      await screen.findByRole('button', { name: /Go: Create a sample repo playground/ })
    );

    expect(await screen.findByTestId('sample-repo-error')).toHaveTextContent(/E165001/);
    expect(getOnboardingChecklist().completedAt['sample-repo']).toBeUndefined();
  });

  it('compact: one summary line with the next step, expandable to every step', async () => {
    settings = { recentRepositories: ['/wc/atlas'] };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OnboardingChecklist compact onOpenWorkingCopy={mocks.onOpenWorkingCopy} />
      </QueryClientProvider>
    );

    // Collapsed: progress and the next unfinished step, not the full list.
    expect(await screen.findByText(/1 of 5 done/)).toBeInTheDocument();
    expect(screen.getByText('Next: Run your first update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Go: / })).not.toBeInTheDocument();

    // The next step runs from the summary line, against the recent working copy.
    fireEvent.click(screen.getByRole('button', { name: 'Continue: Run your first update' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/files', search: { path: '/wc/atlas' } });

    const toggle = screen.getByRole('button', { name: /All steps/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Hide steps/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(
      screen.getByRole('button', { name: /Go: Create a sample repo playground/ })
    ).toBeInTheDocument();
  });
});
