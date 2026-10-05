import { test, expect } from '../helpers/electron-fixture';
import type { ElectronApplication } from '@playwright/test';
import { capture, stabilize } from '../helpers/visual-helpers';

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
 * Determinism measures (shared with the working-copy spec via
 * tests/helpers/visual-helpers.ts):
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
 *   - the status bar (`div[role="status"]`) and any text containing user
 *     paths are masked via matcher masking — they embed machine-specific
 *     paths, revisions and the local `svn` version.
 *
 * a11y (#129 — axe delivered): `@axe-core/playwright` is installed and
 * `accessibility-smoke.spec.ts` runs axe audits (home, files empty state,
 * settings dialog, command palette) reusing this file's stabilization
 * measures so both suites share one deterministic setup.
 */

// Dates in listings and status cells must not depend on the host timezone.
process.env.TZ = 'UTC';

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
