import { Page, Locator } from '@playwright/test'

/**
 * Page object for the Welcome Screen
 */
export class WelcomePage {
  readonly page: Page
  readonly container: Locator
  readonly logo: Locator
  readonly title: Locator
  readonly browseButton: Locator
  readonly checkoutButton: Locator
  readonly recentReposSection: Locator
  readonly dropZone: Locator

  constructor(page: Page) {
    this.page = page
    this.container = page.locator('.flex.flex-col.items-center.justify-center, [data-testid="welcome-screen"]').first()
    this.logo = page.locator('svg').first()
    this.title = page.locator('text=ShellySVN')
    this.browseButton = page.locator('button:has-text("Browse")').first()
    this.checkoutButton = page.locator('button:has-text("Checkout")').first()
    this.recentReposSection = page.locator('text=/Recent|History/i').first()
    this.dropZone = page.locator('.drop-zone').first()
  }

  /**
   * Check if the welcome screen is visible
   */
  async isVisible(): Promise<boolean> {
    try {
      await this.container.waitFor({ state: 'visible', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Click the Browse button to open AddRepoModal
   */
  async clickBrowse(): Promise<void> {
    await this.browseButton.click()
  }

  /**
   * Click the Checkout button to open CheckoutDialog
   */
  async clickCheckout(): Promise<void> {
    await this.checkoutButton.click()
  }

  /**
   * Get welcome screen title text
   */
  async getTitleText(): Promise<string> {
    const title = this.page.locator('h1, h2').first()
    return (await title.textContent()) || ''
  }

  /**
   * Check if logo is visible
   */
  async isLogoVisible(): Promise<boolean> {
    try {
      await this.logo.waitFor({ state: 'visible', timeout: 2000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get recent repositories list
   */
  async getRecentRepos(): Promise<string[]> {
    const repos = await this.page.locator('[class*="recent"] li, .recent-repos li, [data-testid="recent-repo"]').all()
    const texts: string[] = []
    for (const repo of repos) {
      const text = await repo.textContent()
      if (text) texts.push(text.trim())
    }
    return texts
  }

  /**
   * Click on a recent repository
   */
  async clickRecentRepo(repoName: string): Promise<void> {
    await this.page.locator(`text="${repoName}"`).click()
  }
}
