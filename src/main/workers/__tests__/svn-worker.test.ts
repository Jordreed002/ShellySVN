// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkerPool } from '../WorkerPool';
import type { LogPayload, StatusPayload } from '../types';

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
      proxySettings: {
        enabled: false,
        host: '',
        port: 0,
        username: '',
        password: '',
        bypassForLocal: true,
      },
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

  it('builds advanced log arguments and preserves custom revision properties', async () => {
    const workingCopy = await createTempDir();
    const expectedArgs = [
      'log',
      '--xml',
      '-v',
      '-l',
      '25',
      '-r',
      '10:20',
      '--use-merge-history',
      '--stop-on-copy',
      '--strict',
      '--with-revprop',
      'review:status',
      workingCopy,
      '--non-interactive',
    ];
    const svnCommand = await createFakeSvnCommand(`
const actual = process.argv.slice(2);
const expected = ${JSON.stringify(expectedArgs)};
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  process.stderr.write('Unexpected arguments: ' + JSON.stringify(actual));
  process.exit(2);
}
process.stdout.write(${JSON.stringify(`<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="20">
    <author>alice</author>
    <date>2026-07-23T10:00:00.000000Z</date>
    <msg>Reviewed change</msg>
    <revprops><property name="review:status">approved</property></revprops>
  </logentry>
</log>`)});
`);
    const payload: LogPayload = {
      path: workingCopy,
      limit: 25,
      startRev: 10,
      endRev: 20,
      useMergeHistory: true,
      stopOnCopy: true,
      strictNodeHistory: true,
      revisionProperties: ['review:status'],
      svnCommand,
      context: {
        proxySettings: {
          enabled: false,
          host: '',
          port: 0,
          username: '',
          password: '',
          bypassForLocal: true,
        },
        connectionTimeout: 0,
        sslVerify: true,
        clientCertificatePath: '',
        svnConfigPath: '',
      },
    };
    const pool = new WorkerPool({ maxWorkers: 1 });

    try {
      const result = await pool.run('svn:log', payload, { id: 'advanced-log-options' });
      expect(result).toEqual(
        expect.objectContaining({
          entries: [
            expect.objectContaining({
              revision: 20,
              revisionProperties: { 'review:status': 'approved' },
            }),
          ],
        })
      );
    } finally {
      await pool.shutdown();
    }
  });
});
