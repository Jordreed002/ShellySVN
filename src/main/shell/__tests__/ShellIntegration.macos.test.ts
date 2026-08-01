// @vitest-environment node

/*
 * macOS shell-integration surface. The host platform is forced to darwin so the
 * macOS branch of getStatus()/getHelperPath()/register() runs deterministically
 * regardless of where the suite executes. existsSync stays mocked false (missing
 * Finder Sync helper) — the documented first-run state until a packaged build
 * installs the app extension. Mirrors the sibling "Windows" describe block.
 */
import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/shellysvn-user-data'),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../utils/debug', () => ({
  default: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

import { ShellIntegrationManager } from '../ShellIntegration';

describe('ShellIntegrationManager — macOS', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  it('resolves the helper path to the Finder Sync extension', () => {
    const status = new ShellIntegrationManager().getStatus();

    expect(status.helperPath?.endsWith('ShellySVNFinderSync')).toBe(true);
  });

  it('reports macOS as the platform with Finder badges gated on registration', () => {
    const status = new ShellIntegrationManager().getStatus();

    expect(status.platform).toBe('macos');
    expect(status.supported).toBe(true);
    expect(status.registered).toBe(false);
    expect(status.helperExists).toBe(false);
    // Icon overlays are a Windows-only feature; macOS surfaces status as badges.
    expect(status.iconOverlaysAvailable).toBe(false);
    // Finder badges require registration, and the helper is missing here.
    expect(status.finderBadgesAvailable).toBe(false);
    // macOS registration does not require elevation (unlike Windows).
    expect(status.needsAdmin).toBe(false);
    expect(status.fallbackAvailable).toBe(true);
  });

  it('surfaces the macOS missing-helper repair guidance and badge limitation', () => {
    const status = new ShellIntegrationManager().getStatus();

    expect(status.message).toContain('macOS Finder Sync helper is missing');
    expect(
      status.repairActions.some((action) => action.includes('ShellySVN Finder Sync extension'))
    ).toBe(true);
    expect(status.limitations).toContain(
      'Finder Sync badge availability depends on macOS extension permissions.'
    );
  });

  it('refuses to register when the Finder Sync helper is missing', async () => {
    const result = await new ShellIntegrationManager().register();

    expect(result.success).toBe(false);
    expect(result.error).toContain('macOS Finder Sync helper is missing');
    // notifyWindowsHelper is Windows-only, so nothing is spawned on macOS.
    expect(spawn).not.toHaveBeenCalled();
  });

  it('caches overlay status on macOS without invoking a native helper', async () => {
    const manager = new ShellIntegrationManager();

    await manager.updateOverlay('/wc/file.ts', 'M');

    expect(manager.getCachedStatus('/wc/file.ts')).toBe('M');
    expect(spawn).not.toHaveBeenCalled();
  });
});
