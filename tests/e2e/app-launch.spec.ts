import { test, expect } from '../helpers/electron-fixture'
import { AppPage } from '../page-objects/AppPage'

/**
 * App Launch Tests
 * 
 * These tests verify that the Electron application launches correctly
 * and displays the expected initial state.
 */
test.describe('App Launch', () => {
  let appPage: AppPage

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page)
  })

  test('should launch and show welcome screen', async ({ page }) => {
    // Wait for the app to be ready
    await appPage.waitForReady()

    // Verify the root element exists
    await expect(page.locator('#root')).toBeVisible()

    // Verify the main layout is rendered
    await expect(page.locator('.flex.h-screen')).toBeVisible()

    // Verify sidebar is visible
    await expect(page.locator('aside')).toBeVisible()

    // Verify we're showing content (either welcome screen or file explorer)
    const hasContent = await page.locator('main, .flex.flex-col.items-center').count()
    expect(hasContent).toBeGreaterThan(0)

    // Take a screenshot for verification
    await page.screenshot({ path: 'tests/results/app-launch.png' })
  })

  test('should have correct window title', async ({ page }) => {
    // Wait for app to be ready
    await appPage.waitForReady()
    
    // Check page title contains ShellySVN
    const title = await page.title()
    expect(title).toContain('ShellySVN')
  })
})
