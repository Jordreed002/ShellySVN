import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

describe('trusted release workflow', () => {
  it('rejects a tag that differs from the committed package version', () => {
    const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
    const current = spawnSync(process.execPath, [
      'scripts/validate-release-version.mjs',
      `v${packageVersion}`,
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

    expect(builder).toContain('target: zip');
    expect(workflow).toContain('- arch: x64');
    expect(workflow).toContain('- arch: arm64');
    expect(builder).toContain('target: AppImage');
    expect(builder).toContain('target: nsis');
    expect(workflow).toContain('Missing public-release signing configuration');
    expect(workflow).toContain('scripts/merge-mac-update-metadata.mjs');
    expect(workflow).toContain('scripts/validate-release-assets.mjs');
    expect(workflow).toContain('Clean-machine smoke test Windows installer');
    expect(workflow).toContain('Clean-machine smoke test Debian package');
    expect(workflow).toContain('verify:packaged-app');
    expect(workflow).toContain('Get-AuthenticodeSignature');
    expect(workflow).toContain('--config.mac.notarize=true');
    expect(workflow).toContain('xcrun stapler validate');
    expect(workflow).toContain('scripts/create-release-checksums.mjs');
    expect(workflow).toContain('scripts/validate-release-channel.mjs');
    expect(workflow).toContain('Verify in-place upgrade from prior release');
    expect(workflow).toContain('draft: false');
  });

  it('maps each macOS package to binaries built for the same architecture', () => {
    const builder = parse(readFileSync('electron-builder.yml', 'utf8')) as {
      mac?: {
        extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
        target?: Array<string | { arch?: string[]; target?: string }>;
      };
    };
    const mac = builder.mac;
    const resources = mac?.extraResources ?? [];

    // Targets must not pin an arch list: electron-builder would then package
    // both flavors in every CI job, and the job without that architecture's
    // binaries would emit a broken app. The workflow's --x64/--arm64 flag
    // selects exactly one architecture per job instead.
    for (const target of mac?.target ?? []) {
      expect(typeof target === 'string' || target.arch === undefined).toBe(true);
      if (typeof target !== 'string') {
        expect(['dmg', 'zip']).toContain(target.target);
      }
    }
    expect(resources).toEqual([
      {
        from: 'binaries/darwin-${arch}',
        to: 'binaries',
        filter: ['shelly-engine', 'binary-manifest.json', 'svn/**/*'],
      },
    ]);

    for (const arch of ['x64', 'arm64']) {
      const source = resources[0]?.from?.replace('${arch}', arch);
      expect(source).toBe(`binaries/darwin-${arch}`);
      expect(source).not.toContain(arch === 'x64' ? 'arm64' : 'x64');
    }
  });

  it('packages and verifies a checksum manifest for the exact SVN_BIN', () => {
    const builder = readFileSync('electron-builder.yml', 'utf8');
    const manifestScript = readFileSync('scripts/create-binary-manifest.mjs', 'utf8');
    const packagedVerifier = readFileSync('scripts/verify-packaged-app.mjs', 'utf8');

    expect(builder.match(/binary-manifest\.json/g)).toHaveLength(3);
    expect(manifestScript).toContain("['--version', '--quiet']");
    expect(manifestScript).toContain("createHash('sha256')");
    expect(packagedVerifier).toContain("join(resourcesRoot, 'binaries')");
    expect(packagedVerifier).toContain("spawnSync(svnPath, ['--version', '--quiet']");
    expect(packagedVerifier).toContain('SHA-256 does not match its build manifest');
  });
});
