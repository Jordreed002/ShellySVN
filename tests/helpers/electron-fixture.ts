import { test as base, ElectronApplication, Page, _electron as electron } from '@playwright/test'
import { join } from 'path'

/**
 * Custom fixtures for Electron app testing
 */
type ElectronTestFixtures = {
  /** The Electron application instance */
  electronApp: ElectronApplication
  /** The main window page */
  page: Page
}

/**
 * Extended test fixture with Electron support
 * 
 * Usage:
 * ```typescript
 * import { test, expect } from './helpers/electron-fixture'
 * 
 * test('my test', async ({ page }) => {
 *   // page is the main Electron window
 * })
 * ```
 */
export const test = base.extend<ElectronTestFixtures>({
  // Launch Electron app once per worker
  electronApp: async ({}, use) => {
    // Path to the built Electron main process
    const mainPath = join(process.cwd(), 'out', 'main', 'index.js')
    
    // Launch the Electron app
    const electronApp = await electron.launch({
      args: [mainPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    })

    // Capture console logs from main process
    electronApp.on('console', (msg) => {
      const type = msg.type()
      const text = msg.text()
      
      // Filter out noisy messages
      if (text.includes('[DEV]') || text.includes('HMR')) return
      
      if (type === 'error') {
        console.error(`[Electron Main] ${text}`)
      } else if (type === 'warning') {
        console.warn(`[Electron Main] ${text}`)
      } else {
        console.log(`[Electron Main] ${text}`)
      }
    })

    // Capture errors
    electronApp.on('close', () => {
      console.log('[Electron] Application closed')
    })

    await use(electronApp)

    // Cleanup
    await electronApp.close()
  },

  // Get the first window as the page
  page: async ({ electronApp }, use) => {
    // Wait for the first window to appear
    const page = await electronApp.firstWindow()
    
    // Wait for the page to be ready
    await page.waitForLoadState('domcontentloaded')
    
    // Additional wait for React to hydrate
    await page.waitForTimeout(1000)
    
    // Capture console logs from renderer
    page.on('console', (msg) => {
      const type = msg.type()
      const text = msg.text()
      
      // Filter out noisy messages
      if (text.includes('[HMR]') || text.includes('[vite]')) return
      
      if (type === 'error') {
        console.error(`[Renderer] ${text}`)
      } else {
        console.log(`[Renderer] ${text}`)
      }
    })

    // Capture page errors
    page.on('pageerror', (error) => {
      console.error(`[Renderer Error] ${error.message}`)
    })

    await use(page)
  },
})

// Re-export expect for convenience
export { expect } from '@playwright/test'

/**
 * Helper to wait for the app to be fully loaded
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for the root element to have content
  await page.waitForSelector('#root', { state: 'attached' })
  
  // Wait for the main content to load (WelcomeScreen or FileExplorer)
  await page.waitForSelector('[data-testid="welcome-screen"], [data-testid="file-explorer"], .flex.h-screen', {
    timeout: 10000,
  })
}
