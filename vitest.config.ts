import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'packages/**/__tests__/**/*.test.{ts,tsx}'],
    // Allow mocking of Node.js built-in modules
    deps: {
      interopDefault: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      // Include all testable source files
      include: [
        'src/main/ipc/svn.ts',
        'src/main/utils/validation.ts',
        'src/main/auth-cache.ts',
        'src/renderer/src/features/**/*.ts',
        'src/renderer/src/features/**/*.tsx',
        'packages/shared/src/utils/**/*.ts',
        'packages/logic-engine/src/**/*.ts',
      ],
      exclude: [
        'src/**/__tests__/**',
        'src/**/types.ts',
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/__test-utils__/**',
      ],
      all: true,
      thresholds: {
        // Current global baseline after the Phase 1-3 module extraction work.
        lines: 50,
        functions: 40,
        branches: 55,
        statements: 50,
      },
      perFile: true,
      watermarks: {
        lines: [50, 80],
        functions: [40, 75],
        branches: [55, 80],
        statements: [50, 80],
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'packages/shared/src'),
      '@main': resolve(__dirname, 'src/main'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@test-utils': resolve(__dirname, 'src/__test-utils__'),
    },
  },
});
