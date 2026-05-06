// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkerPool } from '../WorkerPool';
import type { StatusPayload } from '../types';

let tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'shellysvn-svn-worker-test-'));
  tempDirs.push(dir);
  return dir;
}

async function createFakeSvnCommand(scriptBody: string): Promise<string> {
  const dir = await createTempDir();
  const scriptPath = join(dir, 'fake-svn.cjs');
  await writeFile(scriptPath, scriptBody);

  if (process.platform === 'win32') {
    const commandPath = join(dir, 'fake-svn.cmd');
    await writeFile(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0fake-svn.cjs" %*\r\n`);
    return commandPath;
  }

  const commandPath = join(dir, 'fake-svn');
  await writeFile(commandPath, `#!/bin/sh\nexec "${process.execPath}" "$0.cjs" "$@"\n`);
  await chmod(commandPath, 0o755);
  return commandPath;
}

function makeStatusPayload(dirPath: string, svnCommand: string): StatusPayload {
  return {
    dirPath,
    svnCommand,
    context: {
      proxySettings: { enabled: false },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
      svnConfigPath: '',
    },
  };
}

afterEach(async () => {
  const dirs = tempDirs;
  tempDirs = [];
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('svn worker', () => {
  it('returns the expected filesystem status shape from the actual worker script', async () => {
    const workingCopy = await createTempDir();
    const changedPath = join(workingCopy, 'changed.txt');
    const svnCommand = await createFakeSvnCommand(`
process.stdout.write(${JSON.stringify(`<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="${workingCopy}">
    <entry path="${changedPath}">
      <wc-status item="modified" revision="12">
        <commit revision="34">
          <author>alice</author>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`)});
`);
    const pool = new WorkerPool({ maxWorkers: 1 });

    try {
      await expect(
        pool.run('svn:fsStatus', makeStatusPayload(workingCopy, svnCommand), {
          id: 'actual-worker-status-shape',
        })
      ).resolves.toEqual({
        directStatus: {
          [basename(changedPath)]: {
            status: 'M',
            revision: 34,
            author: 'alice',
          },
        },
        allEntries: [
          {
            status: 'M',
            revision: 34,
            author: 'alice',
            fullPath: changedPath,
          },
        ],
      });
    } finally {
      await pool.shutdown();
    }
  });

  it('redacts secret values from actual worker command failures', async () => {
    const workingCopy = await createTempDir();
    const svnCommand = await createFakeSvnCommand(`
process.stderr.write('svn failed password=hunter2 token=abc123\\n');
process.exit(1);
`);
    const pool = new WorkerPool({ maxWorkers: 1 });

    try {
      let error: Error | null = null;
      try {
        await pool.run('svn:fsStatus', makeStatusPayload(workingCopy, svnCommand), {
          id: 'actual-worker-redaction',
        });
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }

      expect(error?.message).toContain('password=[REDACTED]');
      expect(error?.message).toContain('token=[REDACTED]');
      expect(error?.message).not.toContain('hunter2');
      expect(error?.message).not.toContain('abc123');
    } finally {
      await pool.shutdown();
    }
  });
});
