#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const resourcesRoot = resolve(process.argv[2] || '');
const expectedTarget = process.argv[3] || `${process.platform}-${process.arch}`;
if (!process.argv[2])
  throw new Error('Usage: verify-packaged-app.mjs <resources-directory> [target]');

const binariesRoot = join(resourcesRoot, 'binaries');
const manifestPath = join(binariesRoot, 'binary-manifest.json');
if (!existsSync(manifestPath))
  throw new Error(`Packaged binary manifest is missing: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.schemaVersion !== 1 || manifest.target !== expectedTarget) {
  throw new Error(
    `Packaged manifest target ${manifest.target || '(missing)'} does not match ${expectedTarget}.`
  );
}

function resolveManifestFile(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
    throw new Error('Packaged manifest contains an invalid path.');
  }
  const path = resolve(binariesRoot, relativePath);
  if (!path.startsWith(`${binariesRoot}${sep}`))
    throw new Error(`Manifest path escapes binaries: ${relativePath}`);
  return path;
}

function verifyEntry(name, entry) {
  const path = resolveManifestFile(entry?.path);
  if (!existsSync(path) || !statSync(path).isFile())
    throw new Error(`Packaged ${name} is missing: ${path}`);
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== entry.sha256)
    throw new Error(`Packaged ${name} SHA-256 does not match its build manifest.`);
  return path;
}

verifyEntry('logic engine', manifest.files?.engine);
const svnPath = verifyEntry('SVN client', manifest.files?.svn);
const svn = spawnSync(svnPath, ['--version', '--quiet'], {
  cwd: dirname(svnPath),
  encoding: 'utf8',
  timeout: 10_000,
  windowsHide: true,
});
if (svn.error || svn.status !== 0) throw new Error('The exact packaged SVN_BIN failed to execute.');
const actualVersion = String(svn.stdout).trim();
if (actualVersion !== manifest.files.svn.version || !/^1\.14\.\d+$/.test(actualVersion)) {
  throw new Error(
    `Packaged SVN reported ${actualVersion || '(empty)'}; manifest declares ${manifest.files.svn.version}.`
  );
}

console.log(`Verified packaged ${expectedTarget} resources and SVN_BIN ${actualVersion}.`);
