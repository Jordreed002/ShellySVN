import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { assertPathApprovedForIpc } from '../../../utils/approved-paths';
import { writeSecureJson } from '../../../utils/secure-json';

export interface AiSessionRecoveryState {
  selectedRelativePaths: string[];
  commitDraft: string;
  reviewFindingIds: string[];
  activeChangelist?: string;
  expiresAt: string;
}
interface RecoveryFile {
  version: 1;
  sessions: Record<string, AiSessionRecoveryState>;
}

const AI_SESSION_RECOVERY_POLICY = {
  storage: 'private-file',
  persistsPrompts: false,
  persistsDiffs: false,
  persistsProviderOutput: false,
  fields: ['selectedRelativePaths', 'commitDraft', 'reviewFindingIds', 'activeChangelist'],
} as const;
const MAX_SESSIONS = 50;

function safeRelativePaths(paths: string[]): string[] {
  return [...new Set(paths)]
    .filter(
      (path) =>
        path && !isAbsolute(path) && !path.split(/[\\/]/).includes('..') && !/[\0\r\n]/.test(path)
    )
    .slice(0, 1_000);
}

function sanitizeState(value: unknown): AiSessionRecoveryState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<AiSessionRecoveryState>;
  if (!Array.isArray(state.selectedRelativePaths) || !Array.isArray(state.reviewFindingIds))
    return null;
  if (typeof state.commitDraft !== 'string' || typeof state.expiresAt !== 'string') return null;
  if (!Number.isFinite(Date.parse(state.expiresAt))) return null;
  return {
    selectedRelativePaths: safeRelativePaths(
      state.selectedRelativePaths.filter((path): path is string => typeof path === 'string')
    ),
    commitDraft: state.commitDraft.slice(0, 100_000),
    reviewFindingIds: [...new Set(state.reviewFindingIds)]
      .filter((id): id is string => typeof id === 'string' && !/[\0\r\n]/.test(id))
      .slice(0, 1_000)
      .map((id) => id.slice(0, 200)),
    activeChangelist:
      typeof state.activeChangelist === 'string' && !/[\0\r\n]/.test(state.activeChangelist)
        ? state.activeChangelist.slice(0, 200)
        : undefined,
    expiresAt: state.expiresAt,
  };
}
export class AiSessionRecoveryStore {
  readonly policy = AI_SESSION_RECOVERY_POLICY;
  constructor(
    private readonly storageDirectory: string,
    private readonly ttlMs = 7 * 24 * 60 * 60 * 1_000
  ) {}
  private get path(): string {
    return join(this.storageDirectory, 'ai-session-recovery.json');
  }
  private identity(workingCopyPath: string): string {
    const approved = assertPathApprovedForIpc(workingCopyPath, 'AI session recovery');
    return createHash('sha256').update(approved).digest('hex');
  }
  private async read(): Promise<RecoveryFile> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as RecoveryFile;
      if (value.version !== 1 || !value.sessions || typeof value.sessions !== 'object')
        return { version: 1, sessions: {} };
      const sessions = Object.fromEntries(
        Object.entries(value.sessions)
          .slice(0, MAX_SESSIONS)
          .flatMap(([key, state]) => {
            const safe = /^[a-f0-9]{64}$/.test(key) ? sanitizeState(state) : null;
            return safe ? [[key, safe]] : [];
          })
      );
      return { version: 1, sessions };
    } catch {
      return { version: 1, sessions: {} };
    }
  }
  async save(
    workingCopyPath: string,
    state: Omit<AiSessionRecoveryState, 'expiresAt'>,
    now = Date.now()
  ): Promise<void> {
    const data = await this.read();
    data.sessions[this.identity(workingCopyPath)] = {
      selectedRelativePaths: safeRelativePaths(state.selectedRelativePaths),
      commitDraft: state.commitDraft.slice(0, 100_000),
      reviewFindingIds: [...new Set(state.reviewFindingIds)]
        .filter((id) => !/[\0\r\n]/.test(id))
        .slice(0, 1_000)
        .map((id) => id.slice(0, 200)),
      activeChangelist:
        state.activeChangelist && !/[\0\r\n]/.test(state.activeChangelist)
          ? state.activeChangelist.slice(0, 200)
          : undefined,
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    };
    await writeSecureJson(this.path, data);
  }
  async restore(workingCopyPath: string, now = Date.now()): Promise<AiSessionRecoveryState | null> {
    const data = await this.read();
    const key = this.identity(workingCopyPath);
    const state = data.sessions[key];
    if (!state || Date.parse(state.expiresAt) <= now) {
      if (state) {
        delete data.sessions[key];
        await writeSecureJson(this.path, data);
      }
      return null;
    }
    return sanitizeState(state);
  }
  async clear(workingCopyPath?: string): Promise<void> {
    if (!workingCopyPath) {
      await writeSecureJson(this.path, { version: 1, sessions: {} });
      return;
    }
    const data = await this.read();
    delete data.sessions[this.identity(workingCopyPath)];
    await writeSecureJson(this.path, data);
  }
}
