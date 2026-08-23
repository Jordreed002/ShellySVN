import { test, expect } from '../helpers/electron-fixture';

/*
 * Accessibility smoke — Playwright built-in assertions only (#129).
 *
 * These are structural checks the toolchain can already prove: landmark and
 * widget roles on key screens, labelled modals that take focus, and a visible
 * focus indicator on keyboard focus. They are deliberately cheap and stable.
 *
 * TODO(a11y / #129 — axe coordination request): replace the per-screen checks
 * below with full axe audits once `@axe-core/playwright` is added as a dev
 * dependency. package.json is owned by Track A, so this file intentionally
 * ships without it; the requested addition is:
 *
 *   devDependencies: { "@axe-core/playwright": "^4.x" }
 *
 * Slot-in point per test:
 *   - 'key screens expose landmark roles'   → AxeBuilder.analyze() on home
 *     and the files empty state;
 *   - 'settings dialog is a labelled modal' → analyze() scoped to
 *     page.locator('.modal-overlay');
 *   - 'command palette focuses its search'  → analyze() scoped to
 *     page.locator('.command-palette').
 * Keep violations allowlisted explicitly (e.g. `disableRules` with a comment)
 * so regressions surface. The visual-regression spec's deterministic
 * stabilization (fixed bounds, reduced motion) should be reused here so both
 * suites behave identically.
 */

test.describe('Accessibility smoke', () => {
  test.beforeEach(async ({ page }) => {
    // The onboarding tutorial mounts after its settings read; it is a modal
    // that traps focus, so dismiss it before asserting anything about focus.
    // Wait for the settings-dependent status bar first — by then the
    // tutorial's visibility is decided, and the launch fixture may already
    // have closed it.
    await expect(page.locator('footer[role="status"]')).toBeAttached({ timeout: 10000 });
    const closeTutorialButton = page.getByLabel('Close tutorial');
    if (await closeTutorialButton.isVisible()) {
      await closeTutorialButton.click();
      await expect(closeTutorialButton).toBeHidden({ timeout: 5000 });
    }
  });

  test('key screens expose landmark roles', async ({ page }) => {
    // Home: application chrome (banner), primary content (main), the rail
    // (complementary, labelled) and the live status strip (status).
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Application status' })).toBeVisible();

    // The rail's navigation is a named landmark, not a bare div.
    await expect(
      page.getByRole('navigation', { name: 'Repositories and locations' })
    ).toBeVisible();
  });

  test('settings dialog is a labelled modal that contains focus', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus must be inside the dialog, and its close control must expose an
    // accessible name.
    const focusInside = await dialog.evaluate(
      (node) => node.contains(document.activeElement)
    );
    expect(focusInside).toBe(true);
    await expect(page.getByTestId('modal-close-button')).toHaveAccessibleName(/.+/);

    // Tab cycles within the dialog (focus containment, 6 hops).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const stillInside = await page.evaluate(() => {
        const overlay = document.querySelector('.modal-overlay');
        return overlay ? overlay.contains(document.activeElement) : false;
      });
      expect(stillInside).toBe(true);
    }
  });

  test('keyboard focus shows a visible indicator on header controls', async ({ page }) => {
    // Walk the tab order until a header button is focused; the app styles
    // focus with a ring (box-shadow) or outline — either counts as visible.
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('header')) return false;
        const style = window.getComputedStyle(el);
        const outlineVisible =
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const ringVisible = style.boxShadow && style.boxShadow !== 'none';
        return outlineVisible || ringVisible;
      });
    }
    expect(found).toBe(true);
  });

  test('command palette search is a focused textbox', async ({ page }) => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = page.locator('.command-palette');
    await expect(palette).toBeVisible({ timeout: 5000 });

    const search = palette.getByRole('textbox');
    await expect(search).toBeFocused();
    await expect(search).toHaveAccessibleName(/.+/);

    // Escape closes the palette and restores focus to the page.
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden({ timeout: 5000 });
  });
});
