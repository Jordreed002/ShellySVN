import { expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

/*
 * Shared determinism plumbing for the visual-regression specs.
 *
 * Extracted from visual-regression.spec.ts so the working-copy-backed spec
 * (visual-regression-working-copy.spec.ts) stabilizes and captures exactly
 * the same way — see the caveats block at the top of that file for the full
 * rationale (fixed bounds, dark colorScheme, reduced motion, fonts ready,
 * masked volatile regions, 2% diff budget).
 */

export const WINDOW_BOUNDS = { width: 1280, height: 800 };

/** Anything that embeds machine-specific paths (address bar text, settings…). */
export function userPathTexts(page: Page): Locator {
  return page.getByText(/\/(?:Users|home|runner)\//);
}

/**
 * The status bar embeds paths, revisions, disk usage and the svn version.
 * It is a `div[role="status"]`, not a `<footer>`: role="status" is only
 * allowed on generic elements (aria-allowed-role), so the component uses a
 * div with an explicit aria-label (see StatusBar.tsx).
 */
export function statusBar(page: Page): Locator {
  return page.locator('div[role="status"][aria-label="Application status"]');
}

/** Default volatile regions for every capture. */
export async function volatileMasks(page: Page): Promise<Locator[]> {
  const masks: Locator[] = [];
  for (const candidate of [statusBar(page), userPathTexts(page)]) {
    if ((await candidate.count()) > 0) masks.push(candidate);
  }
  return masks;
}

/** Pin everything the host machine would otherwise decide for us. */
export async function stabilize(electronApp: ElectronApplication, page: Page): Promise<void> {
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
  await expect(statusBar(page)).toBeAttached({ timeout: 10000 });
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });

  // The tutorial's lifetime is decided by the same store reads that just
  // settled, so it can unmount between the visibility check and the click.
  // Give the click a short budget and treat a mid-click unmount as "already
  // closed"; only a tutorial that stubbornly stays on screen fails the run.
  const closeTutorialButton = page.getByLabel('Close tutorial');
  await closeTutorialButton.click({ timeout: 2000 }).catch(() => {
    /* self-dismissed before the click landed */
  });
  await expect(closeTutorialButton).toHaveCount(0, { timeout: 5000 });

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
export async function waitForSettled(page: Page): Promise<void> {
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });
  await expect(statusBar(page)).toBeAttached({ timeout: 10000 });
  // If the tutorial made it through anyway, fail loudly rather than capture it.
  await expect(page.getByLabel('Close tutorial')).toHaveCount(0);
  await page.waitForTimeout(400);
}

export async function capture(
  page: Page,
  name: string,
  extraMasks: Locator[] = []
): Promise<void> {
  await waitForSettled(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
    mask: [...(await volatileMasks(page)), ...extraMasks],
  });
}
