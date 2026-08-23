import { test, expect } from '../helpers/electron-fixture';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

/*
 * Visual regression baselines for the core screens (#132).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CROSS-OS / CROSS-MACHINE CAVEAT — read before touching baselines
 * ─────────────────────────────────────────────────────────────────────────────
 * The baselines in `visual-regression.spec.ts-snapshots/` were generated on
 * macOS arm64 (the same runner family the `e2e-tests` CI job uses, macos-14).
 * Pixel comparisons are sensitive to:
 *
 *   - font availability and hinting (SF Pro on macOS vs whatever a Linux or
 *     Windows runner ships — Playwright suffixes snapshots per platform, so a
 *     non-darwin runner simply has no baseline yet and reports "snapshot
 *     missing" rather than a false diff);
 *   - device pixel ratio (a Retina host captures 2x PNGs; a CI virtual
 *     display usually captures 1x);
 *   - Chromium/Electron version drift between the machine that generated the
 *     baseline and the one comparing against it.
 *
 * Strategy, in order: masks for anything volatile (never brittle waits), a
 * 2% diff-pixel-ratio budget for anti-aliasing noise, and when a baseline is
 * legitimately stale, regenerate with:
 *
 *   bunx playwright test --config=tests/playwright.config.ts \
 *     tests/e2e/visual-regression.spec.ts --update-snapshots
 *
 * and commit the updated PNGs. Coordination request for CI (tracked under
 * #129/#132 follow-up): decide whether CI compares against the committed
 * darwin baselines or regenerates + uploads them as artifacts per platform.
 *
 * Determinism measures taken here:
 *   - fixed BrowserWindow bounds (1280x800) so layout never depends on the
 *     host screen;
 *   - `page.emulateMedia({ reducedMotion: 'reduce' })` — the app ships a
 *     prefers-reduced-motion kill-switch (see styles/global.css) that stops
 *     transitions and skeleton shimmer — plus Playwright's own
 *     `animations: 'disabled'` at capture time;
 *   - `page.emulateMedia({ colorScheme: 'dark' })` — the default theme is
 *     'system', which would otherwise follow the host OS appearance;
 *   - `TZ=UTC` for the app process so date formatting (repo browser rows,
 *     status ages) cannot shift with the host timezone;
 *   - `document.fonts.ready` before every capture;
 *   - the status bar (`footer[role="status"]`) and any text containing user
 *     paths are masked via matcher masking — they embed machine-specific
 *     paths, revisions and the local `svn` version.
 *
 * TODO(a11e / #129 — axe coordination): once `@axe-core/playwright` is
 * approved as a dependency (package.json is owned by Track A), insert
 * `AxeBuilder.analyze()` snapshots for these same screens and replace the
 * hand-rolled checks in `accessibility-smoke.spec.ts` with axe audits. Keep
 * the capture order/stabilization from this file so both suites share one
 * deterministic setup.
 */

// Dates in listings and status cells must not depend on the host timezone.
process.env.TZ = 'UTC';

const WINDOW_BOUNDS = { width: 1280, height: 800 };

/** Anything that embeds machine-specific paths (address bar text, settings…). */
function userPathTexts(page: Page): Locator {
  return page.getByText(/\/(?:Users|home|runner)\//);
}

/** The status bar embeds paths, revisions, disk usage and the svn version. */
function statusBar(page: Page): Locator {
  return page.locator('footer[role="status"]');
}

async function volatileMasks(page: Page): Promise<Locator[]> {
  const masks: Locator[] = [];
  for (const candidate of [statusBar(page), userPathTexts(page)]) {
    if ((await candidate.count()) > 0) masks.push(candidate);
  }
  return masks;
}

/** Pin everything the host machine would otherwise decide for us. */
async function stabilize(electronApp: ElectronApplication, page: Page): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setBounds({ x: 40, y: 40, width: bounds.width, height: bounds.height });
    }
  }, WINDOW_BOUNDS);

  // Settings-dependent chrome first: the status bar attaches and every lazy
  // skeleton resolves only once the store reads land. The onboarding
  // tutorial's visibility is decided by the same reads, so by the time these
  // settle, the tutorial either is on screen or never will be — the launch
  // fixture may already have closed it, which is fine.
  await expect(page.locator('footer[role="status"]')).toBeAttached({ timeout: 10000 });
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });

  const closeTutorialButton = page.getByLabel('Close tutorial');
  if (await closeTutorialButton.isVisible()) {
    await closeTutorialButton.click();
    await expect(closeTutorialButton).toBeHidden({ timeout: 5000 });
  }

  // 'system' theme follows the OS; reduced motion is the app's own kill-switch.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);

  // Resize + media emulation settle before the capture.
  await page.waitForTimeout(400);
}

