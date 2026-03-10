import { Page, Locator } from '@playwright/test';

/**
 * Page object for CheckoutDialog with sparse checkout support
 */
export class CheckoutDialog {
  readonly page: Page;
  readonly modal: Locator;
  readonly header: Locator;
  readonly body: Locator;
  readonly footer: Locator;
  readonly urlInput: Locator;
  readonly directoryInput: Locator;
  readonly revisionInput: Locator;
  readonly depthSelect: Locator;
  readonly chooseItemsButton: Locator;
  readonly checkoutButton: Locator;
  readonly cancelButton: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modal = page.locator('.modal:has-text("Checkout from Repository")').first();
    this.header = this.modal.locator('.modal-header').first();
    this.body = this.modal.locator('.modal-body').first();
    this.footer = this.modal.locator('.modal-footer').first();
    this.urlInput = this.modal
      .locator('input[placeholder*="svn"], input[placeholder*="URL"]')
      .first();
    this.directoryInput = this.modal
      .locator('input[placeholder*="Project"], input[placeholder*="\\\\"]')
      .first();
    this.revisionInput = this.modal.locator('input[value="HEAD"]').first();
    this.depthSelect = this.modal.locator('select').first();
    this.chooseItemsButton = this.modal.locator('button:has-text("Choose items")').first();
    this.checkoutButton = this.modal.locator('button:has-text("Checkout")').last();
    this.cancelButton = this.modal.locator('button:has-text("Cancel")').first();
    this.closeButton = this.header.locator('button').first();
  }

  /**
   * Check if dialog is visible
   */
  async isVisible(): Promise<boolean> {
    try {
      await this.modal.waitFor({ state: 'visible', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Enter repository URL
   */
  async enterUrl(url: string): Promise<void> {
    await this.urlInput.clear();
    await this.urlInput.fill(url);
  }

  /**
   * Enter checkout directory
   */
  async enterDirectory(path: string): Promise<void> {
    await this.directoryInput.clear();
    await this.directoryInput.fill(path);
  }

  /**
   * Set revision
   */
  async setRevision(revision: string): Promise<void> {
    await this.revisionInput.clear();
    await this.revisionInput.fill(revision);
  }

  /**
   * Set checkout depth
   */
  async setDepth(depth: 'infinity' | 'immediates' | 'files' | 'empty'): Promise<void> {
    await this.depthSelect.selectOption(depth);
  }

  /**
   * Click "Choose items..." button
   */
  async clickChooseItems(): Promise<void> {
    // Wait for URL to be filled (Choose items button appears only when URL is set)
    await this.page.waitForTimeout(100);
    await this.chooseItemsButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.chooseItemsButton.click();
  }

  /**
   * Check if Choose Items button is visible
   */
  async isChooseItemsVisible(): Promise<boolean> {
    try {
      await this.chooseItemsButton.waitFor({ state: 'visible', timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click Checkout button
   */
  async clickCheckout(): Promise<void> {
    await this.checkoutButton.click();
  }

  /**
   * Close dialog
   */
  async close(): Promise<void> {
    await this.closeButton.click();
    await this.modal.waitFor({ state: 'hidden' });
  }
}

/**
 * Page object for ChooseItemsDialog (sparse checkout item picker)
 */
export class ChooseItemsDialog {
  readonly page: Page;
  readonly modal: Locator;
  readonly header: Locator;
  readonly body: Locator;
  readonly footer: Locator;
  readonly searchInput: Locator;
  readonly treeContainer: Locator;
  readonly selectAllButton: Locator;
  readonly deselectAllButton: Locator;
  readonly selectButton: Locator;
  readonly cancelButton: Locator;
  readonly closeButton: Locator;
  readonly loadingIndicator: Locator;
  readonly errorContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modal = page.locator('.modal:has-text("Choose Items")').first();
    this.header = this.modal.locator('.modal-header').first();
    this.body = this.modal.locator('.modal-body').first();
    this.footer = this.modal.locator('.modal-footer').first();
    this.searchInput = this.modal.locator('input[placeholder*="Search"]').first();
    this.treeContainer = this.modal.locator('.border, [class*="overflow"]').first();
    this.selectAllButton = this.modal.locator('button:has-text("Select All")').first();
    this.deselectAllButton = this.modal.locator('button:has-text("Deselect All")').first();
    this.selectButton = this.modal.locator('button:has-text("Select")').last();
    this.cancelButton = this.modal.locator('button:has-text("Cancel")').first();
    this.closeButton = this.header.locator('button').first();
    this.loadingIndicator = this.modal.locator('text=Loading, .animate-spin').first();
    this.errorContainer = this.modal.locator('text=Error, text=error, .text-error').first();
  }

  /**
   * Check if dialog is visible
   */
  async isVisible(): Promise<boolean> {
    try {
      await this.modal.waitFor({ state: 'visible', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for tree to load
   */
  async waitForTreeToLoad(timeout = 10000): Promise<boolean> {
    try {
      // Wait for loading to complete
      await this.loadingIndicator.waitFor({ state: 'hidden', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if error is displayed
   */
  async hasError(): Promise<boolean> {
    try {
      await this.errorContainer.waitFor({ state: 'visible', timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get error message
   */
  async getErrorMessage(): Promise<string> {
    return (await this.errorContainer.textContent()) || '';
  }

  /**
   * Search for items
   */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(300); // Wait for filter to apply
  }

  /**
   * Click Select All
   */
  async clickSelectAll(): Promise<void> {
    await this.selectAllButton.click();
  }

  /**
   * Click Deselect All
   */
  async clickDeselectAll(): Promise<void> {
    await this.deselectAllButton.click();
  }

  /**
   * Click Select button to confirm selection
   */
  async clickSelect(): Promise<void> {
    await this.selectButton.click();
  }

  /**
   * Close dialog
   */
  async close(): Promise<void> {
    await this.closeButton.click();
    await this.modal.waitFor({ state: 'hidden' });
  }

  /**
   * Cancel dialog
   */
  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await this.modal.waitFor({ state: 'hidden' });
  }

  /**
   * Get selection count from Select button
   */
  async getSelectionCount(): Promise<number> {
    const text = (await this.selectButton.textContent()) || '';
    const match = text.match(/\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Expand a tree node by clicking on it
   */
  async expandNode(nodeName: string): Promise<void> {
    const node = this.modal.locator(`text="${nodeName}"`).first();
    await node.click();
  }

  /**
   * Select a checkbox for a tree item
   */
  async selectItem(itemName: string): Promise<void> {
    const checkbox = this.modal.locator(`text="${itemName}"`).first();
    await checkbox.click();
  }
}

/**
 * Page object for Repo Browser
 */
export class RepoBrowserPage {
  readonly page: Page;
  readonly container: Locator;
  readonly urlInput: Locator;
  readonly treeContainer: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    this.page = page;
    this.container = page
      .locator('[data-testid="repo-browser"], main:has-text("Repo Browser")')
      .first();
    this.urlInput = this.container.locator('input[type="text"]').first();
    this.treeContainer = this.container.locator('table, .tree, [role="tree"]').first();
    this.loadingIndicator = this.container.locator('.animate-spin, text=Loading').first();
  }

  /**
   * Navigate to repo browser
   */
  async navigateTo(): Promise<void> {
    await this.page.click('a:has-text("Repo Browser")');
    await this.container.waitFor({ state: 'visible' });
  }

  /**
   * Enter repository URL
   */
  async enterUrl(url: string): Promise<void> {
    await this.urlInput.clear();
    await this.urlInput.fill(url);
    await this.page.keyboard.press('Enter');
  }

  /**
   * Wait for repository to load
   */
  async waitForLoad(timeout = 10000): Promise<boolean> {
    try {
      await this.loadingIndicator.waitFor({ state: 'hidden', timeout });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Page object for File Explorer with remote items support
 */
export class FileExplorerWithRemotePage {
  readonly page: Page;
  readonly container: Locator;
  readonly showRemoteToggle: Locator;
  readonly fileTable: Locator;
  readonly remoteItemIndicator: Locator;

  constructor(page: Page) {
    this.page = page;
    this.container = page
      .locator('[data-testid="file-explorer"], main:has-text("File Explorer")')
      .first();
    this.showRemoteToggle = this.container
      .locator('button[title*="remote"], button[title*="Remote"]')
      .first();
    this.fileTable = this.container.locator('table, .file-list, [role="grid"]').first();
    this.remoteItemIndicator = this.container.locator('[class*="remote"], .text-muted').first();
  }

  /**
   * Navigate to file explorer
   */
  async navigateTo(): Promise<void> {
    await this.page.click('a:has-text("File Explorer")');
    await this.container.waitFor({ state: 'visible' });
  }

  /**
   * Toggle show remote items
   */
  async toggleShowRemote(): Promise<void> {
    await this.showRemoteToggle.click();
    await this.page.waitForTimeout(500); // Wait for items to load
  }

  /**
   * Check if remote items toggle exists
   */
  async hasRemoteToggle(): Promise<boolean> {
    try {
      await this.showRemoteToggle.waitFor({ state: 'visible', timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Right-click on an item to open context menu
   */
  async rightClickItem(itemName: string): Promise<void> {
    const item = this.container.locator(`text="${itemName}"`).first();
    await item.click({ button: 'right' });
  }

  /**
   * Click context menu item
   */
  async clickContextMenuItem(itemText: string): Promise<void> {
    const menuItem = this.page
      .locator(
        `[role="menuitem"]:has-text("${itemText}"), .context-menu button:has-text("${itemText}")`
      )
      .first();
    await menuItem.click();
  }
}
