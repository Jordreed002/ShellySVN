import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';
import { AiSessionRecoveryStore } from './support/ai-session-recovery';

describe('AiSessionRecoveryStore', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shelly-recovery-'));
    clearApprovedPathsForTests();
    approvePathForIpc(directory);
  });
  afterEach(async () => {
    clearApprovedPathsForTests();
    await rm(directory, { recursive: true, force: true });
  });

  it('stores only bounded recovery fields and repository-relative selected paths', async () => {
    const store = new AiSessionRecoveryStore(directory, 1_000);
    await store.save(
      directory,
      {
        selectedRelativePaths: ['src/a.ts', '../escape', '/absolute'],
        commitDraft: 'Draft',
        reviewFindingIds: ['finding-1'],
      },
      100
    );
    expect(await store.restore(directory, 200)).toMatchObject({
      selectedRelativePaths: ['src/a.ts'],
      commitDraft: 'Draft',
      reviewFindingIds: ['finding-1'],
    });
    const persisted = await readFile(join(directory, 'ai-session-recovery.json'), 'utf8');
    expect(persisted).not.toContain(directory);
    expect(persisted).not.toContain('escape');
  });

  it('expires and removes stale recovery state', async () => {
    const store = new AiSessionRecoveryStore(directory, 10);
    await store.save(
      directory,
      { selectedRelativePaths: [], commitDraft: '', reviewFindingIds: [] },
      100
    );
    expect(await store.restore(directory, 111)).toBeNull();
  });
});
