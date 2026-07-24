#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const composeFile = 'tests/fixtures/svn-compat-server/compose.yml';
const username = process.env.SHELLYSVN_PROTOCOL_USERNAME ?? 'shellysvn';
const password = process.env.SHELLYSVN_PROTOCOL_PASSWORD ?? 'release-test';
const svnPort = process.env.SHELLYSVN_SVN_PORT ?? '36990';
const httpPort = process.env.SHELLYSVN_HTTP_PORT ?? '18080';
const httpsPort = process.env.SHELLYSVN_HTTPS_PORT ?? '18443';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
    env: options.env ?? process.env,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  }
}

run('docker', ['compose', '-f', composeFile, 'up', '-d', '--build', '--wait']);

run(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    'exec',
    'vitest',
    'run',
    'src/main/services/__tests__/svn-release-workflows.real.test.ts',
    '-t',
    'Docker SVN compatibility lab|CI-provisioned authenticated HTTP',
  ],
  {
    env: {
      ...process.env,
      SHELLYSVN_DOCKER_SVN_TEST_URL: `svn://127.0.0.1:${svnPort}/repo/sandbox`,
      SHELLYSVN_HTTP_TEST_URL: `http://127.0.0.1:${httpPort}/svn/trunk`,
      SHELLYSVN_HTTPS_TEST_URL: `https://127.0.0.1:${httpsPort}/svn/trunk`,
      SHELLYSVN_PROTOCOL_USERNAME: username,
      SHELLYSVN_PROTOCOL_PASSWORD: password,
    },
  }
);

console.log('SVN Docker compatibility lab verification passed.');
