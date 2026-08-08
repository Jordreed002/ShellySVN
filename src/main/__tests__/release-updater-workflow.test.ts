import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('trusted release workflow', () => {
  it('rejects a tag that differs from the committed package version', () => {
    const current = spawnSync(process.execPath, [
      'scripts/validate-release-version.mjs',
      'v1.1.0-beta.2',
    ]);
    const mismatch = spawnSync(process.execPath, [
      'scripts/validate-release-version.mjs',
      'v1.1.0',
    ]);
    const invalidSemver = spawnSync(process.execPath, [
      'scripts/validate-release-version.mjs',
      'v1.1.0-beta.02',
    ]);

    expect(current.status).toBe(0);
    expect(mismatch.status).not.toBe(0);
    expect(invalidSemver.status).not.toBe(0);
    expect(mismatch.stderr.toString()).toContain('does not match package.json version');
  });

  it('packages every self-update target and gates public signing', () => {
    const builder = readFileSync('electron-builder.yml', 'utf8');
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(builder).toContain('- zip');
    expect(workflow).toContain('- arch: x64');
    expect(workflow).toContain('- arch: arm64');
    expect(builder).toContain('target: AppImage');
    expect(builder).toContain('target: nsis');
    expect(workflow).toContain('Missing public-release signing configuration');
    expect(workflow).toContain('scripts/merge-mac-update-metadata.mjs');
    expect(workflow).toContain('scripts/validate-release-assets.mjs');
    expect(workflow).toContain('draft: false');
  });
});
