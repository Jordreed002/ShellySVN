#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = {
  'win32-x64': {
    helper: join('resources', 'shell', 'ShellySVNShellHelper.exe'),
    label: 'Windows Explorer shell helper',
  },
  'darwin-x64': {
    helper: join('resources', 'shell', 'ShellySVNFinderSync'),
    label: 'macOS Finder Sync helper',
  },
  'darwin-arm64': {
    helper: join('resources', 'shell', 'ShellySVNFinderSync'),
    label: 'macOS Finder Sync helper',
  },
};

function selectedTargets() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('all')) {
    return Object.keys(TARGETS);
  }
  return args;
}

function artifactRootFor(target) {
  return join(process.cwd(), 'dist', `${target}-unpacked`);
}

const failures = [];

for (const target of selectedTargets()) {
  const definition = TARGETS[target];
  if (!definition) {
    failures.push(`Unsupported shell integration target: ${target}`);
    continue;
  }

  const helperPath = join(artifactRootFor(target), definition.helper);
  if (!existsSync(helperPath)) {
    failures.push(`${definition.label} is missing for ${target}: ${helperPath}`);
    continue;
  }

  const stats = statSync(helperPath);
  if (!stats.isFile()) {
    failures.push(`${definition.label} is not a file for ${target}: ${helperPath}`);
  }
}

if (failures.length > 0) {
  console.error('Shell/Finder package verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Verified shell/Finder package helpers for ${selectedTargets().join(', ')}`);
