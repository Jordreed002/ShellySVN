import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '../helpers/electron-fixture';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { capture, stabilize } from '../helpers/visual-helpers';
import { openWorkingCopyInApp, run, svn, svnToolchainAvailable } from '../helpers/svn-fixture';

/*
 * Visual regression baselines for the working-copy-backed screens.
 *
 * Companion to visual-regression.spec.ts (read its caveats block first —
 * same fixed bounds, dark colorScheme, reduced motion, fonts-ready, 2% diff
 * budget, all via tests/helpers/visual-helpers.ts).
 *
 * The difference: these screens need a real working copy with real history,
 * so the suite checks one out of the docker SVN compatibility lab
 * (`bun run svn:lab:up` — tests/fixtures/svn-compat-server). The lab seeds a
 * throwaway repository; this fixture turns its `/sandbox` into a small,
 * deterministic project (import + two follow-up commits + a tag and a
 * branch) the first time it runs against a fresh lab, and reuses whatever is
 * already there afterwards. The working copy itself is a temp-dir checkout,
 * so nothing on the host is touched. Revisions and commit dates therefore
 * belong to the machine that generated the baselines — regenerate the PNGs
 * whenever the lab volume is reset (`bun run svn:lab:reset`).
 *
 * Machine-specific leakage is masked, never hidden:
 *   - the temp checkout path (sidebar bookmark rows, headers, commit dialog
 *     path cells) — text nodes plus the breadcrumb containers, because the
 *     Files toolbar splits the path across separate crumb elements;
 *   - the status bar (revisions, svn version — same as the core spec).
 *
 * Auth: the lab's svnserve requires credentials, so the fixture performs one
 * authenticated CLI call; the svn runtime auth cache then lets the app's
 * `--non-interactive` calls authenticate silently, exactly like a user who
 * checked out once from a file manager.
 */

// Dates in listings and log rows must not depend on the host timezone.
process.env.TZ = 'UTC';

const LAB_URL = process.env.SHELLYSVN_DOCKER_SVN_TEST_URL
  ? `${process.env.SHELLYSVN_DOCKER_SVN_TEST_URL.replace(/\/$/, '')}/trunk`
  : 'svn://127.0.0.1:36990/repo/sandbox/trunk';
const LAB_USERNAME = process.env.SHELLYSVN_PROTOCOL_USERNAME ?? 'shellysvn';
const LAB_PASSWORD = process.env.SHELLYSVN_PROTOCOL_PASSWORD ?? 'release-test';
const BOOKMARK_NAME = 'Sandbox trunk';

function labReachable(): boolean {
  const probe = run(
    'svn',
    ['info', '--non-interactive', '--username', LAB_USERNAME, '--password', LAB_PASSWORD, LAB_URL],
    { allowFailure: true }
  );
  return probe.status === 0;
}

const labAvailable = svnToolchainAvailable && labReachable();

interface LabFixture {
  wc: string;
  dispose: () => void;
}

/**
 * Check the sandbox trunk out of the lab and give it a deterministic local
 * state: two modified files (README.md → M, src/parser.c → M) and one
 * unversioned scratch file (?), so listings, commit dialog and status chrome
 * all have real content to render.
 */
