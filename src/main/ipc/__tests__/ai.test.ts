import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHandle = vi.hoisted(() => vi.fn());
const mockProviders = vi.hoisted(() => vi.fn());
const mockInvalidateProviders = vi.hoisted(() => vi.fn());
const mockGenerate = vi.hoisted(() => vi.fn());
const mockCancel = vi.hoisted(() => vi.fn());
const mockReview = vi.hoisted(() => vi.fn());
const mockPlan = vi.hoisted(() => vi.fn());
const mockExplain = vi.hoisted(() => vi.fn());
const mockReleaseNotes = vi.hoisted(() => vi.fn());
const mockConflict = vi.hoisted(() => vi.fn());
const mockPrepare = vi.hoisted(() => vi.fn());
const mockHistory = vi.hoisted(() => vi.fn());
const mockClearHistory = vi.hoisted(() => vi.fn());
const mockTransform = vi.hoisted(() => vi.fn());
const mockListModels = vi.hoisted(() => vi.fn());
const mockEstimateCost = vi.hoisted(() => vi.fn());
const mockCredentialsStore = vi.hoisted(() => ({
  summary: vi.fn(),
  saveProviderCredential: vi.fn(),
  removeProviderCredential: vi.fn(),
  upsertCustomProvider: vi.fn(),
}));
const mockConsentGet = vi.hoisted(() => vi.fn());
const mockConsentSet = vi.hoisted(() => vi.fn());

vi.mock('../../services/ai-commit-message', () => ({
  getAiCommitProviders: mockProviders,
  invalidateAiProviderStatusCache: mockInvalidateProviders,
  generateAiCommitMessage: mockGenerate,
  cancelAiCommitMessage: mockCancel,
  reviewAiCommit: mockReview,
  planAiCommit: mockPlan,
  explainAiDiff: mockExplain,
  generateAiReleaseNotes: mockReleaseNotes,
  proposeAiConflictResolution: mockConflict,
  prepareAiPrompt: mockPrepare,
  getAiUsageHistory: mockHistory,
  clearStoredAiUsageHistory: mockClearHistory,
  transformAiCommitDraft: mockTransform,
  listAiProviderModels: mockListModels,
  estimateAiCostForRequest: mockEstimateCost,
}));

vi.mock('../../services/ai-credentials', () => ({
  currentAiCredentialsStore: () => mockCredentialsStore,
}));

vi.mock('../../services/ai-privacy-scanner', () => ({
  getAiWorkingCopyConsent: mockConsentGet,
  setAiWorkingCopyConsent: mockConsentSet,
}));

import { registerAiHandlers } from '../ai';

