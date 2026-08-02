#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baselinePath = resolve(root, 'knip-baseline.json');
const update = process.argv.includes('--update');
const production = process.argv.includes('--production');
const mode = production ? 'production' : 'default';

function issueKeys(report) {
  const keys = [];
  for (const issue of report.issues ?? []) {
    for (const [kind, findings] of Object.entries(issue)) {
      if (kind === 'file' || !Array.isArray(findings)) continue;
      for (const finding of findings) {
        const name = typeof finding === 'string' ? finding : finding?.name;
        if (name) keys.push(`${issue.file}::${kind}::${name}`);
      }
    }
  }
  return [...new Set(keys)].toSorted();
}

const routeGeneration = spawnSync('bun', ['run', 'generate:routes'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});
if (routeGeneration.status !== 0) process.exit(routeGeneration.status ?? 1);

const args = ['knip', '--reporter', 'json'];
if (production) args.push('--production', '--strict');
const result = spawnSync('bunx', args, { cwd: root, encoding: 'utf8' });
if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout || 'Knip did not produce a JSON report.\n');
  process.exit(1);
}

const current = issueKeys(report);
let baseline = { default: [], production: [] };
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  if (!update) {
    console.error('Knip baseline is missing. Run `bun run dead-code:baseline`.');
    process.exit(1);
  }
}

if (update) {
  baseline[mode] = current;
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Updated ${mode} Knip baseline with ${current.length} findings.`);
  process.exit(0);
}

const known = new Set(baseline[mode] ?? []);
const additions = current.filter((key) => !known.has(key));
const removals = (baseline[mode] ?? []).filter((key) => !current.includes(key));

if (removals.length > 0) {
  console.log(`Knip found ${removals.length} resolved baseline finding(s).`);
  console.log('Run `bun run dead-code:baseline` to shrink the checked-in baseline.');
}

if (additions.length > 0) {
  console.error(`Knip found ${additions.length} new ${mode} finding(s):`);
  for (const key of additions) {
    console.error(`- ${key}`);
    if (process.env.GITHUB_ACTIONS === 'true') {
      const [file, kind, name] = key.split('::');
      console.log(`::error file=${file},title=New Knip ${kind} finding::${name}`);
    }
  }
  process.exit(1);
}

console.log(`Knip ${mode} check passed (${current.length} known findings, no new findings).`);
