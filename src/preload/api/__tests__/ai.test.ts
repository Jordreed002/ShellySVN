import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiCommitMessageRequest, AiCommitMessageResult } from '@shared/types';
import { createAiApi } from '../ai';
import type { InvokeIpc } from '../ipc';

const request: AiCommitMessageRequest = {
  operationId: 'ai-commit-1',
  workingCopyPath: '/repo',
  paths: ['/repo/src/app.ts'],
  existingMessage: 'Draft',
};

const result: AiCommitMessageResult = {
  message: 'feat: improve the application',
  provider: 'codex',
  diffTruncated: false,
  omittedBinaryFiles: [],
  redacted: false,
};

describe('AI preload IPC contract', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createAiApi>;

  beforeEach(() => {
    invoke = vi.fn();
    api = createAiApi(invoke as unknown as InvokeIpc);
  });

  it('maps provider discovery and explicit cancellation', async () => {
    invoke.mockResolvedValueOnce([]).mockResolvedValueOnce({ success: true });

    await api.providers();
    await api.cancel('ai-commit-1');

    expect(invoke).toHaveBeenNthCalledWith(1, 'ai:providers');
    expect(invoke).toHaveBeenNthCalledWith(2, 'ai:cancel', 'ai-commit-1');
  });

  it('passes only the serializable request to generation IPC', async () => {
    invoke.mockResolvedValue(result);

    await expect(api.generateCommitMessage(request)).resolves.toEqual(result);

    expect(invoke).toHaveBeenCalledWith('ai:generateCommitMessage', request);
  });

  it('maps fixed draft transformations to their cancellable IPC channel', async () => {
    invoke.mockResolvedValue({ message: 'Fix cache', transformation: 'shorter' });
    const transform = {
      operationId: 'transform-1',
      workingCopyPath: '/repo',
      paths: ['/repo/src/app.ts'],
      currentDraft: 'A long current draft',
      transformation: 'shorter' as const,
    };
    await api.transformDraft(transform);
    expect(invoke).toHaveBeenCalledWith('ai:transformDraft', transform);
  });

  it('maps the five structured assistant workflows to dedicated channels', async () => {
    invoke.mockResolvedValue({});
    const selected = { operationId: 'review-1', workingCopyPath: '/repo', paths: ['/repo/a.ts'] };
    const diff = {
      operationId: 'diff-1',
      workingCopyPath: '/repo',
      path: '/repo/a.ts',
      mode: 'summary' as const,
    };
    const release = { operationId: 'release-1', path: '/repo', startRevision: 1, endRevision: 9 };
    const conflict = {
      operationId: 'conflict-1',
      filePath: '/repo/a.ts',
      baseContent: 'a',
      mineContent: 'b',
      theirsContent: 'c',
    };

    await api.reviewCommit(selected);
    await api.planCommit(selected);
    await api.explainDiff(diff);
    await api.generateReleaseNotes(release);
    await api.proposeConflictResolution(conflict);

    expect(invoke).toHaveBeenNthCalledWith(1, 'ai:reviewCommit', selected);
    expect(invoke).toHaveBeenNthCalledWith(2, 'ai:planCommit', selected);
    expect(invoke).toHaveBeenNthCalledWith(3, 'ai:explainDiff', diff);
    expect(invoke).toHaveBeenNthCalledWith(4, 'ai:generateReleaseNotes', release);
    expect(invoke).toHaveBeenNthCalledWith(5, 'ai:proposeConflictResolution', conflict);
  });

  it('requests cancellation on abort while preserving the generation result', async () => {
    const controller = new AbortController();
    let resolveGeneration!: (value: AiCommitMessageResult) => void;
    const generation = new Promise<AiCommitMessageResult>((resolve) => {
      resolveGeneration = resolve;
    });
    invoke.mockImplementation((channel: string) =>
      channel === 'ai:generateCommitMessage' ? generation : Promise.resolve({ success: true })
    );

    const pending = api.generateCommitMessage(request, { signal: controller.signal });
    controller.abort();
    resolveGeneration(result);

    await expect(pending).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith('ai:cancel', request.operationId);
  });

  it('does not let a failed cancellation overwrite the generation result', async () => {
    const controller = new AbortController();
    invoke.mockImplementation((channel: string) => {
      if (channel === 'ai:generateCommitMessage') return Promise.resolve(result);
      return Promise.reject(new Error('cancel failed'));
    });

    const pending = api.generateCommitMessage(request, { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual(result);
  });
});
