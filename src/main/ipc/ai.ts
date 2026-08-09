import type {
  AiCommitMessageRequest,
  AiConflictProposalRequest,
  AiDiffExplanationRequest,
  AiReleaseNotesRequest,
  AiSelectedPathsRequest,
  AiPromptPreviewRequest,
  RepositoryAiPromptProfile,
  AiTransformDraftRequest,
} from '@shared/types';
import { app } from 'electron';
import {
  cancelAiCommitMessage,
  explainAiDiff,
  generateAiCommitMessage,
  generateAiReleaseNotes,
  getAiCommitProviders,
  planAiCommit,
  proposeAiConflictResolution,
  reviewAiCommit,
  prepareAiPrompt,
  getAiUsageHistory,
  clearStoredAiUsageHistory,
  transformAiCommitDraft,
} from '../services/ai-commit-message';
import {
  previewRepositoryAiProfileImport,
  RepositoryAiProfileStore,
} from '../services/ai-repository-profile';

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

export function registerAiHandlers(ipcMain: AiIpcMain): void {
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
}
