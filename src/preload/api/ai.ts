import type { ElectronAPI } from '@shared/types';
import type { InvokeIpc } from './ipc';

export function createAiApi(invokeIpc: InvokeIpc): ElectronAPI['ai'] {
  const cancellable = <T>(
    operationId: string,
    request: Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    if (!signal || typeof signal.addEventListener !== 'function') return request;
    const abortHandler = () => {
      void invokeIpc('ai:cancel', operationId).catch(() => undefined);
    };
    signal.addEventListener('abort', abortHandler, { once: true });
    if (signal.aborted) abortHandler();
    return request.finally(() => signal.removeEventListener('abort', abortHandler));
  };

  return {
    providers: () => invokeIpc('ai:providers'),
    preparePrompt: (request) => invokeIpc('ai:preparePrompt', request),
    usageHistory: () => invokeIpc('ai:usageHistory'),
    clearUsageHistory: () => invokeIpc('ai:clearUsageHistory'),
    repositoryProfile: {
      get: (workingCopyPath) => invokeIpc('ai:repositoryProfile:get', workingCopyPath),
      previewImport: (json) => invokeIpc('ai:repositoryProfile:previewImport', json),
      save: (workingCopyPath, profile) =>
        invokeIpc('ai:repositoryProfile:save', workingCopyPath, profile),
      remove: (workingCopyPath) => invokeIpc('ai:repositoryProfile:remove', workingCopyPath),
    },
    generateCommitMessage: (request, options) => {
      return cancellable(
        request.operationId,
        invokeIpc('ai:generateCommitMessage', request),
        options?.signal
      );
    },
    transformDraft: (request, options) =>
      cancellable(request.operationId, invokeIpc('ai:transformDraft', request), options?.signal),
    reviewCommit: (request, options) =>
      cancellable(request.operationId, invokeIpc('ai:reviewCommit', request), options?.signal),
    planCommit: (request, options) =>
      cancellable(request.operationId, invokeIpc('ai:planCommit', request), options?.signal),
    explainDiff: (request, options) =>
      cancellable(request.operationId, invokeIpc('ai:explainDiff', request), options?.signal),
    generateReleaseNotes: (request, options) =>
      cancellable(
        request.operationId,
        invokeIpc('ai:generateReleaseNotes', request),
        options?.signal
      ),
    proposeConflictResolution: (request, options) =>
      cancellable(
        request.operationId,
        invokeIpc('ai:proposeConflictResolution', request),
        options?.signal
      ),
    cancel: (operationId) => invokeIpc('ai:cancel', operationId),
  };
}
