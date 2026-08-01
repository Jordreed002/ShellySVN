import { test, expect } from '../helpers/electron-fixture';
import { AppPage } from '../page-objects/AppPage';

/**
 * Keyboard-interaction E2E journey (J11 / accessibility).
 *
 * Structural specs confirm controls exist; this journey confirms the keyboard
 * *behaves* on the Settings dialog. Two accessibility guarantees — Escape to
 * close and focus containment — are currently MISSING from SettingsDialog
 * because it renders a plain `.modal-overlay` rather than the app's
 * `AccessibleDialog` (which provides both). Those are recorded below as
 * skipped tests so the gap is tracked in-code; the behaviors that DO hold are
 * asserted for real.
 */
test.describe('Keyboard interactions', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('the close button is operable from the keyboard', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });

    const close = page.getByTestId('modal-close-button');
    await close.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('.modal-overlay')).toBeHidden({ timeout: 3000 });
  });

  test('clicking the overlay backdrop closes the dialog', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    const overlay = page.locator('.modal-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Click the backdrop (top-left corner), not the modal panel itself.
    await overlay.click({ position: { x: 5, y: 5 } });

    await expect(overlay).toBeHidden({ timeout: 3000 });
  });

  // KNOWN a11y GAP — SettingsDialog uses a plain modal-overlay, not
  // AccessibleDialog, so Escape does not close it. Tracked here so it is not
  // silently lost. Remove `.skip` once SettingsDialog adopts AccessibleDialog.
  test.skip('Escape dismisses the Settings dialog (a11y gap)', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toBeHidden({ timeout: 3000 });
  });

  // KNOWN a11y GAP — focus is not trapped; Tab escapes into the sidebar behind
  // the dialog. Tracked here pending the AccessibleDialog migration.
  test.skip('focus is contained within the modal while it is open (a11y gap)', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const overlay = document.querySelector('.modal-overlay');
        return overlay ? overlay.contains(document.activeElement) : false;
      });
      expect(inside).toBe(true);
    }
  });
});
