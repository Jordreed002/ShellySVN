// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shell/Finder package verification script', () => {
  it('checks Windows and macOS release targets for native helper artifacts', () => {
    const source = readFileSync(
      join(process.cwd(), 'scripts/verify-shell-integration-package.mjs'),
      'utf8'
    );

    expect(source).toContain("'win32-x64'");
    expect(source).toContain("'darwin-x64'");
    expect(source).toContain("'darwin-arm64'");
    expect(source).toContain('ShellySVNShellHelper.exe');
    expect(source).toContain('ShellySVNFinderSync');
    expect(source).toContain('process.exit(1)');
  });
});