function createLabWorkingCopy(): LabFixture {
  const root = mkdtempSync(join(tmpdir(), 'shellysvn-e2e-lab-'));
  const wc = join(root, 'wc');
  const auth = ['--username', LAB_USERNAME, '--password', LAB_PASSWORD];

  svn(['checkout', LAB_URL, wc, ...auth]);

  writeFileSync(
    join(wc, 'README.md'),
    [
      '# Sandbox project',
      '',
      'A deterministic fixture repository for ShellySVN visual tests.',
      '',
      '## Usage',
      '',
      'Run the parser on any input file.',
      '',
      'LOCAL EDIT — uncommitted visual-test change.',
      '',
    ].join('\n'),
    'utf8'
  );
  writeFileSync(
    join(wc, 'src', 'parser.c'),
    [
      '/* minimal parser */',
      'int parse(const char *input) {',
      '    /* LOCAL EDIT — uncommitted visual-test change */',
      '    return input && *input ? 1 : 0;',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );
  writeFileSync(join(wc, 'scratch.txt'), 'unversioned scratch file\n', 'utf8');

  return {
    wc,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Seed the lab sandbox into the deterministic project layout (idempotent). */
function seedLabSandbox(): void {
  const sandboxUrl = LAB_URL.replace(/\/trunk$/, '');
  const auth = ['--username', LAB_USERNAME, '--password', LAB_PASSWORD];
  const list = svn(['ls', ...auth, sandboxUrl], { allowFailure: true });
  if (list.output.includes('trunk/')) return; // already seeded (a previous run did it)

  const root = mkdtempSync(join(tmpdir(), 'shellysvn-e2e-seed-'));
  try {
    const staging = join(root, 'import');
    mkdirSync(join(staging, 'src'));
    mkdirSync(join(staging, 'docs'));
    writeFileSync(
      join(staging, 'README.md'),
      '# Sandbox project\n\nA deterministic fixture repository for ShellySVN visual tests.\n'
    );
    writeFileSync(join(staging, 'Makefile'), 'all: build\n\nbuild:\n\t@echo building\n');
    writeFileSync(
      join(staging, 'src', 'main.c'),
      '#include <stdio.h>\n\nint main(void) {\n    printf("sandbox\\n");\n    return 0;\n}\n'
    );
    writeFileSync(
      join(staging, 'src', 'parser.c'),
      '/* minimal parser */\nint parse(const char *input) {\n    return input ? 1 : 0;\n}\n'
    );
    writeFileSync(join(staging, 'docs', 'guide.md'), '# Guide\n\nRun make to build.\n');

    svn([
      'mkdir',
      ...auth,
      `${sandboxUrl}/trunk`,
      `${sandboxUrl}/tags`,
      `${sandboxUrl}/branches`,
      '-m',
      'Create sandbox project layout',
    ]);
    svn(['import', ...auth, staging, `${sandboxUrl}/trunk`, '-m', 'Import project skeleton']);

    const wc = join(root, 'wc');
    svn(['checkout', ...auth, `${sandboxUrl}/trunk`, wc, '-q']);
    writeFileSync(
      join(wc, 'README.md'),
      '# Sandbox project\n\nA deterministic fixture repository for ShellySVN visual tests.\n\n## Usage\n\nRun the parser on any input file.\n'
    );
    writeFileSync(
      join(wc, 'src', 'parser.c'),
      '/* minimal parser */\nint parse(const char *input) {\n    return input && *input ? 1 : 0;\n}\n'
    );
    svn(['commit', ...auth, wc, '-m', 'Handle empty parser input', '-q']);
    writeFileSync(join(wc, 'docs', 'configuration.md'), '# Configuration\n\nOptions are read from config.h.\n');
    svn(['add', join(wc, 'docs', 'configuration.md')]);
    svn(['commit', ...auth, wc, '-m', 'Document configuration options', '-q']);
    svn([
      'copy',
      ...auth,
      `${sandboxUrl}/trunk`,
      `${sandboxUrl}/tags/v1.0.0`,
      '-m',
      'Tag release 1.0.0',
    ]);
    svn([
      'copy',
      ...auth,
      `${sandboxUrl}/trunk`,
      `${sandboxUrl}/branches/feature-io`,
      '-m',
      'Branch for I/O work',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Path-shaped text on Windows: forward-slash Unix paths (the core spec's
 * regex) plus backslash Win32 paths, e.g. temp checkout locations.
 */
function userPathTextsWin32(page: Page): Locator {
  return page.getByText(/(?:\/(?:Users|home|runner)\/)|(?:[A-Za-z]:\\.*(?:Users|Temp))/);
}

/**
 * The fixture's temp dir name (mkdtemp suffix) leaks into truncated UI text —
 * sidebar bookmark subtexts and recent-location rows render "…/shellysvn-e2e-lab-<suffix>/…",
 * which no full-path regex can match. Mask every node naming the fixture tree.
 */
function fixtureTempTexts(page: Page): Locator {
  return page.getByText(/shellysvn-e2e-/);
}

/**
 * The Files toolbar renders the working-copy path as separate breadcrumb
 * crumbs ("C:", "Users", …), so no single text node matches the path regex.
 * Mask the breadcrumb containers themselves on every capture.
 */
function breadcrumbs(page: Page): Locator {
  return page.locator('.breadcrumb');
}

test.describe('Visual regression — working copy screens', () => {
  test.skip(
    !labAvailable,
    'requires the docker SVN compatibility lab (bun run svn:lab:up) and the svn toolchain'
  );

  let fixture: LabFixture;

  test.beforeAll(async () => {
    seedLabSandbox();
    fixture = createLabWorkingCopy();
  });

  test.afterAll(async () => {
    fixture?.dispose();
  });

  /**
   * Fresh profile per test, then open the lab checkout through the same
   * bookmark flow real users drive (mocked native picker + settings store).
   * openWorkingCopyInApp reloads the page mid-flow, so re-settle the lazy
   * chrome afterwards.
   */
  async function openWorkingCopy(electronApp: ElectronApplication, page: Page): Promise<void> {
    await stabilize(electronApp, page);
    await openWorkingCopyInApp(electronApp, page, fixture.wc, BOOKMARK_NAME);
    await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
  }

  test('home with a working copy open', async ({ electronApp, page }) => {
    await openWorkingCopy(electronApp, page);

    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });
    await page.waitForTimeout(500);

    await capture(page, 'home-working-copy', [breadcrumbs(page), userPathTextsWin32(page), fixtureTempTexts(page)]);
  });

  test('files with local modifications', async ({ electronApp, page }) => {
    await openWorkingCopy(electronApp, page);

    // The listing is live svn status output: both edited files plus the
    // unversioned scratch file must be on screen before the capture.
    await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('scratch.txt').first()).toBeVisible({ timeout: 10000 });

    await capture(page, 'files-working-copy', [breadcrumbs(page), userPathTextsWin32(page), fixtureTempTexts(page)]);
  });

  test('history with log entries', async ({ electronApp, page }) => {
    await openWorkingCopy(electronApp, page);

    // The rail exposes no History link, so drive the hash router directly and
    // pass the working copy as the route's search param (like Files does).
    await page.evaluate((wcPath) => {
      window.location.hash = `#/history?path=${encodeURIComponent(wcPath)}`;
    }, fixture.wc);
    // Log rows come from the lab server (cached CLI auth) — wait for the
    // newest seeded commit message to land.
    await expect(page.getByText('Document configuration options').first()).toBeVisible({
      timeout: 15000,
    });

    await capture(page, 'history-log', [breadcrumbs(page), userPathTextsWin32(page), fixtureTempTexts(page)]);
  });

  test('history revision graph', async ({ electronApp, page }) => {
    await openWorkingCopy(electronApp, page);

    await page.evaluate((wcPath) => {
      window.location.hash = `#/history?path=${encodeURIComponent(wcPath)}`;
    }, fixture.wc);
    await expect(page.getByText('Document configuration options').first()).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId('history-view-graph').click();
    // The graph renders after the log resolves; give the layout a beat.
    await page.waitForTimeout(600);

    await capture(page, 'history-graph', [breadcrumbs(page), userPathTextsWin32(page), fixtureTempTexts(page)]);
  });

  test('commit dialog with pending changes', async ({ electronApp, page }) => {
    await openWorkingCopy(electronApp, page);

    const commitButton = page.locator('button[title="Commit changes — svn commit"]');
    await expect(commitButton).toBeVisible({ timeout: 10000 });
    await expect(commitButton).toBeEnabled();
    await commitButton.click();

    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
    // The dialog fetches the change set before the form settles.
    await expect(page.locator('.modal textarea').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(400);

    await capture(page, 'commit-dialog', [userPathTextsWin32(page), fixtureTempTexts(page)]);
  });

  test('repository browser against the live lab', async ({ electronApp, page }) => {
    await stabilize(electronApp, page);

    await page.getByRole('link', { name: 'Repository browser', exact: true }).click();
    await expect(page.getByRole('heading', { name: /repository browser/i })).toBeVisible();

    await page.getByLabel('Repository URL').fill(LAB_URL);
    await page.getByRole('button', { name: /connect/i }).click();
    await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 15000 });

    await capture(page, 'repo-browser-live', [breadcrumbs(page), fixtureTempTexts(page)]);
  });
});
