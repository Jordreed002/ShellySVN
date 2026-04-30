import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI parser boundary', () => {
  it('keeps shellysvn-cli as a thin shelly-engine JSON client instead of duplicating SVN parsers', () => {
    const cliSource = readFileSync(join(process.cwd(), 'src/main/cli.ts'), 'utf8');

    expect(cliSource).toContain("const engineArgs = ['svn', command]");
    expect(cliSource).toContain('const data = JSON.parse(output)');
    expect(cliSource).not.toContain('fast-xml-parser');
    expect(cliSource).not.toMatch(/parseSvn(Status|Info|Log|Diff|List|Blame)/);
  });
});
