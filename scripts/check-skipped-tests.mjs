import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'packages', 'tests'];
const BASELINE_SKIPS = 27;
const SKIP_PATTERN = /\b(?:describe|it|test)\.skip\b/g;

function walk(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      files.push(...walk(path));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

const matches = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const count = line.match(SKIP_PATTERN)?.length ?? 0;
      for (let i = 0; i < count; i++) {
        matches.push(`${file}:${index + 1}`);
      }
    });
  }
}

if (matches.length > BASELINE_SKIPS) {
  console.error(
    `Skipped test count increased from ${BASELINE_SKIPS} to ${matches.length}. ` +
      'Triage or unskip tests instead of adding more skips.'
  );
  console.error(matches.join('\n'));
  process.exit(1);
}

console.log(`Skipped test count: ${matches.length}/${BASELINE_SKIPS}`);
