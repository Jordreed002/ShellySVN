/**
 * Onboarding playground (#88 backend): `svn:createSampleRepository`.
 *
 * Creates a throwaway local repository under the app's user-data directory
 * (overridable via SHELLYSVN_SAMPLE_REPO_PATH for tests), seeds it with a
 * representative trunk/branches/tags layout and a handful of commits so the
 * log, revision graph and blame views all have real content to show, and
 * returns the `file://` trunk URL for the existing checkout flow.
 *
 * `svnadmin` is resolved next to the configured `svn` client (same directory,
 * same extension), falling back to PATH lookup — the same companion-binary
 * convention as `svnmucc`.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { SampleRepositoryResult } from '@shared/types';
import { app } from 'electron';

import { joinRepoUrl } from '../utils/svn-url';
import { withSvnTargets } from '../utils/svn-targets';
import { resolveSvnExecution, runSvnText } from './svn-executor';

const execFileAsync = promisify(execFile);

export const SAMPLE_REPOSITORY_DIR_NAME = 'sample-repository';

const SVNADMIN_TIMEOUT_MS = 120_000;

/**
 * Seed tree committed as the initial trunk import — small, text-only, and
 * spread over multiple files so blame shows per-line attribution after the
 * follow-up commits.
 */
export const SAMPLE_TREE: Readonly<Record<string, string>> = {
  'README.md': [
    '# ShellySVN sample project',
    '',
    'A throwaway project for exploring log, blame and the revision graph.',
    'Edit anything here — the whole repository exists to be experimented on.',
    '',
  ].join('\n'),
  'src/main.c': [
    '#include <stdio.h>',
    '',
    '#include "util.h"',
    '',
    'int main(void) {',
    '    printf("hello, sample repository\\n");',
    '    return 0;',
    '}',
    '',
  ].join('\n'),
  'src/util.h': ['#ifndef UTIL_H', '#define UTIL_H', '', 'int helper(int value);', '', '#endif', ''].join(
    '\n'
  ),
  'docs/getting-started.md': [
    '# Getting started',
    '',
    '- `svn update` brings the working copy up to date.',
    '- `svn commit` sends local changes as a new revision.',
    '',
  ].join('\n'),
};

const WINDOWS_DRIVE_PATH = /^([A-Za-z]:)[\\/](.*)$/;

/**
 * Pure: svn-compatible `file://` URL for a local repository directory.
 * Windows drive paths get their separators normalized before encoding —
 * `pathToFileURL` would otherwise percent-encode backslashes (`%5C`), which
 * svn cannot use — and the drive form is honored on every host platform.
 */
export function localRepositoryUrl(repositoryPath: string): string {
  const drive = WINDOWS_DRIVE_PATH.exec(repositoryPath.trim());
  const normalized = drive
    ? `${drive[1]}/${drive[2].replaceAll('\\', '/')}`
    : resolve(repositoryPath);
  return pathToFileURL(normalized).href;
}

/** Pure: trunk URL of a repository root URL, built with the shared URL utils. */
export function trunkUrlOf(repositoryUrl: string): string {
  return joinRepoUrl(repositoryUrl, 'trunk');
}

/** Root directory holding the repository, the seed tree and its working copy. */
function sampleRepositoryRoot(): string {
  return (
    process.env.SHELLYSVN_SAMPLE_REPO_PATH ||
    join(
      app?.getPath?.('userData') ?? join(tmpdir(), 'shellysvn'),
      SAMPLE_REPOSITORY_DIR_NAME
    )
  );
}

/** Companion-binary convention (see `svnmucc`): svnadmin lives next to svn. */
export async function resolveSvnadminCommand(): Promise<string> {
  const { svnCommand } = await resolveSvnExecution();
  const extension = extname(svnCommand);
  const adminName = `svnadmin${extension}`;
  const commandDirectory = dirname(svnCommand);
  return commandDirectory === '.' ? adminName : join(commandDirectory, adminName);
}

async function runSvnadmin(args: string[]): Promise<string> {
  const command = await resolveSvnadminCommand();
  const { stdout } = await execFileAsync(command, args, {
    windowsHide: true,
    timeout: SVNADMIN_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}

/**
 * Does `path` already look like a Subversion repository (a `db` directory,
 * as created by `svnadmin create`)? Reuse instead of erroring out.
 */
async function isExistingRepository(path: string): Promise<boolean> {
  try {
    const dbStat = await stat(join(path, 'db'));
    return dbStat.isDirectory();
  } catch {
    return false;
  }
}

async function writeSampleTree(seedDirectory: string): Promise<void> {
  for (const [relativePath, content] of Object.entries(SAMPLE_TREE)) {
    const target = join(seedDirectory, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

/** Append a line to a seeded file inside the sample working copy. */
async function appendLine(path: string, line: string): Promise<void> {
  const current = await readFile(path, 'utf8');
  await writeFile(path, `${current}${line}\n`, 'utf8');
}

export async function createSampleRepository(): Promise<SampleRepositoryResult> {
  const root = sampleRepositoryRoot();
  const repositoryPath = join(root, 'repo');
  const seedDirectory = join(root, 'seed');
  const workingCopyPath = join(root, 'working-copy');
  const repositoryUrl = localRepositoryUrl(repositoryPath);
  const trunkUrl = trunkUrlOf(repositoryUrl);

  try {
    if (await isExistingRepository(repositoryPath)) {
      // Idempotent playground: a previous run created it, reuse as-is.
      return {
        success: true,
        url: trunkUrl,
        repositoryUrl,
        path: repositoryPath,
        created: false,
      };
    }
    if (await pathExists(root)) {
      await rm(root, { recursive: true, force: true });
    }

    await mkdir(root, { recursive: true });
    await runSvnadmin(['create', repositoryPath]);

    // r1: the conventional layout, all three directories in one commit.
    await runSvnText(
      withSvnTargets(
        ['mkdir', '-m', 'Create the standard trunk/branches/tags layout'],
        [joinRepoUrl(repositoryUrl, 'trunk'), joinRepoUrl(repositoryUrl, 'branches'), joinRepoUrl(repositoryUrl, 'tags')]
      )
    );

    // r2: initial import of the sample tree.
    await writeSampleTree(seedDirectory);
    await runSvnText(
      withSvnTargets(
        ['import', '-m', 'Initial import of the sample project'],
        [seedDirectory, trunkUrl]
      )
    );

    // r3 + r4: follow-up commits through a real working copy so log, diff and
    // blame have history with per-line attribution.
    await runSvnText(withSvnTargets(['checkout', '--non-interactive'], [trunkUrl, workingCopyPath]));
    await appendLine(join(workingCopyPath, 'README.md'), '- `svn log` shows the history you are reading right now.');
    await runSvnText(
      withSvnTargets(['commit', '-m', 'Document the log command in the README'], [workingCopyPath])
    );
    await appendLine(join(workingCopyPath, 'src', 'main.c'), '/* Sample edit for blame attribution. */');
    await runSvnText(
      withSvnTargets(['commit', '-m', 'Add a blame-visible comment in main.c'], [workingCopyPath])
    );

    return {
      success: true,
      url: trunkUrl,
      repositoryUrl,
      path: repositoryPath,
      created: true,
    };
  } catch (error) {
    // A half-created playground must not block the next attempt: remove it so
    // the step can simply be retried.
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    return {
      success: false,
      url: '',
      repositoryUrl: '',
      path: '',
      created: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
