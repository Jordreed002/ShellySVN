#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOTS = ['src/renderer', 'src/preload'];
const SOURCE_EXTENSIONS = new Set(['.css', '.html', '.ts', '.tsx']);
const REMOTE_ASSET_PATTERNS = [
  /@import\s+(?:url\()?['"]?https?:\/\//i,
  /(?:src|href)=["']https?:\/\//i,
  /url\(["']?https?:\/\//i,
  /\bfonts\.googleapis\.com\b/i,
  /\bfonts\.gstatic\.com\b/i,
  /\b(?:cdn|unpkg|jsdelivr)\.[\w.-]+\b/i,
];

function walk(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue;
      files.push(...walk(fullPath));
      continue;
    }

    const ext = fullPath.slice(fullPath.lastIndexOf('.'));
    if (SOURCE_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

const violations = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (file.includes(`${sep}__tests__${sep}`)) continue;

    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (REMOTE_ASSET_PATTERNS.some((pattern) => pattern.test(line))) {
        violations.push(`${relative(process.cwd(), file).split(sep).join('/')}:${index + 1}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Remote asset dependencies found in renderer/preload production code:');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Remote asset dependency check OK');
