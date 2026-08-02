import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Runs the real-SVN integration suites (`.real.test.ts` and `src/integration/**`).
// The default vitest.config.ts excludes these from the plain unit / coverage run
// because they need a live `svnserve` / docker compatibility lab. This config is
// used by the dedicated `real-svn-workflows` CI job (`bun run verify:svn-workflows`).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.real.test.{ts,tsx}', 'src/integration/**/*.test.{ts,tsx}'],
    deps: {
      interopDefault: true,
    },
    testTimeout: 30000,
    hookTimeout: 30000,
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
