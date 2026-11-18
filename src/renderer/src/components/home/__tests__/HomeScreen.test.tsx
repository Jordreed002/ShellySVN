/**
 * Home journeys: the screen leads with the working copy you were last in, and
 * every action on it targets that working copy — never an unrelated recent
 * path. Sections with nothing to say stay out of the way, onboarding stays
 * compact once a working copy exists, and the batch pipeline is reachable.
 */
import React, { type ReactNode } from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';

import type {
  RepoStatusCounts,
  WorkingCopyInfo,
  WorkingCopySummary,
} from '@renderer/components/sidebar/sidebarData';
import type {
  BatchUpdateController,
  BatchUpdateItem,
} from '@renderer/features/working-copy-command-center/types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  addRecentRepo: vi.fn().mockResolvedValue(undefined),
  removeRecentRepo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    search,
    to,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: { path?: string };
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={`${to}?path=${search?.path ?? ''}`} {...rest}>
      {children}
    </a>
  ),
}));

let settingsState: {
  settings: { recentRepositories: string[] };
  isLoading: boolean;
} = {
  settings: { recentRepositories: [] },
  isLoading: false,
};
vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    ...settingsState,
    addRecentRepo: mocks.addRecentRepo,
    removeRecentRepo: mocks.removeRecentRepo,
  }),
}));

let overview = new Map<string, WorkingCopySummary>();
vi.mock('@renderer/components/sidebar/sidebarData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/components/sidebar/sidebarData')>();
  return {
    ...actual,
    useWorkingCopyOverview: () => overview,
    useWorkingCopyShelves: () => ({ shelves: [], unsupported: [] }),
  };
});

let batch: BatchUpdateController;
vi.mock('@renderer/features/working-copy-command-center/BatchUpdateProvider', () => ({
  useBatchUpdate: () => batch,
}));

// The checklist has its own suite; here only its placement and mode matter.
vi.mock('@renderer/components/onboarding/OnboardingChecklist', () => ({
  OnboardingChecklist: ({ compact }: { compact?: boolean }) => (
    <div data-testid="onboarding-stub" data-compact={compact ? 'true' : 'false'} />
  ),
}));

import { HomeScreen } from '../HomeScreen';
import { REVIEW_CENTER_OPEN_EVENT } from '@renderer/features/ai-review-center/reviewCenterEvents';
import { resetOnboardingChecklistForTests } from '@renderer/lib/onboardingStore';

function counts(changes: number, conflicts = 0): RepoStatusCounts {
  return {
    changes,
    conflicts,
    problems: {
      total: conflicts,
      blocking: conflicts,
      summary: conflicts ? `${conflicts} conflicted (C)` : '',
    },
    source: 'network',
    cacheAge: 0,
  };
}

function info(revision: number): WorkingCopyInfo {
  return {
    url: 'https://svn.example.com/atlas/trunk',
    repositoryRoot: 'https://svn.example.com/atlas',
    revision,
    branch: 'trunk',
    branchKind: 'trunk',
    source: 'network',
    cacheAge: 0,
  };
}

function batchItem(path: string, overrides: Partial<BatchUpdateItem> = {}): BatchUpdateItem {
  return {
    path,
    name: path.split('/').pop() ?? path,
    selected: false,
    requiresDirtyConfirmation: false,
    status: 'idle',
    filesProcessed: 0,
    ...overrides,
  };
}

function makeBatch(items: BatchUpdateItem[]): BatchUpdateController {
  return {
    items,
    summary: {
      total: items.length,
      selected: 0,
      queued: 0,
      running: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
      blocked: 0,
    },
    isChecking: false,
    checkAll: vi.fn().mockResolvedValue(undefined),
    toggleSelection: vi.fn().mockResolvedValue(undefined),
    startSelected: vi.fn().mockResolvedValue(undefined),
    cancelItem: vi.fn().mockResolvedValue(undefined),
    cancelAll: vi.fn().mockResolvedValue(undefined),
    retryFailed: vi.fn().mockResolvedValue(undefined),
    clearCompleted: vi.fn(),
    updatePaths: vi.fn().mockResolvedValue(undefined),
    updateAll: vi.fn().mockResolvedValue(undefined),
  };
}

function useWorkingCopies(paths: string[], summaries: Record<string, WorkingCopySummary>) {
  settingsState = { settings: { recentRepositories: paths }, isLoading: false };
  overview = new Map(Object.entries(summaries));
  batch = makeBatch(paths.map((path) => batchItem(path)));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOnboardingChecklistForTests();
  window.api = createMockElectronAPI();
  settingsState = { settings: { recentRepositories: [] }, isLoading: false };
  overview = new Map();
  batch = makeBatch([]);
});

afterEach(() => {
  resetOnboardingChecklistForTests();
});

