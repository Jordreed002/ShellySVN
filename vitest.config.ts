import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      // Focus coverage on testable parsing functions
      include: [
        'src/main/ipc/svn.ts'
      ],
      exclude: [
        'src/**/__tests__/**',
        'src/**/types.ts',
        'src/**/*.d.ts',
        'src/**/index.ts',
      ],
      all: true,
      thresholds: {
        // Focus on parsing functions coverage - the IPC handlers require
        // Electron mocking which is complex and best tested via E2E tests
        // Note: These thresholds reflect ACTUAL coverage of production code
        // (not re-implemented test code)
        lines: 19,
        functions: 10,
        branches: 23,
        statements: 18
      },
      perFile: true,
      watermarks: {
        lines: [15, 30],
        functions: [10, 25],
        branches: [20, 35],
        statements: [15, 30]
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@preload': resolve(__dirname, 'src/preload')
    }
  }
})