/**
 * Lazy-loaded surfaces first paint skeletons (`.skeleton-shimmer`) and the
 * status bar mounts only once settings resolve — before that the main content
 * sits ~26px lower. Captures must never land mid-load, so wait until every
 * shimmer is gone and the footer has attached, then let the layout settle.
 */
async function waitForSettled(page: Page): Promise<void> {
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('footer[role="status"]')).toBeAttached({ timeout: 10000 });
  // If the tutorial made it through anyway, fail loudly rather than capture it.
  await expect(page.getByLabel('Close tutorial')).toHaveCount(0);
  await page.waitForTimeout(400);
}

async function capture(page: Page, name: string): Promise<void> {
  await waitForSettled(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
    mask: await volatileMasks(page),
  });
}

/**
 * The same successful-listing mock set `repo-browser.spec.ts` installs, so the
 * repository browser screenshot needs no network and no local svn.
 */
async function installRepoBrowserMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    // oxlint-disable-next-line consistent-function-scoping -- must stay inside the callback; Playwright serializes it with the evaluate body.
    const makeEntries = (url: string) => ({
      entries: [
        {
          name: 'src',
          path: '/src',
          url: `${url.replace(/\/$/, '')}/src`,
          kind: 'dir' as const,
          size: 0,
          revision: 12,
          author: 'dev',
          date: '2026-04-30T10:00:00.000Z',
        },
        {
          name: 'README.md',
          path: '/README.md',
          url: `${url.replace(/\/$/, '')}/README.md`,
          kind: 'file' as const,
          size: 256,
          revision: 11,
          author: 'dev',
          date: '2026-04-30T10:00:00.000Z',
        },
      ],
    });

    ipcMain.removeHandler('auth:resumeSession');
    ipcMain.handle('auth:resumeSession', () => Promise.resolve(null));
    ipcMain.removeHandler('auth:beginSession');
    ipcMain.handle('auth:beginSession', (_event, request: { realm: string; username: string }) =>
      Promise.resolve({
        id: 'e2e-visual-auth-session',
        realm: request.realm,
        username: request.username,
        persistent: false,
        expiresAt: null,
      })
    );
    ipcMain.removeHandler('svn:list');
    ipcMain.handle('svn:list', (_event, url: string) =>
      Promise.resolve({ path: url, ...makeEntries(url) })
    );
    ipcMain.removeHandler('svn:proplist');
    ipcMain.handle('svn:proplist', () => Promise.resolve({ properties: [] }));
  });
}

test.describe('Visual regression — core screens', () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await stabilize(electronApp, page);
  });

  test('home welcome briefing', async ({ page }) => {
    // Fresh profile: the briefing explains that nothing is open yet.
    await expect(page.getByText('No working copy open').first()).toBeVisible({ timeout: 10000 });
    await capture(page, 'home');
  });

  test('files screen without a working copy', async ({ page }) => {
    await page
      .getByTestId('sidebar-ready')
      .getByRole('link', { name: 'Files', exact: true })
      .click();
    await page.waitForURL(/\/files/, { timeout: 10000 });
    await expect(page.locator('main')).toBeVisible();
    await page.waitForTimeout(500);
    await capture(page, 'files-empty');
  });

  test('history screen without a working copy', async ({ page }) => {
    // The rail hides History until a working copy exists, so drive the app's
    // hash router directly (the app loads from file:// with hash routing).
    await page.evaluate(() => {
      window.location.hash = '#/history';
    });
    await expect(page.getByText('No working copy selected')).toBeVisible({ timeout: 10000 });
    await capture(page, 'history-empty');
  });

  test('repository browser with a listing', async ({ electronApp, page }) => {
    await installRepoBrowserMocks(electronApp);
    await page.getByRole('link', { name: 'Repository browser', exact: true }).click();
    await expect(page.getByRole('heading', { name: /repository browser/i })).toBeVisible();

    await page.getByLabel('Repository URL').fill('https://svn.example.com/repo/trunk');
    await page.getByRole('button', { name: /connect/i }).click();
    await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 10000 });

    await capture(page, 'repo-browser');
  });

  test('settings dialog (default tab)', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    await capture(page, 'settings-dialog');
  });

  test('command palette', async ({ page }) => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = page.locator('.command-palette');
    await expect(palette).toBeVisible({ timeout: 5000 });
    // The search input takes focus the moment the palette opens.
    await expect(palette.getByPlaceholder('Run a command…')).toBeFocused();
    await page.waitForTimeout(300);
    await capture(page, 'command-palette');
  });

  test('status legend dialog', async ({ page }) => {
    // The legend button lives on the status bar, which is visible without a
    // working copy ("No working copy open" strip).
    const legendButton = page.getByRole('button', { name: 'What the status colors mean' });
    await expect(legendButton).toBeVisible({ timeout: 10000 });
    await legendButton.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    await capture(page, 'status-legend-dialog');
  });
});
