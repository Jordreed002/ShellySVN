import { createElement, type FormEvent, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { useCommitDialogController } from '../useCommitDialogController';

/**
 * Coverage for the #73 additions to the commit dialog controller: per-WC
 * recent-message recall on commit, the repository-profile issue pattern
 * feeding the linkified chips, and the profile subject cap exposed for the
 * message guide.
 */

const updateSettings = vi.fn();
const settings = { ...DEFAULT_SETTINGS, defaultCommitMessage: '' };

const trackerState: {
  config: { enabled: boolean; issueIdPattern: string; issueUrlTemplate: string };
} = {
  config: { enabled: true, issueIdPattern: '[A-Z]+-\\d+', issueUrlTemplate: 'https://t/browse/{id}' },
};

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings, isLoading: false, updateSettings }),
}));
vi.mock('@renderer/hooks/useCommitMessageHistory', () => ({
  useCommitMessageHistory: () => ({ history: [], addMessage: vi.fn() }),
}));
vi.mock('@renderer/hooks/useCommitTemplates', () => ({
  setTemplateContext: vi.fn(),
  useCommitTemplates: () => ({ templates: [], applyTemplate: vi.fn() }),
}));
vi.mock('@renderer/hooks/useIssueTrackerConfig', () => ({
  useIssueTrackerConfig: () => ({
    config: trackerState.config,
    updateConfig: vi.fn(),
  }),
}));
vi.mock('@renderer/hooks/useCommitRules', () => ({
  useCommitRules: () => ({
    rules: { minMessageLength: 0, requireIssueId: false, issueIdPattern: '' },
    updateRules: vi.fn(),
  }),
}));
vi.mock('@renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useCommitDialogController commit dialog upgrades', () => {
  let status: ReturnType<typeof vi.fn>;
  let storeGet: ReturnType<typeof vi.fn>;
  let storeSet: ReturnType<typeof vi.fn>;
  let repositoryProfileGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    settings.defaultCommitMessage = '';
    trackerState.config = {
      enabled: true,
      issueIdPattern: '[A-Z]+-\\d+',
      issueUrlTemplate: 'https://t/browse/{id}',
    };
    // Fresh mocks per test: shared describe-scope mocks left a pending act()
    // queue that hung the follow-up test's submit.
    status = vi.fn().mockResolvedValue({
      entries: [{ path: '/repo/file.ts', status: 'M', isDirectory: false }],
    });
    storeGet = vi.fn().mockResolvedValue(undefined);
    storeSet = vi.fn().mockResolvedValue(undefined);
    repositoryProfileGet = vi.fn().mockResolvedValue(null);
    window.api = {
      ai: {
        providers: vi.fn().mockResolvedValue([]),
        repositoryProfile: { get: repositoryProfileGet },
        cancel: vi.fn().mockResolvedValue({ success: true }),
      },
      svn: { status },
      fs: { getDeepStatus: vi.fn().mockResolvedValue({ allEntries: [] }) },
      store: { get: storeGet, set: storeSet },
    } as unknown as Window['api'];
  });

  it('records the message in the per-working-copy recall store on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true, revision: 42 });
    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: '/repo',
          onClose: vi.fn(),
          onSubmit,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.selectedCount).toBe(1));
    act(() => result.current.handleMessageChange('fix: per-wc recall works'));

    // Fire the submit inside a sync act and await its outcome via state:
    // `await act(async () => await handleSubmit(...))` reliably deadlocks the
    // act queue in this jsdom/forks setup, while the fire-and-observe form
    // below exercises the same code path deterministically.
    let submitPromise: Promise<void> | undefined;
    act(() => {
      submitPromise = result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent);
    });
    await waitFor(() => expect(result.current.success).toEqual({ revision: 42 }));
    await submitPromise;

    expect(onSubmit).toHaveBeenCalledWith(['/repo/file.ts'], 'fix: per-wc recall works');
    // The recall write is awaited inside handleSubmit, so it has settled.
    expect(storeSet).toHaveBeenCalledWith('shellysvn:recent-commit-messages:v1', {
      '/repo': [{ message: 'fix: per-wc recall works', timestamp: expect.any(Number) }],
    });
  });

  it('passes selected unversioned paths separately for scheduling before commit', async () => {
    status.mockResolvedValue({
      entries: [{ path: '/repo/new-icons', status: '?', isDirectory: true }],
    });
    const onSubmit = vi.fn().mockResolvedValue({ success: true, revision: 43 });
    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: '/repo',
          onClose: vi.fn(),
          onSubmit,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.files).toHaveLength(1));
    act(() => {
      result.current.handleToggleFile('/repo/new-icons');
      result.current.handleMessageChange('feat: add icons');
    });
    let submitPromise: Promise<void> | undefined;
    act(() => {
      submitPromise = result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent);
    });
    await waitFor(() => expect(result.current.success).toEqual({ revision: 43 }));
    await submitPromise;

    expect(onSubmit).toHaveBeenCalledWith(
      ['/repo/new-icons'],
      'feat: add icons',
      ['/repo/new-icons']
    );
  });

  it('uses the repository profile issue pattern when the tracker config is still default', async () => {
    repositoryProfileGet.mockResolvedValue({
      version: 1,
      commitPrefixes: [],
      issueIdPattern: 'ABC-\\d+',
      subjectMaxLength: 60,
      bodyStyle: '',
      terminology: {},
      testPaths: [],
      generatedPaths: [],
      documentationPaths: [],
      excludedPaths: [],
      requiredReviewQuestions: [],
      enabledDraftTransformations: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: '/repo',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.issuePatternFromProfile).toBe('ABC-\\d+'));
    act(() => result.current.handleMessageChange('fix ABC-9 now'));

    await waitFor(() =>
      expect(result.current.issueLinks).toEqual([{ id: 'ABC-9', url: 'https://t/browse/ABC-9' }])
    );
    expect(result.current.profileSubjectMaxLength).toBe(60);
    expect(result.current.effectiveIssueTrackerConfig.issueIdPattern).toBe('ABC-\\d+');
  });

  it('never overrides a user-configured tracker pattern with the profile one', async () => {
    trackerState.config = {
      enabled: true,
      issueIdPattern: 'XY-\\d+',
      issueUrlTemplate: 'https://t/browse/{id}',
    };
    repositoryProfileGet.mockResolvedValue({
      version: 1,
      issueIdPattern: 'ABC-\\d+',
      subjectMaxLength: 72,
      enabledDraftTransformations: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: '/repo',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => expect(repositoryProfileGet).toHaveBeenCalledWith('/repo'));
    await waitFor(() => expect(result.current.issuePatternFromProfile).toBeNull());
    act(() => result.current.handleMessageChange('fix ABC-9 now'));

    await waitFor(() => expect(result.current.issueLinks).toEqual([]));
  });

  it('ignores an invalid profile pattern', async () => {
    repositoryProfileGet.mockResolvedValue({
      version: 1,
      issueIdPattern: '([broken',
      subjectMaxLength: 72,
      enabledDraftTransformations: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { result } = renderHook(
      () =>
        useCommitDialogController({
          isOpen: true,
          workingCopyPath: '/repo',
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => expect(repositoryProfileGet).toHaveBeenCalledWith('/repo'));
    await waitFor(() => expect(result.current.issuePatternFromProfile).toBeNull());
    expect(result.current.effectiveIssueTrackerConfig).toEqual(trackerState.config);
  });
});
