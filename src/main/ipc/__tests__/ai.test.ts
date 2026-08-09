import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHandle = vi.hoisted(() => vi.fn());
const mockProviders = vi.hoisted(() => vi.fn());
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

vi.mock('../../services/ai-commit-message', () => ({
  getAiCommitProviders: mockProviders,
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
});
