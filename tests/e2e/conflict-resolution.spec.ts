import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from '../helpers/electron-fixture';

function fileUrl(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function run(command: string, args: string[], options: { cwd?: string; allowFailure?: boolean } = {}) {
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

function svn(args: string[], options: { cwd?: string; allowFailure?: boolean } = {}) {
  return run('svn', ['--non-interactive', ...args], options);
}

function append(path: string, content: string): void {
  writeFileSync(path, `${readFileSync(path, 'utf8')}${content}`, 'utf8');
}

function createConflictedWorkingCopy(): { root: string; wc: string; conflictFile: string } {
  run('svn', ['--version', '--quiet']);
  run('svnadmin', ['--version', '--quiet']);

  const root = mkdtempSync(join(tmpdir(), 'shellysvn-e2e-conflict-'));
  const repo = join(root, 'repo');
  const importPath = join(root, 'import');
  const wc1 = join(root, 'wc1');
  const wc2 = join(root, 'wc2');
  const trunkUrl = `${fileUrl(repo)}/trunk`;

  run('svnadmin', ['create', repo]);
  mkdirSync(join(importPath, 'trunk', 'src'), { recursive: true });
  writeFileSync(join(importPath, 'trunk', 'src', 'app.txt'), 'line 1\nline 2\n', 'utf8');
  svn(['import', importPath, fileUrl(repo), '-m', 'initial import']);
  svn(['checkout', trunkUrl, wc1]);
  svn(['checkout', trunkUrl, wc2]);

  const conflictFile1 = join(wc1, 'src', 'app.txt');
  const conflictFile2 = join(wc2, 'src', 'app.txt');
  append(conflictFile1, 'from wc1\n');
  svn(['commit', '-m', 'conflict source'], { cwd: wc1 });
  append(conflictFile2, 'from wc2\n');
  const update = svn(['update'], { cwd: wc2, allowFailure: true });
  if (update.status === 0 && !svn(['status'], { cwd: wc2 }).output.includes('C')) {
    throw new Error(`Expected conflicted working copy after update:\n${update.output}`);
  }

  return { root, wc: wc2, conflictFile: conflictFile2 };
}

test.describe('Conflict resolution E2E', () => {
  test('resolves a real conflicted file from the file explorer resolve dialog', async ({ page }) => {
    let fixture: { root: string; wc: string; conflictFile: string } | null = null;
    try {
      fixture = createConflictedWorkingCopy();
    } catch (error) {
      test.skip(
        true,
        `SVN conflict fixture unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    try {
      await page.evaluate(async (workingCopyPath) => {
        const api = (window as unknown as { api: { store: { get: Function; set: Function } } }).api;
        const settings = (await api.store.get('settings')) ?? {};
        await api.store.set('settings', {
          ...settings,
          confirmDestructiveOps: false,
          bookmarks: [{ path: workingCopyPath, name: 'Conflict WC', addedAt: Date.now() }],
        });
      }, fixture.wc);
      await page.reload();
      const closeTutorialButton = page.getByLabel('Close tutorial');
      if ((await closeTutorialButton.count()) > 0 && (await closeTutorialButton.first().isVisible())) {
        await closeTutorialButton.first().click();
      }
      await page.getByRole('link', { name: 'Conflict WC' }).click();
      await page.waitForSelector('[data-testid="file-explorer"], main', { timeout: 10000 });

      await expect(page.getByText('src').first()).toBeVisible({ timeout: 10000 });
      await page.getByText('src').first().dblclick();
      await expect(page.getByText('app.txt').first()).toBeVisible({ timeout: 10000 });
      await page.getByText('app.txt').first().click();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('svn:resolve')));

      await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
      await page.getByText('Resolve conflicts using theirs').click();
      await page.getByRole('button', { name: /^Resolve$/ }).click();

      await expect
        .poll(() => svn(['status'], { cwd: fixture.wc }).output, { timeout: 10000 })
        .not.toContain('C');
      expect(existsSync(fixture.conflictFile)).toBe(true);
    } finally {
      await page.getByRole('link', { name: 'Home' }).click().catch(() => undefined);
      if (fixture) rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
