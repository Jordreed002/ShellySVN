import { Page } from '@playwright/test'

/**
 * Common test utilities for ShellySVN E2E tests
 */

/**
 * Wait for an element to be visible and stable
 */
export async function waitForElement(
  page: Page,
  selector: string,
  timeout = 10000,
): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout })
}

/**
 * Click an element and wait for response
 */
export async function clickAndWait(
  page: Page,
  selector: string,
  waitForSelector?: string,
): Promise<void> {
  await page.click(selector)
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { state: 'visible' })
  }
}

/**
 * Get text content from an element
 */
export async function getElementText(page: Page, selector: string): Promise<string> {
  const element = await page.waitForSelector(selector)
  return (await element.textContent()) || ''
}

/**
 * Check if an element exists
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Wait for a modal to be visible
 */
export async function waitForModal(page: Page): Promise<void> {
  await page.waitForSelector('.modal-overlay', { state: 'visible' })
}

/**
 * Close any open modal by clicking the overlay
 */
export async function closeModal(page: Page): Promise<void> {
  const overlay = await page.$('.modal-overlay')
  if (overlay) {
    await overlay.click({ position: { x: 10, y: 10 } }) // Click top-left corner
  }
}

/**
 * Get the sidebar element
 */
export async function getSidebar(page: Page): Promise<import('@playwright/test').Locator> {
  return page.locator('aside').first()
}

/**
 * Navigate to a route using the sidebar
 */
export async function navigateViaSidebar(page: Page, route: string): Promise<void> {
  const sidebar = await getSidebar(page)
  await sidebar.getByRole('link', { name: new RegExp(route, 'i') }).click()
}

/**
 * Take a screenshot with a descriptive name
 */
export async function takeDebugScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `tests/results/${name}.png`, fullPage: true })
}

/**
 * Common selectors used throughout the app
 */
export const selectors = {
  // Layout
  sidebar: 'aside',
  mainContent: 'main',
  toolbar: '.toolbar',
  statusBar: '.status-bar',

  // Welcome Screen
  welcomeScreen: '[data-testid="welcome-screen"], .flex.flex-col.items-center.justify-center',
  shellLogo: 'svg',
  browseButton: 'button:has-text("Browse")',
  checkoutButton: 'button:has-text("Checkout")',

  // Modals
  modalOverlay: '.modal-overlay',
  modal: '.modal',
  modalHeader: '.modal-header',
  modalBody: '.modal-body',
  modalFooter: '.modal-footer',
  modalCloseButton: '.modal-header button',

  // Forms
  input: '.input, input[type="text"]',
  primaryButton: '.btn-primary, button:has-text("Checkout"), button:has-text("Open")',
  secondaryButton: '.btn-secondary',
  cancelButton: 'button:has-text("Cancel")',

  // Sidebar
  sidebarItem: '.tree-item',
  quickAccess: 'text=Quick Access',
  repositories: 'text=SVN Repositories',

  // File Explorer
  fileRow: '.file-row',
  fileName: '.file-name',
  fileStatus: '.svn-status-dot',
}
