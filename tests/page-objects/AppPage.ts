import { Page, Locator } from '@playwright/test'

/**
 * Base page object for ShellySVN app
 */
export class AppPage {
  readonly page: Page
  readonly root: Locator
  readonly sidebar: Locator
  readonly mainContent: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.locator('#root')
    this.sidebar = page.locator('aside').first()
    this.mainContent = page.locator('main').first()
  }

  /**
   * Navigate to a specific route
   */
  async navigateTo(route: '/' | '/files' | '/history'): Promise<void> {
    await this.page.goto(`app://-/#${route}`)
  }

  /**
   * Wait for the app to be fully loaded
   */
  async waitForReady(): Promise<void> {
    await this.root.waitFor({ state: 'attached' })
    await this.page.waitForSelector('.flex.h-screen', { timeout: 10000 })
  }

  /**
   * Take a screenshot for debugging
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `tests/results/${name}.png` })
  }

  /**
   * Check if we're on the welcome screen
   */
  async isOnWelcomeScreen(): Promise<boolean> {
    const welcomeText = await this.page.locator('text=ShellySVN').count()
    return welcomeText > 0
  }

  /**
   * Get the window title
   */
  async getTitle(): Promise<string> {
    return await this.page.title()
  }
}
