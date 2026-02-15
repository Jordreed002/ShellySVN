import { defineConfig } from '@playwright/test'
import { join } from 'path'

/**
 * Playwright Configuration for ShellySVN Electron App
 * 
 * This configuration is optimized for testing Electron applications.
 * Tests run sequentially (fullyParallel: false) because Electron apps
 * typically share global state.
 */
export default defineConfig({
  // Test directory
  testDir: './e2e',
  
  // Run tests sequentially (Electron apps share state)
  fullyParallel: false,
  
  // Fail build on CI if you accidentally left test.only in source code
  forbidOnly: !!process.env.CI,
  
  // Retry failed tests once
  retries: process.env.CI ? 2 : 0,
  
  // Limit workers for Electron (1 worker is safest)
  workers: 1,
  
  // Test timeout (Electron launches can be slow)
  timeout: 30000,
  
  // Expect timeout
  expect: {
    timeout: 10000,
  },
  
  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { open: 'never', outputDir: 'tests/report' }],
  ],
  
  // Global test settings
  use: {
    // Capture trace on failure for debugging
    trace: 'retain-on-failure',
    
    // Capture screenshot on failure
    screenshot: 'only-on-failure',
    
    // Capture video on failure
    video: 'retain-on-failure',
    
    // Base URL for navigation (not used for Electron but good practice)
    baseURL: 'app://-',
  },
  
  // Configure projects
  projects: [
    {
      name: 'electron',
      use: {
        // Electron-specific settings will be in the fixture
      },
    },
  ],
  
  // Output directory for test artifacts
  outputDir: 'tests/results',
  
  // No web server needed for Electron apps
  // The app is launched directly via the fixture
})
