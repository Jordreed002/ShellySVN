import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'packages', 'tests'];
const BASELINE_SKIPS = 28;
const SKIP_PATTERN = /\b(?:describe|it|test)\.skip\b/g;
const APPROVED_SKIP_COUNTS = new Map([
  ['src/main/__tests__/auth-cache.test.ts', 3],
  ['src/main/ipc/__tests__/external.test.ts', 1],
  ['src/main/services/__tests__/svn-release-workflows.real.test.ts', 1],
  ['src/main/services/__tests__/svn-working-copy.real.test.ts', 1],
  ['src/main/utils/__tests__/validation.test.ts', 4],
  ['src/renderer/__tests__/CheckoutDialog.sparse.test.tsx', 2],
  ['src/renderer/__tests__/ChooseItemsDialog.test.tsx', 1],
  ['src/renderer/__tests__/ProgressIndicator.test.tsx', 2],
  ['src/renderer/__tests__/RepoBrowser.add-to-wc.test.tsx', 1],
  ['src/renderer/__tests__/UpdateToRevisionDialog.sparse.test.tsx', 3],
  ['src/renderer/__tests__/integration/sparse-checkout.test.tsx', 1],
  ['src/renderer/src/hooks/__tests__/useCommitMessageHistory.test.ts', 2],
  ['tests/e2e/conflict-resolution.spec.ts', 1],
  ['tests/e2e/file-operations.spec.ts', 3],
  ['tests/e2e/keyboard-interactions.spec.ts', 2],
  ['tests/e2e/macos-integrations.spec.ts', 1],
  ['tests/e2e/svn-operations.spec.ts', 2],
]);

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
const countsByFile = new Map();

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const count = line.match(SKIP_PATTERN)?.length ?? 0;
      for (let i = 0; i < count; i++) {
        matches.push(`${file}:${index + 1}`);
      }
      if (count > 0) {
        const normalizedFile = file.replaceAll('\\', '/');
        countsByFile.set(normalizedFile, (countsByFile.get(normalizedFile) ?? 0) + count);
      }
    });
  }
}

const inventoryViolations = [];
for (const [file, count] of countsByFile) {
  const approved = APPROVED_SKIP_COUNTS.get(file) ?? 0;
  if (count > approved) {
    inventoryViolations.push(`${file}: ${count} skips found, ${approved} approved`);
  }
}

if (inventoryViolations.length > 0) {
  console.error(
    'Skipped tests were added outside the approved triage inventory in .spec/skipped-tests.md.'
  );
  console.error('Update the task/issue inventory before adding skips.');
  console.error(inventoryViolations.join('\n'));
  process.exit(1);
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
