import { test, expect } from '../helpers/electron-fixture'
import { AddRepoModal, SettingsDialog } from '../page-objects/ModalPage'
import { SidebarPage } from '../page-objects/SidebarPage'
import { AppPage } from '../page-objects/AppPage'

/**
 * Modal Dialog Tests
 * 
 * These tests verify modal dialog functionality including
 * opening, closing, and basic interactions.
 */
test.describe('Modal Dialogs', () => {
  let appPage: AppPage
  let sidebarPage: SidebarPage

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page)
    sidebarPage = new SidebarPage(page)
    await appPage.waitForReady()
  })

  test('AddRepoModal opens and closes correctly', async ({ page }) => {
    // Open modal from sidebar
    await sidebarPage.clickAddRepository()

    // Wait for modal
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 })

    // Create modal page object
    const addRepoModal = new AddRepoModal(page)

    // Verify modal is visible
    const isVisible = await addRepoModal.isVisible()
    expect(isVisible).toBe(true)

    // Verify modal has expected content
    const title = await addRepoModal.getTitle()
    expect(title.toLowerCase()).toMatch(/repository|add|open|checkout/)

    // Verify modal has input fields
    const hasInput = await page.locator('.modal input').count()
    expect(hasInput).toBeGreaterThan(0)

    // Verify cancel button exists
    const cancelButton = addRepoModal.getCancelButton()
    await expect(cancelButton).toBeVisible()

    // Close modal by clicking close button
    await page.locator('.modal-header button').first().click()

    // Verify modal is closed
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 })

    // Take screenshot
    await page.screenshot({ path: 'tests/results/modal-closed.png' })
  })

  test('modal can be closed by clicking overlay', async ({ page }) => {
    // Open modal
    await sidebarPage.clickAddRepository()
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 })

    // Click overlay to close
    const overlay = page.locator('.modal-overlay')
    await overlay.click({ position: { x: 10, y: 10 } })

    // Verify modal is closed
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 })
  })

  test('Settings dialog has expected tabs', async ({ page }) => {
    // Open settings from sidebar
    await sidebarPage.clickSettings()
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 })

    // Create settings dialog object
    const settingsDialog = new SettingsDialog(page)

    // Verify dialog is visible
    const isVisible = await settingsDialog.isVisible()
    expect(isVisible).toBe(true)

    // Look for settings-related tabs or content
    const modalContent = await page.locator('.modal').textContent()
    
    // Should have at least one of these settings sections
    const hasSettingsContent = 
      modalContent?.toLowerCase().includes('general') ||
      modalContent?.toLowerCase().includes('appearance') ||
      modalContent?.toLowerCase().includes('auth') ||
      modalContent?.toLowerCase().includes('theme')

    expect(hasSettingsContent).toBe(true)

    // Close dialog by clicking close button
    await page.locator('.modal-header button').first().click()
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 })
  })
})
