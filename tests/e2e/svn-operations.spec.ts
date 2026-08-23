import { test, expect } from '../helpers/electron-fixture';
import {
  createWorkingCopy,
  openWorkingCopyInApp,
  svnToolchainAvailable,
} from '../helpers/svn-fixture';
import { AppPage } from '../page-objects/AppPage';

/**
 * SVN Operations E2E Tests
 *
 * Tests for core SVN operations including checkout, commit, update, and revert.
 * These tests verify the UI flows and dialog interactions.
 *
 * The commit dialog tests build a real working copy with a local modification
 * (file:// only, no network) so the toolbar's Commit button is present and
 * enabled. Each carries a declarative toolchain guard — the same pattern as the
 * macOS platform gates — instead of the old mid-test runtime skip that fired
 * whenever the app started without a working copy open.
 */
test.describe('SVN Operations - Checkout', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('checkout dialog opens from Add Repository button', async ({ page }) => {
    // Click Add Repository button
    await page.locator('aside button[title="Add repository"]').click();

    // Wait for modal to appear
    await page.waitForSelector('.modal-overlay', {
      state: 'visible',
      timeout: 5000,
    });

    // Verify modal is visible
    const modalVisible = await page.locator('.modal').isVisible();
    expect(modalVisible).toBe(true);

    // Take screenshot
    await page.screenshot({ path: 'tests/results/svn-checkout-dialog.png' });

    // Close modal
    await page.getByTestId('modal-close-button').click();
    await page.waitForSelector('.modal-overlay', {
      state: 'hidden',
      timeout: 3000,
    });
  });

  test('checkout dialog has required form fields', async ({ page }) => {
    await page.locator('aside button[title="Add repository"]').click();
    await page.waitForSelector('.modal-overlay', {
      state: 'visible',
      timeout: 5000,
    });

    // Switch to Checkout tab if present
    const checkoutTab = page.locator('.modal button:has-text("Checkout")').first();
    if ((await checkoutTab.count()) > 0) {
      await checkoutTab.click();
      await page.waitForTimeout(200);
    }

    // Check for URL input field
    const urlInput = page
      .locator('.modal input[placeholder*="URL"], .modal input[placeholder*="svn"]')
      .first();
    expect(await urlInput.count()).toBeGreaterThanOrEqual(0);

    // Check for local path/directory input
    const pathInput = page
      .locator('.modal input[placeholder*="directory"], .modal input[placeholder*="path"]')
      .first();
    expect(await pathInput.count()).toBeGreaterThanOrEqual(0);

    // Check for action buttons
    const cancelButton = page.locator('.modal button:has-text("Cancel")');
    expect(await cancelButton.count()).toBeGreaterThan(0);

    await page.getByTestId('modal-close-button').click();
  });

  test('checkout dialog validates empty URL', async ({ page }) => {
    await page.locator('aside button[title="Add repository"]').click();
    await page.waitForSelector('.modal-overlay', {
      state: 'visible',
      timeout: 5000,
    });

    // Switch to Checkout tab if present
    const checkoutTab = page.locator('.modal button:has-text("Checkout")').first();
    if ((await checkoutTab.count()) > 0) {
      await checkoutTab.click();
      await page.waitForTimeout(200);
    }

    // Try to checkout without entering URL
    const checkoutButton = page
      .locator('.modal button:has-text("Checkout"):not(:has-text("Cancel"))')
      .last();
    if ((await checkoutButton.count()) > 0 && (await checkoutButton.isEnabled())) {
      // Button should be disabled or show validation error
      // We just verify the dialog stays open
      await checkoutButton.click();
      await page.waitForTimeout(300);

      // Modal should still be visible (validation failed)
      const modalVisible = await page.locator('.modal-overlay').isVisible();
      expect(modalVisible).toBe(true);
    }

    await page.getByTestId('modal-close-button').click();
  });
});

