import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('compiled binary smoke verification', () => {
  it('covers every release target and executes both bundled binaries', () => {
    const verifier = readFileSync(join(process.cwd(), 'scripts/verify-binaries.mjs'), 'utf8');

    for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64']) {
      expect(verifier).toContain(`'${target}'`);
    }

    expect(verifier).toContain("verifyExecutable(enginePath, ['--version']");
    expect(verifier).toContain('verifySvnVersion(svnVersion');
    expect(verifier).toContain("const EXPECTED_SVN_SERIES = '1.14'");
    expect(verifier).toContain("args.includes('all')");
  });
});
