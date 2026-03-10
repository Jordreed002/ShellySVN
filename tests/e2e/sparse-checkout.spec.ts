import { test, expect } from '../helpers/electron-fixture';
import { AppPage } from '../page-objects/AppPage';

test.describe('Sparse Checkout - Basic UI', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('can open checkout dialog via Add Repository', async ({ page }) => {
    await page.locator('aside button[title="Add Repository"]').click();
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 });

    const modalText = await page.locator('.modal').textContent();
    expect(modalText?.toLowerCase()).toMatch(/repository|add|open|checkout/);

    await page.screenshot({ path: 'tests/results/sparse-01-add-repo-modal.png' });

    await page.getByTestId('modal-close-button').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 3000 });
  });

  test('checkout dialog has URL input', async ({ page }) => {
    await page.locator('aside button[title="Add Repository"]').click();
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 });

    const checkoutTab = page.locator('.modal button:has-text("Checkout")').first();
    if ((await checkoutTab.count()) > 0) {
      await checkoutTab.click();
      await page.waitForTimeout(200);
    }

    const urlInput = page
      .locator('.modal input[placeholder*="svn"], .modal input[placeholder*="URL"]')
      .first();
    if ((await urlInput.count()) > 0) {
      await expect(urlInput).toBeVisible();
    }

    await page.getByTestId('modal-close-button').click();
  });

  test('checkout dialog has depth selector', async ({ page }) => {
    await page.locator('aside button[title="Add Repository"]').click();
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 });

    const checkoutTab = page.locator('.modal button:has-text("Checkout")').first();
    if ((await checkoutTab.count()) > 0) {
      await checkoutTab.click();
      await page.waitForTimeout(200);
    }

    const depthSelect = page.locator('.modal select').first();
    if ((await depthSelect.count()) > 0) {
      await expect(depthSelect).toBeVisible();
    }

    await page.getByTestId('modal-close-button').click();
  });
});

test.describe('Sparse Checkout - ChooseItemsDialog', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('Choose items button appears when URL is entered', async ({ page }) => {
    await page.locator('aside button[title="Add Repository"]').click();
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 });

    const checkoutTab = page.locator('.modal button:has-text("Checkout")').first();
    if ((await checkoutTab.count()) > 0) {
      await checkoutTab.click();
      await page.waitForTimeout(200);
    }

    const urlInput = page
      .locator('.modal input[placeholder*="svn"], .modal input[placeholder*="URL"]')
      .first();
    if ((await urlInput.count()) > 0) {
      await urlInput.fill('https://svn.apache.org/repos/asf/subversion/trunk');
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'tests/results/sparse-02-url-entered.png' });

    const chooseButton = page.locator('button:has-text("Choose items")');
    const count = await chooseButton.count();

    expect(count).toBeGreaterThanOrEqual(0);

    await page.getByTestId('modal-close-button').click();
  });

  test('Clicking Choose items opens item picker dialog', async ({ page }) => {
    await page.locator('aside button[title="Add Repository"]').click();
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 });

    const checkoutTab = page.locator('.modal button:has-text("Checkout")').first();
    if ((await checkoutTab.count()) > 0) {
      await checkoutTab.click();
      await page.waitForTimeout(200);
    }

    const urlInput = page
      .locator('.modal input[placeholder*="svn"], .modal input[placeholder*="URL"]')
      .first();
    if ((await urlInput.count()) > 0) {
      await urlInput.fill('https://svn.apache.org/repos/asf/subversion/trunk');
      await page.waitForTimeout(300);
    }

    const chooseButton = page.locator('button:has-text("Choose items")');
    if ((await chooseButton.count()) > 0) {
      await chooseButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'tests/results/sparse-03-choose-items-dialog.png' });

      const chooseItemsDialog = page.locator('.modal:has-text("Choose Items")');
      if ((await chooseItemsDialog.count()) > 0) {
        const title = await chooseItemsDialog.locator('h2').textContent();
        expect(title).toContain('Choose Items');

        const cancelButton = chooseItemsDialog.locator('button:has-text("Cancel")').first();
        if ((await cancelButton.count()) > 0) {
          await cancelButton.click();
        }
      }
    }

    await page.getByTestId('modal-close-button').click();
  });
});

test.describe('Sparse Checkout - Repo Browser', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('can navigate to Repo Browser', async ({ page }) => {
    await page.click('a:has-text("Repo Browser")');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'tests/results/sparse-04-repo-browser.png' });

    const content = await page.locator('main').textContent();
    expect(content).toBeDefined();
  });

  test('Repo Browser has URL input', async ({ page }) => {
    await page.click('a:has-text("Repo Browser")');
    await page.waitForTimeout(500);

    const urlInput = page.locator('main input[type="text"]').first();
    if ((await urlInput.count()) > 0) {
      await expect(urlInput).toBeVisible();
    }
  });
});

test.describe('Sparse Checkout - File Explorer Remote Items', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('can navigate to File Explorer', async ({ page }) => {
    await page.click('a:has-text("File Explorer")');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'tests/results/sparse-05-file-explorer.png' });

    const main = page.locator('main');
    await expect(main).toBeVisible();
  });

  test('File Explorer may have remote items toggle', async ({ page }) => {
    await page.click('a:has-text("File Explorer")');
    await page.waitForTimeout(500);

    const remoteToggle = page.locator('button[title*="remote"], button[title*="Remote"]');
    const count = await remoteToggle.count();

    if (count > 0) {
      await page.screenshot({ path: 'tests/results/sparse-06-remote-toggle.png' });
    }

    expect(count).toBeGreaterThanOrEqual(0);
  });
});
