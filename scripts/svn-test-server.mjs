#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const action = process.argv[2] ?? 'status';
const port = Number.parseInt(process.env.SHELLYSVN_TEST_SERVER_PORT ?? '36990', 10);
const username = process.env.SHELLYSVN_TEST_SERVER_USERNAME ?? 'shellysvn';
const password = process.env.SHELLYSVN_TEST_SERVER_PASSWORD ?? 'release-test';
const secondUsername = process.env.SHELLYSVN_TEST_SERVER_SECOND_USERNAME ?? 'reviewer';
const secondPassword = process.env.SHELLYSVN_TEST_SERVER_SECOND_PASSWORD ?? 'review-test';
const workspaceKey = createHash('sha256').update(resolve('.')).digest('hex').slice(0, 12);
const labRoot = join(tmpdir(), `shellysvn-test-server-${workspaceKey}`);
const repositoryPath = join(labRoot, 'repo');
const statePath = join(labRoot, 'server.json');
const logPath = join(labRoot, 'svnserve.log');

function assertSafeLabRoot() {
  const expectedPrefix = join(tmpdir(), 'shellysvn-test-server-');
  if (!labRoot.startsWith(expectedPrefix) || labRoot === tmpdir()) {
    throw new Error(`Refusing to manage unsafe test-server path: ${labRoot}`);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    windowsHide: true,
  });
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readState() {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function serverDetails(pid = undefined) {
  const baseUrl = `svn://127.0.0.1:${port}/repo`;
  return {
    pid,
    port,
    repositoryPath,
    repositoryUrl: baseUrl,
    trunkUrl: `${baseUrl}/trunk`,
    sandboxUrl: `${baseUrl}/sandbox`,
    username,
    password,
    secondUsername,
    secondPassword,
    logPath,
  };
}

function printDetails(details, status) {
  console.log(
    JSON.stringify(
      {
        status,
        ...details,
        appConnection: {
          url: details.trunkUrl,
          username: details.username,
          password: details.password,
        },
      },
      null,
      2
    )
  );
}

async function waitForServer(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolveConnection) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolveConnection(true);
      });
      socket.once('error', () => resolveConnection(false));
      socket.setTimeout(250, () => {
        socket.destroy();
        resolveConnection(false);
      });
    });
    if (connected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`svnserve did not become ready on 127.0.0.1:${port}`);
}

function configureRepository() {
  mkdirSync(labRoot, { recursive: true, mode: 0o700 });
  if (!existsSync(repositoryPath)) {
    run(process.env.SVNADMIN_BIN ?? 'svnadmin', ['create', repositoryPath]);
  }

  writeFileSync(
    join(repositoryPath, 'conf', 'svnserve.conf'),
    [
      '[general]',
      'anon-access = none',
      'auth-access = write',
      'password-db = passwd',
      'authz-db = authz',
      'realm = ShellySVN compatibility lab',
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  writeFileSync(
    join(repositoryPath, 'conf', 'passwd'),
    ['[users]', `${username} = ${password}`, `${secondUsername} = ${secondPassword}`, ''].join(
      '\n'
    ),
    { mode: 0o600 }
  );
  writeFileSync(
    join(repositoryPath, 'conf', 'authz'),
    ['[/]', `@writers = rw`, '', '[groups]', `writers = ${username}, ${secondUsername}`, ''].join(
      '\n'
    ),
    { mode: 0o600 }
  );

  const revpropHook =
    process.platform === 'win32'
      ? join(repositoryPath, 'hooks', 'pre-revprop-change.bat')
      : join(repositoryPath, 'hooks', 'pre-revprop-change');
  writeFileSync(
    revpropHook,
    process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
    { mode: 0o700 }
  );
  if (process.platform !== 'win32') chmodSync(revpropHook, 0o700);
}

function seedRepositoryIfNeeded() {
  const svn = process.env.SVN_BIN ?? 'svn';
  const repositoryUrl = pathToFileURL(repositoryPath).href;
  try {
    run(svn, ['list', `${repositoryUrl}/trunk`]);
    return;
  } catch {
    // A new repository has no standard layout yet.
  }

  run(svn, [
    'mkdir',
    '-m',
    'Create ShellySVN compatibility layout',
    `${repositoryUrl}/trunk`,
    `${repositoryUrl}/branches`,
    `${repositoryUrl}/tags`,
    `${repositoryUrl}/sandbox`,
  ]);

  const seedRoot = join(labRoot, 'seed');
  mkdirSync(join(seedRoot, 'src'), { recursive: true });
  writeFileSync(join(seedRoot, 'README.md'), '# ShellySVN compatibility lab\n', 'utf8');
  writeFileSync(join(seedRoot, 'src', 'app.txt'), 'line one\nline two\n', 'utf8');
  run(svn, ['import', '-m', 'Seed compatibility repository', seedRoot, `${repositoryUrl}/trunk`]);
  rmSync(seedRoot, { recursive: true, force: true });
}

async function startServer() {
  assertSafeLabRoot();
  const existing = readState();
  if (existing && processIsRunning(existing.pid)) {
    printDetails(existing, 'already-running');
    return;
  }

  configureRepository();
  seedRepositoryIfNeeded();
  const logFd = openSync(logPath, 'a', 0o600);
  const child = spawn(
    process.env.SVNSERVE_BIN ?? 'svnserve',
    [
      '--daemon',
      '--foreground',
      '--root',
      labRoot,
      '--listen-host',
      '127.0.0.1',
      '--listen-port',
      String(port),
    ],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    }
  );
  child.unref();
  closeSync(logFd);

  try {
    await waitForServer();
  } catch (error) {
    if (processIsRunning(child.pid)) process.kill(child.pid);
    throw error;
  }

  const details = serverDetails(child.pid);
  writeFileSync(statePath, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 });
  printDetails(details, 'started');
}

function stopServer() {
  const state = readState();
  if (!state || !processIsRunning(state.pid)) {
    printDetails(state ?? serverDetails(), 'stopped');
    return;
  }
  process.kill(state.pid);
  printDetails(state, 'stopped');
}

function showStatus() {
  const state = readState();
  const running = state ? processIsRunning(state.pid) : false;
  printDetails(state ?? serverDetails(), running ? 'running' : 'stopped');
  if (!running) process.exitCode = 1;
}

function resetServer() {
  assertSafeLabRoot();
  stopServer();
  if (existsSync(labRoot)) rmSync(labRoot, { recursive: true, force: true });
  printDetails(serverDetails(), 'reset');
}

switch (action) {
  case 'start':
    await startServer();
    break;
  case 'stop':
    stopServer();
    break;
  case 'status':
    showStatus();
    break;
  case 'reset':
    resetServer();
    break;
  default:
    throw new Error('Usage: svn-test-server.mjs <start|stop|status|reset>');
}
