import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      // Include all testable source files
      include: [
        'src/main/ipc/svn.ts',
        'src/main/utils/validation.ts',
        'src/main/auth-cache.ts',
        'src/shared/utils/**/*.ts',
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
        // Target thresholds for Phase 1
        lines: 25,
        functions: 20,
        branches: 25,
        statements: 25,
      },
      perFile: true,
      watermarks: {
        lines: [20, 50],
        functions: [20, 50],
        branches: [20, 50],
        statements: [20, 50],
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@preload': resolve(__dirname, 'src/preload'),
    },
  },
});
