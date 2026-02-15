import { test, expect } from '../helpers/electron-fixture'
import { SidebarPage } from '../page-objects/SidebarPage'
import { AppPage } from '../page-objects/AppPage'

/**
 * Sidebar Tests
 * 
 * These tests verify the Sidebar navigation functionality including
 * navigation items, search, and settings access.
 */
test.describe('Sidebar Navigation', () => {
  let sidebarPage: SidebarPage
  let appPage: AppPage

  test.beforeEach(async ({ page }) => {
    sidebarPage = new SidebarPage(page)
    appPage = new AppPage(page)
    await appPage.waitForReady()
  })

  test('sidebar renders navigation items', async ({ page }) => {
    // Verify sidebar is visible
    const sidebarVisible = await sidebarPage.isVisible()
    expect(sidebarVisible).toBe(true)

    // Check for Quick Access section
    const quickAccess = await page.locator('text=Quick Access').count()
    expect(quickAccess).toBeGreaterThan(0)

    // Check for Browse section
    const browse = await page.locator('text=Browse').count()
    expect(browse).toBeGreaterThan(0)

    // Check for File Explorer link
    const fileExplorer = await page.locator('text=File Explorer').count()
    expect(fileExplorer).toBeGreaterThan(0)

    // Check for History link
    const history = await page.locator('text=History').count()
    expect(history).toBeGreaterThan(0)

    // Take screenshot
    await page.screenshot({ path: 'tests/results/sidebar-navigation.png' })
  })

  test('settings button opens SettingsDialog', async ({ page }) => {
    // Find and click settings button (gear icon in sidebar footer)
    const settingsButton = page.locator('aside button').last()
    await settingsButton.click()

    // Wait for modal to appear
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 })

    // Verify modal is visible
    const modalVisible = await page.locator('.modal').isVisible()
    expect(modalVisible).toBe(true)

    // Verify it's a settings dialog (check for settings-related content)
    const modalContent = await page.locator('.modal').textContent()
    expect(
      modalContent?.toLowerCase().includes('settings') ||
      modalContent?.toLowerCase().includes('general') ||
      modalContent?.toLowerCase().includes('appearance')
    ).toBe(true)

    // Close the modal by clicking the close button
    await page.locator('.modal-header button').first().click()
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 })
  })

  test('add repository button is present', async ({ page }) => {
    // Check for the + button in title bar
    const addButton = page.locator('aside button[title="Add Repository"]')
    const addButtonVisible = await addButton.isVisible()
    expect(addButtonVisible).toBe(true)
  })
})
