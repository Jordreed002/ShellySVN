import { Page, Locator, expect } from '@playwright/test'

/**
 * Base page object for modal dialogs
 */
export class ModalPage {
  readonly page: Page
  readonly overlay: Locator
  readonly modal: Locator
  readonly header: Locator
  readonly body: Locator
  readonly footer: Locator
  readonly closeButton: Locator

  constructor(page: Page) {
    this.page = page
    this.overlay = page.locator('.modal-overlay').first()
    this.modal = page.locator('.modal').first()
    this.header = this.modal.locator('.modal-header').first()
    this.body = this.modal.locator('.modal-body').first()
    this.footer = this.modal.locator('.modal-footer').first()
    this.closeButton = this.header.locator('button').first()
  }

  /**
   * Check if modal is visible
   */
  async isVisible(): Promise<boolean> {
    try {
      await this.modal.waitFor({ state: 'visible', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get modal title
   */
  async getTitle(): Promise<string> {
    const title = this.header.locator('h2, .modal-title').first()
    return (await title.textContent()) || ''
  }

  /**
   * Close the modal by clicking the X button
   */
  async close(): Promise<void> {
    await this.closeButton.click()
    await this.modal.waitFor({ state: 'hidden' })
  }

  /**
   * Close modal by clicking overlay
   */
  async closeByOverlay(): Promise<void> {
    await this.overlay.click({ position: { x: 10, y: 10 } })
  }

  /**
   * Press Escape to close
   */
  async pressEscape(): Promise<void> {
    await this.page.keyboard.press('Escape')
  }

  /**
   * Get primary action button
   */
  getPrimaryButton(): Locator {
    return this.footer.locator('.btn-primary, button:has-text("Checkout"), button:has-text("Open"), button:has-text("Save")').first()
  }

  /**
   * Get cancel button
   */
  getCancelButton(): Locator {
    return this.footer.locator('button:has-text("Cancel"), .btn-secondary').first()
  }

  /**
   * Click primary button
   */
  async clickPrimary(): Promise<void> {
    await this.getPrimaryButton().click()
  }

  /**
   * Click cancel button
   */
  async clickCancel(): Promise<void> {
    await this.getCancelButton().click()
  }
}

/**
 * Page object for AddRepoModal
 */
export class AddRepoModal extends ModalPage {
  readonly openTab: Locator
  readonly checkoutTab: Locator
  readonly pathInput: Locator
  readonly urlInput: Locator
  readonly browseButton: Locator

  constructor(page: Page) {
    super(page)
    this.openTab = this.modal.locator('button:has-text("Open")').first()
    this.checkoutTab = this.modal.locator('button:has-text("Checkout")').first()
    this.pathInput = this.modal.locator('input[type="text"]').first()
    this.urlInput = this.modal.locator('input[placeholder*="URL"], input[placeholder*="svn"]').first()
    this.browseButton = this.modal.locator('button:has-text("Browse")').first()
  }

  /**
   * Enter a local path
   */
  async enterPath(path: string): Promise<void> {
    await this.pathInput.fill(path)
  }

  /**
   * Enter a repository URL
   */
  async enterUrl(url: string): Promise<void> {
    await this.urlInput.fill(url)
  }

  /**
   * Switch to Open tab
   */
  async switchToOpen(): Promise<void> {
    await this.openTab.click()
  }

  /**
   * Switch to Checkout tab
   */
  async switchToCheckout(): Promise<void> {
    await this.checkoutTab.click()
  }
}

/**
 * Page object for Settings Dialog
 */
export class SettingsDialog extends ModalPage {
  readonly generalTab: Locator
  readonly authTab: Locator
  readonly appearanceTab: Locator

  constructor(page: Page) {
    super(page)
    this.generalTab = this.modal.locator('button:has-text("General"), [data-tab="general"]').first()
    this.authTab = this.modal.locator('button:has-text("Auth"), [data-tab="auth"]').first()
    this.appearanceTab = this.modal.locator('button:has-text("Appearance"), [data-tab="appearance"]').first()
  }

  /**
   * Switch to a specific tab
   */
  async switchToTab(tab: 'general' | 'auth' | 'appearance'): Promise<void> {
    const tabs: Record<string, Locator> = {
      general: this.generalTab,
      auth: this.authTab,
      appearance: this.appearanceTab,
    }
    await tabs[tab].click()
  }
}
