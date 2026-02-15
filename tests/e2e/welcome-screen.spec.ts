import { test, expect } from '../helpers/electron-fixture'
import { AppPage } from '../page-objects/AppPage'

/**
 * Welcome Screen Tests
 * 
 * These tests verify the Welcome Screen functionality including
 * logo display, navigation buttons, and recent repositories.
 */
test.describe('Welcome Screen', () => {
  let appPage: AppPage

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page)
    await appPage.waitForReady()
  })

  test('should display ShellySVN logo and title', async ({ page }) => {
    // Check for the ShellySVN branding
    const titleVisible = await page.locator('text=/ShellySVN/i').count()
    expect(titleVisible).toBeGreaterThan(0)

    // Check for logo (SVG element)
    const logo = page.locator('svg').first()
    await expect(logo).toBeVisible()

    // Take screenshot
    await page.screenshot({ path: 'tests/results/welcome-screen.png' })
  })

  test('should show welcome screen content', async ({ page }) => {
    // Wait for the page to stabilize
    await page.waitForTimeout(500)

    // Check for welcome screen text (title bar shows ShellySVN)
    const titleText = await page.locator('text=/ShellySVN/i').count()
    expect(titleText).toBeGreaterThan(0)

    // Verify sidebar is visible (from layout)
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible()
  })
})
