import { createElement, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { useCommitDialogController } from '../useCommitDialogController';

const updateSettings = vi.fn();
const settings = {
  ...DEFAULT_SETTINGS,
  defaultCommitMessage: 'chore: prepared default',
  aiCommit: {
    ...DEFAULT_SETTINGS.aiCommit,
    enabled: true,
    provider: 'codex' as const,
    confirmBeforeSending: false,
  },
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
    config: { enabled: false, issueIdPattern: '', issueUrlTemplate: '' },
    updateConfig: vi.fn(),
  }),
}));
vi.mock('@renderer/hooks/useCommitRules', () => ({
  useCommitRules: () => ({
    rules: {
      minMessageLength: 0,
      maxSubjectLength: 0,
      requireIssueId: false,
      issueIdPattern: '',
      conventionalCommits: false,
      allowedTypes: [],
    },
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

describe('useCommitDialogController AI commit messages', () => {
  const cancel = vi.fn().mockResolvedValue({ success: true });
  const status = vi.fn().mockResolvedValue({
    entries: [{ path: '/repo/file.ts', status: 'M', isDirectory: false }],
  });
  const providers = vi
    .fn()
    .mockResolvedValue([
      { provider: 'codex', available: true, authenticated: true, version: '1.0.0' },
    ]);

  beforeEach(() => {
    vi.clearAllMocks();
    settings.aiCommit.confirmBeforeSending = false;
    window.api = {
      ai: {
        providers,
        generateCommitMessage: vi.fn(),
        transformDraft: vi.fn(),
        repositoryProfile: { get: vi.fn().mockResolvedValue(null) },
        cancel,
      },
      svn: { status },
      fs: { getDeepStatus: vi.fn().mockResolvedValue({ allEntries: [] }) },
    } as unknown as Window['api'];
  });

  it('applies an enabled transformation as an editable draft without committing', async () => {
    const transformDraft = vi.fn().mockResolvedValue({
      transformation: 'shorter',
      message: 'chore: prepare',
      omittedBinaryFiles: [],
      provider: 'codex',
      model: 'gpt-5.6-luna',
      durationMs: 120,
      truncated: false,
      redacted: false,
    });
    window.api.ai.transformDraft = transformDraft;
    const onSubmit = vi.fn();
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
    await waitFor(() => expect(result.current.aiProviderAvailable).toBe(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));
    act(() => result.current.handleTransformDraft('shorter'));
    await waitFor(() => expect(result.current.message).toBe('chore: prepare'));

    expect(transformDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDraft: 'chore: prepared default',
        transformation: 'shorter',
        paths: ['/repo/file.ts'],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('discards a transformation result after the user edits the draft', async () => {
    let resolveTransformation: (value: unknown) => void = () => undefined;
    window.api.ai.transformDraft = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveTransformation = resolve;
      })
    );
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
    await waitFor(() => expect(result.current.aiProviderAvailable).toBe(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));
    act(() => result.current.handleTransformDraft('imperative'));
    await waitFor(() => expect(result.current.isGeneratingMessage).toBe(true));
    act(() => result.current.handleMessageChange('fix: my manual edit'));
    act(() =>
      resolveTransformation({
        transformation: 'imperative',
        message: 'Discard this result',
        omittedBinaryFiles: [],
        provider: 'codex',
        durationMs: 100,
        truncated: false,
        redacted: false,
      })
    );
    await waitFor(() => expect(result.current.isGeneratingMessage).toBe(false));
    expect(result.current.message).toBe('fix: my manual edit');
    expect(cancel).toHaveBeenCalled();
  });

  it('uses the exact prompt-preview consent path before transforming', async () => {
    settings.aiCommit.confirmBeforeSending = true;
    const preparePrompt = vi.fn().mockResolvedValue({
      task: 'draft-transformation',
      provider: 'codex',
      prompt: 'exact bounded prompt',
      inputBytes: 20,
      truncated: false,
      redacted: false,
      omittedBinaryFiles: [],
      includedHistoryMessages: 0,
    });
    window.api.ai.preparePrompt = preparePrompt;
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
    await waitFor(() => expect(result.current.aiProviderAvailable).toBe(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));
    act(() => result.current.handleTransformDraft('match-style'));
    await waitFor(() =>
      expect(result.current.aiPromptPreview?.prompt).toBe('exact bounded prompt')
    );
    expect(preparePrompt).toHaveBeenCalledWith({
      task: 'draft-transformation',
      request: expect.objectContaining({
        currentDraft: 'chore: prepared default',
        transformation: 'match-style',
      }),
    });
    expect(result.current.showAiConsent).toBe(true);
  });

  it('exposes only transformations enabled by the repository profile', async () => {
    window.api.ai.repositoryProfile.get = vi.fn().mockResolvedValue({
      version: 1,
      commitPrefixes: [],
      issueIdPattern: '',
      subjectMaxLength: 72,
      bodyStyle: '',
      terminology: {},
      testPaths: [],
      generatedPaths: [],
      documentationPaths: [],
      excludedPaths: [],
      requiredReviewQuestions: [],
      enabledDraftTransformations: ['shorter', 'imperative'],
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
    await waitFor(() =>
      expect(result.current.enabledDraftTransformations).toEqual(['shorter', 'imperative'])
    );
  });

  it('initializes a newly opened dialog with the configured default message', async () => {
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

    await waitFor(() => expect(result.current.message).toBe('chore: prepared default'));
  });

  it('cancels an in-flight result when the file selection changes', async () => {
    const generateCommitMessage = vi.fn().mockImplementation(
      (_request: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true }
          );
        })
    );
    window.api.ai.generateCommitMessage = generateCommitMessage;

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

    await waitFor(() => expect(result.current.aiProviderAvailable).toBe(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));

    act(() => result.current.handleGenerateMessage());
    await waitFor(() => expect(result.current.isGeneratingMessage).toBe(true));
    expect(generateCommitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        workingCopyPath: '/repo',
        paths: ['/repo/file.ts'],
        existingMessage: 'chore: prepared default',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    act(() => result.current.handleToggleFile('/repo/file.ts'));
    await waitFor(() => expect(result.current.isGeneratingMessage).toBe(false));
    expect(cancel).toHaveBeenCalledWith(expect.any(String));

    expect(result.current.message).toBe('chore: prepared default');
    expect(result.current.aiError).toContain('selected files changed');
  });
});
