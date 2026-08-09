import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';
import {
  previewRepositoryAiProfileImport,
  RepositoryAiProfileStore,
  draftTransformationInstruction,
  isPathExcludedByRepositoryProfile,
} from '../ai-repository-profile';

describe('RepositoryAiProfileStore', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shelly-profile-'));
    clearApprovedPathsForTests();
    approvePathForIpc(directory);
  });
  afterEach(async () => {
    clearApprovedPathsForTests();
    await rm(directory, { recursive: true, force: true });
  });

  it('previews an explicit import and drops unsafe path patterns', () => {
    const preview = previewRepositoryAiProfileImport(
      JSON.stringify({
        commitPrefixes: ['fix', 'fix'],
        testPaths: ['tests/**', '../outside', '/absolute'],
        subjectMaxLength: 500,
      })
    );
    expect(preview.valid).toBe(true);
    expect(preview.profile?.commitPrefixes).toEqual(['fix']);
    expect(preview.profile?.testPaths).toEqual(['tests/**']);
    expect(preview.profile?.subjectMaxLength).toBe(120);
    expect(preview.warnings).toHaveLength(2);
  });

  it('maps only enumerated draft transformations to fixed local instructions', () => {
    expect(draftTransformationInstruction('shorter')).toMatch(/shorter/);
    expect(() => draftTransformationInstruction('arbitrary renderer prompt' as never)).toThrow(
      /Unsupported/
    );
  });

  it('matches only sanitized repository-relative excluded path globs', () => {
    const profile = previewRepositoryAiProfileImport(
      JSON.stringify({ excludedPaths: ['vendor/**', 'dist/*.js'] })
    ).profile!;
    expect(isPathExcludedByRepositoryProfile('vendor/pkg/index.ts', profile)).toBe(true);
    expect(isPathExcludedByRepositoryProfile('dist/app.js', profile)).toBe(true);
    expect(isPathExcludedByRepositoryProfile('src/app.ts', profile)).toBe(false);
  });

  it('keys profiles by canonical identity without persisting the working-copy path', async () => {
    const store = new RepositoryAiProfileStore(directory);
    const preview = previewRepositoryAiProfileImport('{"documentationPaths":["docs/**"]}');
    await store.save(directory, preview.profile!);
    expect((await store.get(directory))?.documentationPaths).toEqual(['docs/**']);
    expect(await readFile(join(directory, 'ai-repository-profiles.json'), 'utf8')).not.toContain(
      directory
    );
  });

  it('rejects unapproved working copies', async () => {
    clearApprovedPathsForTests();
    await expect(new RepositoryAiProfileStore(directory).get(directory)).rejects.toThrow(
      /selected through ShellySVN/
    );
  });
});
