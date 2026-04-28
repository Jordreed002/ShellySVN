/**
 * Tests for Path Utilities
 *
 * Tests binary path resolution and resource path utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBinaryPath, getResourcesPath } from '../paths';

describe('paths utilities', () => {
  const originalEnv = process.env;
  const originalResourcesPath = process.resourcesPath;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  describe('getBinaryPath', () => {
    describe('development mode', () => {
      it('should return binary name in development mode', () => {
        // ELECTRON_RUN_AS_NODE is not set in dev mode
        delete process.env.ELECTRON_RUN_AS_NODE;

        const result = getBinaryPath('svn');

        // In dev mode, it returns just the name to use system PATH
        expect(result).toBe('svn');
      });

      it('should work with any binary name', () => {
        delete process.env.ELECTRON_RUN_AS_NODE;

        const result = getBinaryPath('myspecialbinary');

        expect(result).toBe('myspecialbinary');
      });
    });

    describe('production mode', () => {
      it('should return production path with resourcesPath', () => {
        // Set ELECTRON_RUN_AS_NODE to simulate production mode
        process.env.ELECTRON_RUN_AS_NODE = 'true';

        // We need to re-import the module to get fresh values
        return import('../paths').then(({ getBinaryPath }) => {
          const result = getBinaryPath('svn');

          // Should include resources/binaries in the path
          expect(result).toContain('binaries');
          expect(result).toContain('svn');
        });
      });

      it('should add .exe extension on Windows', () => {
        process.env.ELECTRON_RUN_AS_NODE = 'true';

        // Mock Windows platform
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          writable: true,
          configurable: true,
        });

        return import('../paths').then(({ getBinaryPath }) => {
          const result = getBinaryPath('svn');

          expect(result).toContain('svn.exe');
        });
      });

      it('should not add .exe extension on non-Windows platforms', () => {
        process.env.ELECTRON_RUN_AS_NODE = 'true';

        // Mock non-Windows platform
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          writable: true,
          configurable: true,
        });

        return import('../paths').then(({ getBinaryPath }) => {
          const result = getBinaryPath('svn');

          expect(result).not.toContain('.exe');
          expect(result).toContain('svn');
        });
      });

      it('should use fallback path when resourcesPath is not set', () => {
        process.env.ELECTRON_RUN_AS_NODE = 'true';

        // Clear resourcesPath
        delete (process as Record<string, unknown>).resourcesPath;

        return import('../paths').then(({ getBinaryPath }) => {
          const result = getBinaryPath('svn');

          // Should still work with fallback
          expect(result).toContain('binaries');
          expect(result).toContain('svn');
        });
      });
    });
  });

  describe('getResourcesPath', () => {
    it('should return process.resourcesPath when available', () => {
      const mockResourcesPath = '/app/resources';
      Object.defineProperty(process, 'resourcesPath', {
        value: mockResourcesPath,
        writable: true,
        configurable: true,
      });

      const result = getResourcesPath();

      expect(result).toBe(mockResourcesPath);
    });

    it('should return fallback path when resourcesPath is not available', () => {
      // Clear resourcesPath
      delete (process as Record<string, unknown>).resourcesPath;

      const result = getResourcesPath();

      // Should return a path relative to the module
      expect(result).toContain('resources');
    });
  });
});