describe('AI IPC handlers', () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockHandle.mockImplementation((channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler);
    });
    registerAiHandlers({ handle: mockHandle });
  });

  it('registers provider, generation, and cancellation handlers', () => {
    expect([...handlers.keys()]).toEqual([
      'ai:providers',
      'ai:preparePrompt',
      'ai:usageHistory',
      'ai:clearUsageHistory',
      'ai:repositoryProfile:get',
      'ai:repositoryProfile:previewImport',
      'ai:repositoryProfile:save',
      'ai:repositoryProfile:remove',
      'ai:generateCommitMessage',
      'ai:transformDraft',
      'ai:reviewCommit',
      'ai:planCommit',
      'ai:explainDiff',
      'ai:generateReleaseNotes',
      'ai:proposeConflictResolution',
      'ai:cancel',
      'ai:credentials:summary',
      'ai:credentials:save',
      'ai:credentials:remove',
      'ai:custom-providers:upsert',
      'ai:estimateCost',
      'ai:listModels',
      'ai:consent:get',
      'ai:consent:set',
    ]);
  });

  it('binds every structured assistant task to the sending renderer', async () => {
    const event = { sender: { id: 19 } };
    const selected = { operationId: 'review-1', workingCopyPath: '/wc', paths: ['/wc/a.ts'] };
    const diff = { operationId: 'diff-1', workingCopyPath: '/wc', path: '/wc/a.ts', mode: 'risks' };
    const release = { operationId: 'release-1', path: '/wc', startRevision: 10, endRevision: 20 };
    const conflict = {
      operationId: 'conflict-1',
      filePath: '/wc/a.ts',
      baseContent: 'a',
      mineContent: 'b',
      theirsContent: 'c',
    };
    const transform = {
      operationId: 'transform-1',
      workingCopyPath: '/wc',
      paths: ['/wc/a.ts'],
      currentDraft: 'Old draft',
      transformation: 'shorter',
    };

    await handlers.get('ai:transformDraft')!(event, transform);
    await handlers.get('ai:reviewCommit')!(event, selected);
    await handlers.get('ai:planCommit')!(event, selected);
    await handlers.get('ai:explainDiff')!(event, diff);
    await handlers.get('ai:generateReleaseNotes')!(event, release);
    await handlers.get('ai:proposeConflictResolution')!(event, conflict);

    expect(mockReview).toHaveBeenCalledWith(selected, 19);
    expect(mockPlan).toHaveBeenCalledWith(selected, 19);
    expect(mockExplain).toHaveBeenCalledWith(diff, 19);
    expect(mockReleaseNotes).toHaveBeenCalledWith(release, 19);
    expect(mockConflict).toHaveBeenCalledWith(conflict, 19);
    expect(mockTransform).toHaveBeenCalledWith(transform, 19);
  });

  it('binds generation and cancellation to the sending renderer', async () => {
    const event = { sender: { id: 42 } };
    const request = {
      operationId: 'operation-1',
      workingCopyPath: '/wc',
      paths: ['/wc/file.ts'],
    };
    mockGenerate.mockResolvedValue({ message: 'Describe change', provider: 'codex' });
    mockCancel.mockResolvedValue(true);

    await handlers.get('ai:generateCommitMessage')!(event, request);
    const cancelled = await handlers.get('ai:cancel')!(event, 'operation-1');

    expect(mockGenerate).toHaveBeenCalledWith(request, 42);
    expect(mockCancel).toHaveBeenCalledWith('operation-1', 42);
    expect(cancelled).toEqual({ success: true, error: undefined });
  });

  it('does not report another renderer operation as cancelled', async () => {
    mockCancel.mockResolvedValue(false);

    const result = await handlers.get('ai:cancel')!({ sender: { id: 7 } }, 'missing');

    expect(result).toEqual({
      success: false,
      error: 'No matching AI generation is running.',
    });
  });

  it('registers credentials, estimate, model, and consent handlers', async () => {
    mockCredentialsStore.summary.mockResolvedValue({ encryptionAvailable: true, providers: [] });
    mockCredentialsStore.saveProviderCredential.mockResolvedValue(undefined);
    mockCredentialsStore.removeProviderCredential.mockResolvedValue(undefined);
    mockEstimateCost.mockResolvedValue({ estimatedCostUsd: 0 });
    mockListModels.mockResolvedValue([]);
    mockConsentGet.mockResolvedValue(null);
    mockConsentSet.mockResolvedValue(undefined);

    await handlers.get('ai:credentials:summary')!({});
    await handlers.get('ai:credentials:save')!({}, { provider: 'anthropic', apiKey: 'k' });
    await handlers.get('ai:credentials:remove')!({}, 'anthropic');
    await handlers.get('ai:estimateCost')!({}, { provider: 'anthropic', inputChars: 400 });
    await handlers.get('ai:listModels')!({}, 'ollama');
    await handlers.get('ai:consent:get')!({}, '/wc');
    await handlers.get('ai:consent:set')!({}, '/wc', false);

    expect(mockCredentialsStore.summary).toHaveBeenCalled();
    expect(mockCredentialsStore.saveProviderCredential).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'k',
    });
    expect(mockCredentialsStore.removeProviderCredential).toHaveBeenCalledWith('anthropic');
    expect(mockEstimateCost).toHaveBeenCalledWith({ provider: 'anthropic', inputChars: 400 });
    expect(mockListModels).toHaveBeenCalledWith('ollama');
    expect(mockConsentGet).toHaveBeenCalledWith('/wc');
    expect(mockConsentSet).toHaveBeenCalledWith('/wc', false);
    // Successful credential mutations drop the cached provider statuses.
    expect(mockInvalidateProviders).toHaveBeenCalledTimes(2);
  });

  it('upserts custom providers and forwards provider ids unchanged', async () => {
    mockCredentialsStore.upsertCustomProvider.mockResolvedValue({ id: 'custom:acme' });
    mockCredentialsStore.removeProviderCredential.mockResolvedValue(undefined);
    mockListModels.mockResolvedValue([]);

    const upsert = await handlers.get('ai:custom-providers:upsert')!({}, {
      displayName: 'Acme',
      protocol: 'openai-compatible',
      apiKey: 'k',
      baseUrl: 'https://acme.test/v1',
      modelOverride: 'acme-model',
    });
    await handlers.get('ai:credentials:remove')!({}, 'custom:acme');
    await handlers.get('ai:listModels')!({}, 'custom:acme');

    expect(upsert).toEqual({ success: true, id: 'custom:acme' });
    expect(mockCredentialsStore.upsertCustomProvider).toHaveBeenCalledWith({
      displayName: 'Acme',
      protocol: 'openai-compatible',
      apiKey: 'k',
      baseUrl: 'https://acme.test/v1',
      modelOverride: 'acme-model',
    });
    expect(mockCredentialsStore.removeProviderCredential).toHaveBeenCalledWith('custom:acme');
    expect(mockListModels).toHaveBeenCalledWith('custom:acme');
    expect(mockInvalidateProviders).toHaveBeenCalledTimes(2);
  });

  it('wraps custom provider upsert failures into a failed operation result', async () => {
    mockCredentialsStore.upsertCustomProvider.mockRejectedValue(
      new Error('Custom provider names must be 1 to 80 characters.')
    );

    const result = await handlers.get('ai:custom-providers:upsert')!({}, {
      displayName: '',
      protocol: 'ollama',
    });

    expect(result).toEqual({
      success: false,
      error: 'Custom provider names must be 1 to 80 characters.',
    });
    expect(mockInvalidateProviders).not.toHaveBeenCalled();
  });
});
