import { test, expect } from '../helpers/electron-fixture';
import { SidebarPage } from '../page-objects/SidebarPage';
import { AppPage } from '../page-objects/AppPage';

/**
 * Sidebar Tests
 *
 * These tests verify the Sidebar navigation functionality including
 * navigation items, search, and settings access.
 */
test.describe('Sidebar Navigation', () => {
  let sidebarPage: SidebarPage;
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    sidebarPage = new SidebarPage(page);
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('sidebar renders navigation items', async ({ page }) => {
    // Verify sidebar is visible
    const sidebarVisible = await sidebarPage.isVisible();
    expect(sidebarVisible).toBe(true);

    // The rail leads with Home / Files, then the working-copy sections.
    const home = await page.locator('aside').getByText('Home', { exact: true }).count();
    expect(home).toBeGreaterThan(0);

    const files = await page
      .getByTestId('sidebar-ready')
      .getByText('Files', { exact: true })
      .count();
    expect(files).toBeGreaterThan(0);

    const workingCopies = await page
      .getByTestId('sidebar-ready')
      .getByText('Working copies', { exact: true })
      .count();
    expect(workingCopies).toBeGreaterThan(0);

    // Take screenshot
    await page.screenshot({ path: 'tests/results/sidebar-navigation.png' });
  });

  test('settings button opens SettingsDialog', async ({ page }) => {
    // Find and click settings button using data-testid
    const settingsButton = page.getByTestId('settings-button');
    await settingsButton.click();

    // Wait for modal to appear
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 });

    // Verify modal is visible
    const modalVisible = await page.locator('.modal').isVisible();
    expect(modalVisible).toBe(true);

    // Verify it's a settings dialog (check for settings-related content)
    const modalContent = await page.locator('.modal').textContent();
    expect(
      modalContent?.toLowerCase().includes('settings') ||
        modalContent?.toLowerCase().includes('general') ||
        modalContent?.toLowerCase().includes('appearance')
    ).toBe(true);

    // Close the modal by clicking the close button
    await page.getByTestId('modal-close-button').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 });
  });

  test('add repository button is present', async ({ page }) => {
    // Wait for the sidebar to be fully rendered with the repositories section
    const repositoriesHeader = page.locator('aside').getByText('Working copies', { exact: true });
    await repositoriesHeader.waitFor({ state: 'visible', timeout: 10000 });

    // The + button sits in the "Working copies" section heading.
    const addButton = page.locator('aside button[title="Add repository"]');

    // Wait for the button to be visible with a timeout
    await expect(addButton).toBeVisible({ timeout: 10000 });
  });
});