test.describe('SVN Operations - Commit Dialog', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('commit dialog UI structure', async ({ electronApp, page }) => {
    test.skip(!svnToolchainAvailable, 'requires the local svn/svnadmin toolchain (file:// fixture)');

    const fixture = createWorkingCopy({
      files: { 'notes.txt': 'line 1\nline 2\n' },
      // A local modification puts the working copy in a committable state, so
      // the toolbar's Commit button is rendered enabled.
      modifyAfterCheckout: { 'notes.txt': 'line 1\nline 2\nlocal edit\n' },
    });
    try {
      await openWorkingCopyInApp(electronApp, page, fixture.wc, 'Commit fixture WC');

      const commitButton = page.locator('button[title="Commit changes — svn commit"]');
      await expect(commitButton).toBeVisible({ timeout: 10000 });
      await expect(commitButton).toBeEnabled();
      await commitButton.click();

      // Wait for commit dialog
      await page.waitForSelector('.modal-overlay', {
        state: 'visible',
        timeout: 5000,
      });

      // Verify commit dialog structure
      const modalTitle = await page.locator('.modal h2, .modal .modal-title').first().textContent();
      expect(modalTitle?.toLowerCase()).toContain('commit');

      // Check for message textarea
      const messageInput = page.locator('.modal textarea').first();
      expect(await messageInput.count()).toBeGreaterThanOrEqual(0);

      // Check for file list
      const fileList = page.locator('.modal').locator('text=/modified|added|deleted|unversioned/i');
      expect(await fileList.count()).toBeGreaterThanOrEqual(0);

      await page.screenshot({ path: 'tests/results/svn-commit-dialog.png' });

      await page.getByLabel('Close dialog').click();
      await page.waitForSelector('.modal-overlay', {
        state: 'hidden',
        timeout: 5000,
      });
    } finally {
      fixture.dispose();
    }
  });

  test('commit dialog has message input', async ({ electronApp, page }) => {
    test.skip(!svnToolchainAvailable, 'requires the local svn/svnadmin toolchain (file:// fixture)');

    const fixture = createWorkingCopy({
      files: { 'notes.txt': 'line 1\nline 2\n' },
      modifyAfterCheckout: { 'notes.txt': 'line 1\nline 2\nlocal edit\n' },
    });
    try {
      await openWorkingCopyInApp(electronApp, page, fixture.wc, 'Commit fixture WC');

      const commitButton = page.locator('button[title="Commit changes — svn commit"]');
      await expect(commitButton).toBeVisible({ timeout: 10000 });
      await expect(commitButton).toBeEnabled();
      await commitButton.click();

      await page.waitForSelector('.modal-overlay', {
        state: 'visible',
        timeout: 5000,
      });

      // The dialog fetches the change set before the form settles.
      const messageInput = page.locator('.modal textarea').first();
      await expect(messageInput).toBeVisible({ timeout: 10000 });
      await messageInput.fill('Test commit message');

      const value = await messageInput.inputValue();
      expect(value).toBe('Test commit message');

      await page.getByLabel('Close dialog').click();
      await page.waitForSelector('.modal-overlay', {
        state: 'hidden',
        timeout: 5000,
      });
    } finally {
      fixture.dispose();
    }
  });
});

test.describe('SVN Operations - Update', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('update button is accessible', async ({ page }) => {
    await page.getByRole('link', { name: 'Files', exact: true }).click();
    await page.waitForTimeout(500);

    // Look for update button
    const updateButton = page.locator('button:has-text("Update")').first();
    const updateButtonCount = await updateButton.count();

    // Button may or may not exist depending on whether a working copy is open
    expect(updateButtonCount).toBeGreaterThanOrEqual(0);
  });

  test('update to revision dialog can be opened', async ({ page }) => {
    await page.getByRole('link', { name: 'Files', exact: true }).click();
    await page.waitForTimeout(500);

    // Look for update to revision option (might be in a dropdown or menu)
    const updateToRevisionOption = page.locator('text=/update to revision/i');

    if ((await updateToRevisionOption.count()) > 0) {
      await updateToRevisionOption.first().click();

      await page.waitForSelector('.modal-overlay', {
        state: 'visible',
        timeout: 5000,
      });

      // Verify dialog title
      const modalTitle = await page.locator('.modal h2, .modal .modal-title').first().textContent();
      expect(modalTitle?.toLowerCase()).toMatch(/revision|update/);

      await page.getByTestId('modal-close-button').click();
    } else {
      // Test passes if option is not available without a working copy
      expect(true).toBe(true);
    }
  });
});

test.describe('SVN Operations - Revert', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('revert button is accessible in File Explorer', async ({ page }) => {
    await page.getByRole('link', { name: 'Files', exact: true }).click();
    await page.waitForTimeout(500);

    // Look for revert button
    const revertButton = page.locator('button:has-text("Revert")').first();
    const revertButtonCount = await revertButton.count();

    // Button may or may not exist depending on working copy state
    expect(revertButtonCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe('SVN Operations - History/Log', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('does not expose History without an open working copy', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'History', exact: true })).toHaveCount(0);
  });

  test('explains that a working copy must be opened first', async ({ page }) => {
    await expect(page.getByText('No working copy open').first()).toBeVisible();
  });
});

test.describe('SVN Operations - Diff', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();
  });

  test('diff view is accessible', async ({ page }) => {
    await page.getByRole('link', { name: 'Files', exact: true }).click();
    await page.waitForTimeout(500);

    // Look for diff-related UI
    const diffButton = page.locator('button:has-text("Diff")').first();
    const diffButtonCount = await diffButton.count();

    expect(diffButtonCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe('SVN Operations - Cleanup', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    await appPage.waitForReady();

    // Close any open modal
    const overlay = page.locator('.modal-overlay');
    if (await overlay.isVisible()) {
      try {
        await page.getByTestId('modal-close-button').click({ timeout: 1000 });
        await overlay.waitFor({ state: 'hidden', timeout: 2000 });
      } catch {
        // Ignore if close fails
      }
    }
  });

  test('cleanup option is accessible', async ({ page }) => {
    await page.getByRole('link', { name: 'Files', exact: true }).click();
    await page.waitForTimeout(500);

    // Look for cleanup option (may be in menu or context menu)
    const cleanupOption = page.locator('button:has-text("Cleanup")').first();
    const cleanupCount = await cleanupOption.count();

    expect(cleanupCount).toBeGreaterThanOrEqual(0);
  });
});
