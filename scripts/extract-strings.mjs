#!/usr/bin/env node
/**
 * i18n string extraction pipeline (#134 / Track A item 8).
 *
 * Walks the renderer source tree, feeds every file to the PURE extractor in
 * `src/renderer/src/i18n/extract.ts` (see its header for the heuristics and
 * the deterministic output contract its unit tests pin), and writes the
 * POT-like JSON catalog to `src/renderer/src/i18n/extracted.json`.
 *
 * Usage:
 *   bun run i18n:extract        regenerate the catalog (in-place write)
 *   bun run check:i18n          drift gate: exit 1 when the catalog is stale
 *
 * Run via bun (npm script does): the script imports the TypeScript extractor
 * directly, which bun resolves natively — no build step, so the catalog can
 * never drift from the extractor implementation being tested in
 * `src/renderer/src/i18n/__tests__/extract.test.ts`.
 */

import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { extractMessages } from '../src/renderer/src/i18n/extract.ts';

const ROOT = join(import.meta.dirname, '..');
const SOURCE_DIR = join(ROOT, 'src', 'renderer', 'src');
const CATALOG_PATH = join(SOURCE_DIR, 'i18n', 'extracted.json');

/** Extractor inputs are JSX-bearing renderer sources; tests and generated code are not UI. */
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['__tests__', 'node_modules']);
const SKIP_FILES = new Set(['routeTree.gen.ts']); // generated (bun run generate:routes)
const SKIP_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

/** Recursive, deterministic (sorted) walk collecting files to scan. */
function walk(dir, acc) {
  for (const entry of readdirSync(dir).toSorted((a, b) => a.localeCompare(b))) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, acc);
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.slice(dot);
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    if (SKIP_FILES.has(entry) || SKIP_SUFFIXES.some((s) => entry.endsWith(s))) continue;
    acc.push(full);
  }
  return acc;
}

/** Repo-relative, forward-slash path — the format occurrences use in the catalog. */
function toRepoPath(absolutePath) {
  return relative(ROOT, absolutePath).split(sep).join('/');
}

function buildCatalog() {
  const sources = walk(SOURCE_DIR, []).map((absolutePath) => ({
    file: toRepoPath(absolutePath),
    content: readFileSync(absolutePath, 'utf8'),
  }));
  // Deterministic serialization: fixed shape, 2-space indent, trailing newline
  // (byte-stable across runs — the extractor itself emits no timestamps).
  return `${JSON.stringify(extractMessages(sources), null, 2)}\n`;
}

/** One-line stats for the console/drift messages. */
function catalogSummary(doc) {
  const parsed = JSON.parse(doc);
  return `${parsed.files.length} files scanned, ${parsed.messages.length} message candidates`;
}

const checkMode = process.argv.includes('--check');
const generated = buildCatalog();

if (checkMode) {
  let current = null;
  try {
    current = readFileSync(CATALOG_PATH, 'utf8');
  } catch {
    // Missing catalog falls through as drift.
  }
  if (current !== generated) {
    const onDisk = current ? catalogSummary(current) : 'missing';
    console.error(
      `[check:i18n] extracted.json is stale (on disk: ${onDisk}; ` +
        `regenerated: ${catalogSummary(generated)}). Run \`bun run i18n:extract\` and commit the catalog.`
    );
    process.exit(1);
  }
  console.log('[check:i18n] extracted.json is up to date.');
} else {
  writeFileSync(CATALOG_PATH, generated);
  console.log(
    `[i18n:extract] wrote ${toRepoPath(CATALOG_PATH)} — ${catalogSummary(generated)}.`
  );
}
