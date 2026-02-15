import { Page, Locator } from '@playwright/test'

/**
 * Page object for the Sidebar navigation
 */
export class SidebarPage {
  readonly page: Page
  readonly container: Locator
  readonly titleBar: Locator
  readonly addButton: Locator
  readonly searchInput: Locator
  readonly settingsButton: Locator
  readonly quickAccessSection: Locator
  readonly repositoriesSection: Locator

  constructor(page: Page) {
    this.page = page
    this.container = page.locator('aside').first()
    this.titleBar = this.container.locator('.h-\\[--titlebar-height\\]').first()
    this.addButton = this.container.locator('button[title="Add Repository"]').first()
    this.searchInput = this.container.locator('input[placeholder*="Search"]').first()
    this.settingsButton = this.container.locator('button:has(svg[class*="Settings"]), button').last()
    this.quickAccessSection = this.container.locator('text=Quick Access').first()
    this.repositoriesSection = this.container.locator('text=SVN Repositories').first()
  }

  /**
   * Check if sidebar is visible
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
   * Click the Add Repository button
   */
  async clickAddRepository(): Promise<void> {
    await this.addButton.click()
  }

  /**
   * Search for a repository
   */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query)
  }

  /**
   * Clear search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear()
  }

  /**
   * Get all navigation items
   */
  async getNavigationItems(): Promise<string[]> {
    const items = await this.container.locator('.tree-item, a, nav button').all()
    const texts: string[] = []
    for (const item of items) {
      const text = await item.textContent()
      if (text) texts.push(text.trim())
    }
    return texts
  }

  /**
   * Navigate to File Explorer
   */
  async navigateToFiles(): Promise<void> {
    await this.container.locator('text=File Explorer, a:has-text("File")').first().click()
  }

  /**
   * Navigate to History
   */
  async navigateToHistory(): Promise<void> {
    await this.container.locator('text=History, a:has-text("History")').first().click()
  }

  /**
   * Click settings button
   */
  async clickSettings(): Promise<void> {
    // Settings is usually the last button in the sidebar
    await this.settingsButton.click()
  }

  /**
   * Get repository list
   */
  async getRepositories(): Promise<string[]> {
    const repos = await this.container.locator('[class*="repo"], li').all()
    const texts: string[] = []
    for (const repo of repos) {
      const text = await repo.textContent()
      if (text && !text.includes('SVN Repositories')) {
        texts.push(text.trim())
      }
    }
    return texts
  }

  /**
   * Check if a specific repository is in the list
   */
  async hasRepository(repoPath: string): Promise<boolean> {
    const count = await this.container.locator(`text="${repoPath}"`).count()
    return count > 0
  }
}