describe('HomeScreen', () => {
  it('holds a loading state instead of claiming there are no working copies', () => {
    settingsState = { settings: { recentRepositories: [] }, isLoading: true };
    render(<HomeScreen />);
    expect(screen.getByTestId('home-loading')).toBeInTheDocument();
    expect(screen.queryByText('No working copies yet')).not.toBeInTheDocument();
  });

  it('first run: the two ways in, with the full getting-started checklist', () => {
    render(<HomeScreen />);
    expect(screen.getByText('No working copies yet')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-stub')).toHaveAttribute('data-compact', 'false');
    expect(screen.queryByTestId('home-focus')).not.toBeInTheDocument();
  });

  it('leads with the last working copy and every action targets it', async () => {
    useWorkingCopies(['/wc/atlas', '/wc/beacon'], {
      '/wc/atlas': { presence: 'full', status: counts(12), info: info(40053) },
      '/wc/beacon': { presence: 'full', status: counts(0), info: info(7) },
    });
    const reviewListener = vi.fn();
    window.addEventListener(REVIEW_CENTER_OPEN_EVENT, reviewListener);

    render(<HomeScreen />);

    const focus = screen.getByTestId('home-focus');
    expect(within(focus).getByRole('heading', { name: 'atlas' })).toBeInTheDocument();
    expect(within(focus).getByText('12 local changes')).toBeInTheDocument();
    expect(within(focus).getByText('trunk · r40053')).toBeInTheDocument();
    // Onboarding no longer dominates a returning user's screen.
    expect(screen.getByTestId('onboarding-stub')).toHaveAttribute('data-compact', 'true');

    fireEvent.click(within(focus).getByRole('button', { name: 'Update atlas' }));
    expect(batch.updatePaths).toHaveBeenCalledWith(['/wc/atlas']);

    fireEvent.click(within(focus).getByRole('button', { name: 'Review and commit in atlas' }));
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/files',
        search: { path: '/wc/atlas' },
      })
    );
    expect(mocks.addRecentRepo).toHaveBeenCalledWith('/wc/atlas');

    fireEvent.click(within(focus).getByRole('button', { name: 'History of atlas' }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/history',
      search: { path: '/wc/atlas' },
    });

    fireEvent.click(within(focus).getByRole('button', { name: /Review Center/ }));
    expect(reviewListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(REVIEW_CENTER_OPEN_EVENT, reviewListener);
  });

  it('asks the server only on request, through the batch pipeline', () => {
    useWorkingCopies(['/wc/atlas'], {
      '/wc/atlas': { presence: 'full', status: counts(0), info: info(9) },
    });
    render(<HomeScreen />);

    const focus = screen.getByTestId('home-focus');
    expect(within(focus).getByText('No local changes')).toBeInTheDocument();
    fireEvent.click(within(focus).getByRole('button', { name: 'Check for updates' }));
    expect(batch.checkAll).toHaveBeenCalledTimes(1);
    // Nothing to commit: the primary action is simply opening the files.
    expect(within(focus).getByRole('button', { name: 'Open files in atlas' })).toBeInTheDocument();
    // A single working copy does not get a second list repeating it.
    expect(screen.queryByRole('heading', { name: 'Working copies' })).not.toBeInTheDocument();
  });

  it('shows incoming revisions once checked, and updates selected copies from the list', () => {
    useWorkingCopies(['/wc/atlas', '/wc/beacon'], {
      '/wc/atlas': { presence: 'full', status: counts(0), info: info(10) },
      '/wc/beacon': { presence: 'full', status: counts(2), info: info(3) },
    });
    batch = makeBatch([
      batchItem('/wc/atlas', {
        status: 'ready',
        baseRevision: 10,
        headRevision: 12,
        checkedAt: Date.now(),
      }),
      batchItem('/wc/beacon', {
        status: 'ready',
        baseRevision: 3,
        headRevision: 3,
      }),
    ]);
    batch.summary.selected = 1;
    render(<HomeScreen />);

    expect(
      within(screen.getByTestId('home-focus')).getByText('2 incoming revisions')
    ).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Saved working copies' });
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select atlas for update' }));
    expect(batch.toggleSelection).toHaveBeenCalledWith('/wc/atlas');
    expect(within(list).getByText('2 local changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Update selected (1)' }));
    expect(batch.startSelected).toHaveBeenCalledTimes(1);
  });

  it('surfaces conflicts as attention and turns commit into resolving them', () => {
    useWorkingCopies(['/wc/atlas'], {
      '/wc/atlas': { presence: 'full', status: counts(3, 1), info: info(5) },
    });
    render(<HomeScreen />);

    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    const focus = screen.getByTestId('home-focus');
    expect(
      within(focus).getByRole('button', { name: 'Resolve conflicts in atlas' })
    ).toBeInTheDocument();
    expect(within(focus).getByText(/blocks commit/)).toBeInTheDocument();
  });

  it('hides Needs attention when nothing is wrong, and never repeats recent locations', () => {
    useWorkingCopies(['/wc/atlas'], {
      '/wc/atlas': { presence: 'full', status: counts(1), info: info(5) },
    });
    render(<HomeScreen />);
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.queryByText('Where you were last')).not.toBeInTheDocument();
  });

  it('offers recovery when the last working copy is gone', () => {
    useWorkingCopies(['/wc/gone'], { '/wc/gone': { presence: 'none' } });
    render(<HomeScreen />);

    const focus = screen.getByTestId('home-focus');
    expect(within(focus).getByText('Not a working copy')).toBeInTheDocument();
    expect(within(focus).queryByRole('button', { name: /Update/ })).not.toBeInTheDocument();
    fireEvent.click(
      within(focus).getByRole('button', {
        name: 'Remove gone from saved working copies',
      })
    );
    expect(mocks.removeRecentRepo).toHaveBeenCalledWith('/wc/gone');
  });
});
