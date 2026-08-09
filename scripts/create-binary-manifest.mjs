#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = process.argv[2] || `${process.platform}-${process.arch}`;
const windows = target.startsWith('win32-');
const root = resolve('binaries', target);
const engineName = windows ? 'shelly-engine.exe' : 'shelly-engine';
const svnName = windows ? 'svn.exe' : 'svn';
const entries = {
  engine: join(root, engineName),
  svn: join(root, 'svn', svnName),
};

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function executableVersion(path, args, label) {
  const result = spawnSync(path, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} cannot be executed while creating its package manifest.`);
  }
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim().split(/\r?\n/, 1)[0];
}

for (const [label, path] of Object.entries(entries)) {
  if (!statSync(path).isFile()) throw new Error(`${label} is not a file: ${path}`);
}

const manifest = {
  schemaVersion: 1,
  target,
  generatedAt: new Date().toISOString(),
  files: {
    engine: {
      path: engineName,
      sha256: sha256(entries.engine),
      version: executableVersion(entries.engine, ['--version'], 'logic engine'),
    },
    svn: {
      path: `svn/${svnName}`,
      sha256: sha256(entries.svn),
      version: executableVersion(entries.svn, ['--version', '--quiet'], 'SVN client'),
    },
  },
};

if (!/^1\.14\.\d+$/.test(manifest.files.svn.version)) {
  throw new Error(
    `SVN reported ${manifest.files.svn.version}; expected the supported 1.14.x series.`
  );
}

const output = join(root, 'binary-manifest.json');
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Created ${output} for SVN ${manifest.files.svn.version}.`);
