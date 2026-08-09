import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const checks = [
  {
    base: 'src/renderer',
    forbidden: [
      /from ['"]@main\//,
      /from ['"]@preload\//,
      /from ['"].*src\/main/,
      /from ['"].*src\/preload/,
    ],
    message: 'renderer code must not import main or preload modules',
  },
  {
    base: 'src/main',
    forbidden: [/from ['"]@renderer\//, /from ['"].*src\/renderer/],
    message: 'main code must not import renderer modules',
  },
  {
    base: 'src/preload',
    forbidden: [/from ['"]@renderer\//, /from ['"]@main\//],
    message: 'preload code must not import renderer or main modules',
  },
];

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const violations = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'build') {
        continue;
      }
      files.push(...(await walk(fullPath)));
    } else if (sourceExtensions.has(fullPath.slice(fullPath.lastIndexOf('.')))) {
      files.push(fullPath);
    }
  }

  return files;
}

for (const check of checks) {
  const files = await walk(join(root, check.base));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const pattern of check.forbidden) {
      if (pattern.test(text)) {
        violations.push(`${relative(root, file).split(sep).join('/')}: ${check.message}`);
        break;
      }
    }
  }
}

try {
  await readFile(join(root, 'packages/logic-engine/src/svn/types.ts'), 'utf8');
  violations.push(
    'packages/logic-engine/src/svn/types.ts: duplicated shared SVN types are not allowed'
  );
} catch {
  // Expected: logic engine uses @shellysvn/shared.
}

if (violations.length > 0) {
  console.error('Architecture boundary violations found:\n');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Architecture boundaries OK');
