import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'packages/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/.{idea,git,cache,output,temp}/**',
      // Real-SVN integration tests need a live `svnserve` / docker compatibility
      // lab and are exercised by the dedicated `real-svn-workflows` CI job
      // (`bun run verify:svn-workflows`). They must not run in the plain unit /
      // coverage run, which has no SVN toolchain provisioned for them.
      '**/*.real.test.{ts,tsx}',
      'src/integration/**',
    ],
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
        // Presentational React surfaces are covered by component/E2E tests rather
        // than the unit-test coverage baseline for application logic.
        'src/renderer/src/features/**/components/**',
        'src/renderer/src/features/**/*Screen.tsx',
        'src/renderer/src/features/**/*View.tsx',
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
