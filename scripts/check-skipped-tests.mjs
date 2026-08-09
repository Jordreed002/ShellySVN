import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'packages', 'tests'];
const TEST_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_PATTERN = /\b(?:describe|suite|it|test)\.(skipIf|runIf|skip)\b/g;

// This is intentionally an exact inventory. Removing a skip is good, but its inventory entry must
// be removed in the same change so .spec/skipped-tests.md cannot drift from the executable guard.
const APPROVED_INVENTORY = new Map([
  ['src/integration/__tests__/svn-restore-excluded.real.test.ts', { runIf: 1 }],
  ['src/main/ipc/__tests__/fs.test.ts', { skipIf: 1 }],
  ['src/main/services/__tests__/code-editors.macos.test.ts', { skipIf: 1 }],
  ['src/main/services/__tests__/code-editors.test.ts', { skipIf: 2 }],
  ['src/main/services/__tests__/external-tool-registry.macos.test.ts', { skipIf: 1 }],
  ['src/main/services/__tests__/svn-release-workflows.real.test.ts', { skip: 1, skipIf: 2 }],
  ['src/main/services/__tests__/svn-working-copy.real.test.ts', { skip: 1, skipIf: 1 }],
  ['src/main/utils/__tests__/approved-paths.test.ts', { skipIf: 1 }],
  ['src/main/utils/__tests__/process-tree.test.ts', { skipIf: 1 }],
  ['tests/e2e/conflict-resolution.spec.ts', { skip: 1 }],
  ['tests/e2e/file-operations.spec.ts', { skip: 3 }],
  ['tests/e2e/macos-integrations.spec.ts', { skip: 1 }],
  ['tests/e2e/svn-operations.spec.ts', { skip: 2 }],
]);

function walk(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      files.push(...walk(path));
    } else if (TEST_EXTENSIONS.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

function emptyCounts() {
  return { skip: 0, skipIf: 0, runIf: 0 };
}

function normalizeCounts(counts = {}) {
  return {
    skip: counts.skip ?? 0,
    skipIf: counts.skipIf ?? 0,
    runIf: counts.runIf ?? 0,
  };
}

function describeCounts(counts) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ');
}

const foundInventory = new Map();
const locations = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const normalizedFile = file.replaceAll('\\', '/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      SKIP_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(SKIP_PATTERN)) {
        const kind = match[1];
        const counts = foundInventory.get(normalizedFile) ?? emptyCounts();
        counts[kind]++;
        foundInventory.set(normalizedFile, counts);
        locations.push(`${normalizedFile}:${index + 1} (${kind})`);
      }
    });
  }
}

const violations = [];
const inventoriedFiles = new Set([...APPROVED_INVENTORY.keys(), ...foundInventory.keys()]);

for (const file of [...inventoriedFiles].toSorted()) {
  const approved = normalizeCounts(APPROVED_INVENTORY.get(file));
  const found = normalizeCounts(foundInventory.get(file));
  if (
    approved.skip !== found.skip ||
    approved.skipIf !== found.skipIf ||
    approved.runIf !== found.runIf
  ) {
    violations.push(
      `${file}: found ${describeCounts(found) || 'no skips'}; ` +
        `inventory requires ${describeCounts(approved) || 'no skips'}`
    );
  }
}

if (violations.length > 0) {
  console.error('Skipped-test usage does not match the exact inventory in .spec/skipped-tests.md.');
  console.error('Triage the test and update the executable and documented inventories together.');
  console.error(violations.join('\n'));
  if (locations.length > 0) {
    console.error('\nDetected skip locations:');
    console.error(locations.join('\n'));
  }
  process.exit(1);
}

const totals = [...foundInventory.values()].reduce(
  (result, counts) => ({
    skip: result.skip + counts.skip,
    skipIf: result.skipIf + counts.skipIf,
    runIf: result.runIf + counts.runIf,
  }),
  emptyCounts()
);

console.log(
  `Skipped-test inventory verified: ${totals.skip} direct .skip, ` +
    `${totals.skipIf} skipIf, ${totals.runIf} runIf.`
);
