import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { mockFileDialog } from './mock-ipc';

/**
 * Local working-copy fixtures for E2E specs that need a real SVN state.
 *
 * The fixtures only use `file://` repositories created with `svnadmin`, so no
 * network (or svnserve) is involved — but the `svn`/`svnadmin` CLI must be on
 * PATH. Specs gate on `svnToolchainAvailable` with a declarative conditional
 * skip guard (the macOS platform gates' pattern), so the skip reason is
 * visible before the test body runs.
 */

export function run(
  command: string,
  args: string[],
  options: { cwd?: string; allowFailure?: boolean } = {}
) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${output}`);
  }

  return { status: result.status ?? 1, output };
}

export function svn(
  args: string[],
  options: { cwd?: string; allowFailure?: boolean } = {}
) {
  return run('svn', ['--non-interactive', ...args], options);
}

export function fileUrl(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

/**
 * Whether this machine can build the fixtures at all. Evaluated once, at module
 * load, so guards stay declarative (a conditional skip keyed on this flag)
 * instead of the old mid-test catch-and-skip that masked real fixture bugs.
 */
export const svnToolchainAvailable = (() => {
  try {
    run('svn', ['--version', '--quiet']);
    run('svnadmin', ['--version', '--quiet']);
    return true;
  } catch {
    return false;
  }
})();

export interface WorkingCopyFixture {
  /** Temp directory holding the repository, the import staging tree and the checkout. */
  root: string;
  /** `file://` URL of the repository. */
  repoUrl: string;
  /** The checked-out working copy to open in the app. */
  wc: string;
  /** Remove everything the fixture created. */
  dispose: () => void;
}

/**
 * Create a repository, import `files` at its root, and check it out.
 * `modifyAfterCheckout` overwrites files in the checkout so the working copy
 * opens with local modifications (status `M`), which the commit flow needs.
 */
export function createWorkingCopy(
  options: {
    files?: Record<string, string>;
    modifyAfterCheckout?: Record<string, string>;
  } = {}
): WorkingCopyFixture {
  const root = mkdtempSync(join(tmpdir(), 'shellysvn-e2e-wc-'));
  const repo = join(root, 'repo');
  const importPath = join(root, 'import');
  const wc = join(root, 'wc');

  const files = options.files ?? {
    'notes.txt': 'line 1\nline 2\n',
    'readme.md': '# ShellySVN fixture\n',
  };

  run('svnadmin', ['create', repo]);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(importPath, relativePath);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  svn(['import', importPath, fileUrl(repo), '-m', 'initial import']);
  svn(['checkout', fileUrl(repo), wc]);

  for (const [relativePath, content] of Object.entries(options.modifyAfterCheckout ?? {})) {
    writeFileSync(join(wc, relativePath), content, 'utf8');
  }

  return {
    root,
    repoUrl: fileUrl(repo),
    wc,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Open a working copy in the launched app:
 *
 * 1. mock the native directory picker to return the path (this also records it
 *    as user-approved with the main process's approved-paths gate),
 * 2. register the path as a sidebar bookmark in the settings store,
 * 3. reload, then click the bookmark so the Files view opens the checkout.
 *
 * Same flow `conflict-resolution.spec.ts` uses, extracted for reuse.
 */
export async function openWorkingCopyInApp(
  electronApp: ElectronApplication,
  page: Page,
  workingCopyPath: string,
  bookmarkName: string
): Promise<void> {
  await mockFileDialog(electronApp, workingCopyPath);
  await page.evaluate(
    async ([path, name]) => {
      const api = (
        window as unknown as {
          api: {
            dialog: { openDirectory: () => Promise<string | null> };
            store: { get: Function; set: Function };
          };
        }
      ).api;
      const approvedPath = await api.dialog.openDirectory();
      if (approvedPath !== path) {
        throw new Error('Native picker did not authorize the working copy');
      }
      const settings = (await api.store.get('settings')) ?? {};
      await api.store.set('settings', {
        ...settings,
        bookmarks: [{ path, name, addedAt: Date.UTC(2026, 0, 15, 9, 0, 0) }],
      });
    },
    [workingCopyPath, bookmarkName]
  );

  await page.reload();

  const closeTutorialButton = page.getByLabel('Close tutorial');
  if (
    (await closeTutorialButton.count()) > 0 &&
    (await closeTutorialButton.first().isVisible())
  ) {
    await closeTutorialButton.first().click();
  }

  await page.getByRole('link', { name: bookmarkName }).click();
  await page.waitForURL(/\/files\?path=/, { timeout: 10000 });
}
