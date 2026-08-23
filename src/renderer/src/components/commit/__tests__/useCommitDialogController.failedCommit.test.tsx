import { createElement, type FormEvent, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { useCommitDialogController } from '../useCommitDialogController';

/**
 * The failed-commit counterpart of the recall-store coverage in
 * `useCommitDialogController.extras.test.tsx`. Kept in its own file: two
 * full-submit tests in one file deadlock the shared act() queue in this
 * jsdom/forks setup, while each passes in isolation.
 */

const settings = { ...DEFAULT_SETTINGS, defaultCommitMessage: '' };

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings, isLoading: false, updateSettings: vi.fn() }),
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
    config: { enabled: false, issueIdPattern: '', issueUrlTemplate: '' },
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

describe('useCommitDialogController failed commits', () => {
  const storeSet = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    settings.defaultCommitMessage = '';
    window.api = {
      ai: {
        providers: vi.fn().mockResolvedValue([]),
        repositoryProfile: { get: vi.fn().mockResolvedValue(null) },
        cancel: vi.fn().mockResolvedValue({ success: true }),
      },
      svn: {
        status: vi.fn().mockResolvedValue({
          entries: [{ path: '/repo/file.ts', status: 'M', isDirectory: false }],
        }),
      },
      fs: { getDeepStatus: vi.fn().mockResolvedValue({ allEntries: [] }) },
      store: { get: vi.fn().mockResolvedValue(undefined), set: storeSet },
    } as unknown as Window['api'];
  });

  it('does not record a recall entry when the commit fails', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: false, message: 'conflict' });
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
    act(() => result.current.handleMessageChange('fix: will fail'));

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
    await waitFor(() => expect(result.current.error).toBe('conflict'));
    await submitPromise;

    expect(storeSet).not.toHaveBeenCalled();
  });
});
