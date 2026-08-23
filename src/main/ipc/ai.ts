import type {
  AiCommitMessageRequest,
  AiConflictProposalRequest,
  AiCostEstimateRequest,
  AiCustomProviderUpsertInput,
  AiDiffExplanationRequest,
  AiProviderCredentialInput,
  AiProviderId,
  AiReleaseNotesRequest,
  AiSelectedPathsRequest,
  AiStreamEvent,
  AiPromptPreviewRequest,
  RepositoryAiPromptProfile,
  AiTransformDraftRequest,
} from '@shared/types';
import { app, webContents } from 'electron';
import {
  cancelAiCommitMessage,
  estimateAiCostForRequest,
  explainAiDiff,
  generateAiCommitMessage,
  generateAiReleaseNotes,
  getAiCommitProviders,
  listAiProviderModels,
  planAiCommit,
  proposeAiConflictResolution,
  reviewAiCommit,
  prepareAiPrompt,
  getAiUsageHistory,
  clearStoredAiUsageHistory,
  transformAiCommitDraft,
} from '../services/ai-commit-message';
import { currentAiCredentialsStore } from '../services/ai-credentials';
import {
  getAiWorkingCopyConsent,
  setAiWorkingCopyConsent,
} from '../services/ai-privacy-scanner';
import {
  previewRepositoryAiProfileImport,
  RepositoryAiProfileStore,
} from '../services/ai-repository-profile';
import { setAiStreamListener } from '../services/ai-providers/stream-emitter';

interface AiIpcEvent {
  sender: { id: number };
}

interface AiIpcMain {
  handle(channel: string, listener: (event: AiIpcEvent, ...args: unknown[]) => unknown): void;
}

let profileStore: RepositoryAiProfileStore | undefined;

function getProfileStore(): RepositoryAiProfileStore {
  profileStore ??= new RepositoryAiProfileStore(app.getPath('userData'));
  return profileStore;
}

/**
 * Forward AI stream events to every renderer on the `ai:stream` channel.
 * The main-process service owns the event shapes; this layer only transports.
 */
function forwardStreamEvent(event: AiStreamEvent): void {
  if (typeof webContents?.getAllWebContents !== 'function') return;
  for (const contents of webContents.getAllWebContents()) {
    try {
      contents.send('ai:stream', event);
    } catch {
      // A closed renderer must never break other subscribers.
    }
  }
}

function toOperationResult(error: unknown): { success: boolean; error?: string } {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

export function registerAiHandlers(ipcMain: AiIpcMain): void {
  setAiStreamListener(forwardStreamEvent);
  ipcMain.handle('ai:providers', () => getAiCommitProviders());
  ipcMain.handle('ai:preparePrompt', (_event, ...args) =>
    prepareAiPrompt(args[0] as AiPromptPreviewRequest)
  );
  ipcMain.handle('ai:usageHistory', () => getAiUsageHistory());
  ipcMain.handle('ai:clearUsageHistory', () =>
    clearStoredAiUsageHistory().then(() => ({ success: true }))
  );
  ipcMain.handle('ai:repositoryProfile:get', (_event, ...args) =>
    getProfileStore().get(args[0] as string)
  );
  ipcMain.handle('ai:repositoryProfile:previewImport', (_event, ...args) =>
    previewRepositoryAiProfileImport(args[0] as string)
  );
  ipcMain.handle('ai:repositoryProfile:save', (_event, ...args) =>
    getProfileStore()
      .save(args[0] as string, args[1] as RepositoryAiPromptProfile)
      .then(() => ({ success: true }))
  );
  ipcMain.handle('ai:repositoryProfile:remove', (_event, ...args) =>
    getProfileStore()
      .remove(args[0] as string)
      .then(() => ({ success: true }))
  );
  ipcMain.handle('ai:generateCommitMessage', (event, ...args) =>
    generateAiCommitMessage(args[0] as AiCommitMessageRequest, event.sender.id)
  );
  ipcMain.handle('ai:transformDraft', (event, ...args) =>
    transformAiCommitDraft(args[0] as AiTransformDraftRequest, event.sender.id)
  );
  ipcMain.handle('ai:reviewCommit', (event, ...args) =>
    reviewAiCommit(args[0] as AiSelectedPathsRequest, event.sender.id)
  );
  ipcMain.handle('ai:planCommit', (event, ...args) =>
    planAiCommit(args[0] as AiSelectedPathsRequest, event.sender.id)
  );
  ipcMain.handle('ai:explainDiff', (event, ...args) =>
    explainAiDiff(args[0] as AiDiffExplanationRequest, event.sender.id)
  );
  ipcMain.handle('ai:generateReleaseNotes', (event, ...args) =>
    generateAiReleaseNotes(args[0] as AiReleaseNotesRequest, event.sender.id)
  );
  ipcMain.handle('ai:proposeConflictResolution', (event, ...args) =>
    proposeAiConflictResolution(args[0] as AiConflictProposalRequest, event.sender.id)
  );
  ipcMain.handle('ai:cancel', (event, ...args) =>
    cancelAiCommitMessage(args[0] as string, event.sender.id).then((success) => ({
      success,
      error: success ? undefined : 'No matching AI generation is running.',
    }))
  );
  ipcMain.handle('ai:credentials:summary', () => currentAiCredentialsStore().summary());
  ipcMain.handle('ai:credentials:save', (_event, ...args) =>
    currentAiCredentialsStore()
      .saveProviderCredential(args[0] as AiProviderCredentialInput)
      .then(() => ({ success: true }))
      .catch((error: unknown) => toOperationResult(error))
  );
  ipcMain.handle('ai:credentials:remove', (_event, ...args) =>
    currentAiCredentialsStore()
      .removeProviderCredential(args[0] as AiProviderId)
      .then(() => ({ success: true }))
  );
  ipcMain.handle('ai:custom-providers:upsert', (_event, ...args) =>
    currentAiCredentialsStore()
      .upsertCustomProvider(args[0] as AiCustomProviderUpsertInput)
      .then(({ id }) => ({ success: true, id }))
      .catch((error: unknown) => toOperationResult(error))
  );
  ipcMain.handle('ai:estimateCost', (_event, ...args) =>
    estimateAiCostForRequest(args[0] as AiCostEstimateRequest)
  );
  ipcMain.handle('ai:listModels', (_event, ...args) =>
    listAiProviderModels(args[0] as AiProviderId)
  );
  ipcMain.handle('ai:consent:get', (_event, ...args) =>
    getAiWorkingCopyConsent(args[0] as string)
  );
  ipcMain.handle('ai:consent:set', (_event, ...args) =>
    setAiWorkingCopyConsent(args[0] as string, args[1] === true)
      .then(() => ({ success: true }))
      .catch((error: unknown) => toOperationResult(error))
  );
}
