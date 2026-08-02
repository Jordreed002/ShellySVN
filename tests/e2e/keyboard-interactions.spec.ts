import { test, expect } from '../helpers/electron-fixture';
import { AppPage } from '../page-objects/AppPage';

/**
 * Keyboard-interaction E2E journey (J11 / accessibility).
 *
 * Structural specs confirm controls exist; this journey confirms the keyboard
 * behaves on the Settings dialog: dismissal, focus containment, and the
 * keyboard-operable close control.
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

    // Stay below Electron's draggable titlebar while clicking outside the panel.
    await overlay.click({ position: { x: 100, y: 100 } });

    await expect(overlay).toBeHidden({ timeout: 3000 });
  });

  test('Escape dismisses the Settings dialog', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toBeHidden({ timeout: 3000 });
  });

  test('focus is contained within the modal while it is open', async ({ page }) => {
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
