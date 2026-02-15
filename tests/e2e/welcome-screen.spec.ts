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

  test('should have action buttons on welcome screen', async ({ page }) => {
    // Wait for the page to stabilize
    await page.waitForTimeout(1000)

    // Check for Browse button
    const browseButton = page.getByRole('button', { name: /browse/i })
    const browseCount = await browseButton.count()
    expect(browseCount).toBeGreaterThan(0)

    // Check for Checkout button  
    const checkoutButton = page.getByRole('button', { name: /checkout/i })
    const checkoutCount = await checkoutButton.count()
    expect(checkoutCount).toBeGreaterThan(0)
  })

  test('Browse button should open AddRepoModal', async ({ page }) => {
    // Wait for the page to stabilize
    await page.waitForTimeout(1000)

    // Find and click Browse button (use more specific selector)
    const browseButton = page.locator('button').filter({ hasText: 'Browse' }).first()
    await browseButton.click()

    // Wait for modal to appear
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 10000 })

    // Verify modal is visible
    const modalVisible = await page.locator('.modal').isVisible()
    expect(modalVisible).toBe(true)

    // Verify modal title contains relevant text
    const modalTitle = await page.locator('.modal-header h2, .modal-title').first().textContent()
    expect(modalTitle?.toLowerCase()).toMatch(/repository|add|open/)

    // Close the modal by clicking close button
    await page.locator('.modal-header button').first().click()
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 })
  })
})
