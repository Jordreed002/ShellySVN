#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const MIN_BINARY_SIZE_BYTES = 1024;
const EXPECTED_SVN_SERIES = '1.14';

const PLATFORM_TARGETS = {
  'win32-x64': {
    engine: 'shelly-engine.exe',
    svn: join('svn', 'svn.exe'),
  },
  'darwin-x64': {
    engine: 'shelly-engine',
    svn: join('svn', 'svn'),
  },
  'darwin-arm64': {
    engine: 'shelly-engine',
    svn: join('svn', 'svn'),
  },
  'linux-x64': {
    engine: 'shelly-engine',
    svn: join('svn', 'svn'),
  },
};

function currentTarget() {
  return `${process.platform}-${process.arch}`;
}

function selectedTargets() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('current')) {
    return [currentTarget()];
  }
  if (args.includes('all')) {
    return Object.keys(PLATFORM_TARGETS);
  }

  return args;
}

function verifyFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`);
  }
  if (stats.size < MIN_BINARY_SIZE_BYTES) {
    throw new Error(
      `${label} is too small (${stats.size} bytes). Replace placeholder binaries before packaging.`
    );
  }
}

function verifyExecutable(filePath, args, label) {
  const result = spawnSync(filePath, args, {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${label} failed to execute: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} version check failed with exit ${result.status}: ${output}`);
  }
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function verifySvnVersion(output, label) {
  const version = output.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!new RegExp(`^${EXPECTED_SVN_SERIES.replace('.', '\\.')}\\.\\d+$`).test(version)) {
    throw new Error(
      `${label} reported ${version || 'no version'}; expected SVN ${EXPECTED_SVN_SERIES}.x.`
    );
  }
}

const failures = [];

for (const target of selectedTargets()) {
  const definition = PLATFORM_TARGETS[target];
  if (!definition) {
    failures.push(`Unsupported binary target: ${target}`);
    continue;
  }

  const baseDir = join(process.cwd(), 'binaries', target);
  const enginePath = join(baseDir, definition.engine);
  const svnPath = join(baseDir, definition.svn);

  try {
    verifyFile(enginePath, `${target} logic engine`);
    verifyFile(svnPath, `${target} SVN client`);
    verifyExecutable(enginePath, ['--version'], `${target} logic engine`);
    const svnVersion = verifyExecutable(svnPath, ['--version', '--quiet'], `${target} SVN client`);
    verifySvnVersion(svnVersion, `${target} SVN client`);
    console.log(`Verified packaged binaries for ${target}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

if (failures.length > 0) {
  console.error('Packaged binary verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
