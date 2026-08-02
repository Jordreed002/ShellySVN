import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('packaged app smoke workflow', () => {
  it('runs packaged smoke tests for release-supported desktop targets', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain('darwin-${{ matrix.arch }}');
    expect(workflow).toContain('"$app_path/Contents/MacOS/ShellySVN" --smoke-test');
    expect(workflow).toContain('ShellySVN.exe');
    expect(workflow).toContain('& $app.FullName --smoke-test');
    expect(workflow).toContain('xvfb-run -a "$app_path" --smoke-test --no-sandbox');
    expect(workflow).toContain("require('./package.json').version");
    expect(workflow).toContain('Packaged app version did not match package.json version');
    expect(workflow).toContain('linux-x64');
  });
});
