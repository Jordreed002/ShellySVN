// @vitest-environment node

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

vi.mock('child_process', () => {
  return {
    spawn: vi.fn(),
  };
});

vi.mock('../../utils/debug', () => ({
  default: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  createFileManagerHandoffUrl,
  FILE_MANAGER_STATUS_PRESENTATION,
  FINDER_BADGE_STATUS_MAP,
  FINDER_CONTEXT_MENU_COMMANDS,
  getFileManagerPresentationStatus,
  OVERLAY_STATUS_MAP,
  ShellIntegrationManager,
  WINDOWS_CONTEXT_MENU_COMMANDS,
} from '../ShellIntegration';

describe('ShellIntegrationManager', () => {
  it('reports missing native helper with app fallback guidance', () => {
    const manager = new ShellIntegrationManager();
    const status = manager.getStatus();

    expect(status.registered).toBe(false);
    expect(status.helperExists).toBe(false);
    expect(status.fallbackAvailable).toBe(true);
    expect(status.repairActions.length).toBeGreaterThan(0);
    expect(status.limitations.length).toBeGreaterThan(0);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      expect(status.supported).toBe(true);
      expect(status.helperPath).toBeTruthy();
      expect(status.message).toContain('helper is missing');
    } else {
      expect(status.supported).toBe(false);
      expect(status.helperPath).toBeNull();
      expect(status.message).toContain('not supported');
    }
  });

  it('defines Windows Explorer commands for common working-copy actions', () => {
    expect(WINDOWS_CONTEXT_MENU_COMMANDS).toEqual([
      'checkout',
      'update',
      'commit',
      'diff',
      'log',
      'revert',
      'cleanup',
      'resolve',
      'lock',
      'unlock',
      'branch-tag',
      'switch',
      'merge',
      'properties',
    ]);
  });

  it('defines Windows overlay icons for the full SVN status set', () => {
    expect(Object.keys(OVERLAY_STATUS_MAP).sort()).toEqual(
      [' ', '!', '?', 'A', 'C', 'D', 'I', 'M', 'O', 'R', 'X', '~'].sort()
    );
    expect(OVERLAY_STATUS_MAP.C.icon).toBe('conflict');
    expect(OVERLAY_STATUS_MAP['!'].icon).toBe('missing');
    expect(OVERLAY_STATUS_MAP.X.icon).toBe('external');
  });

  it('defines Finder commands and badge statuses supported by Finder Sync', () => {
    expect(FINDER_CONTEXT_MENU_COMMANDS).toEqual([
      'checkout',
      'update',
      'commit',
      'diff',
      'log',
      'revert',
      'cleanup',
      'resolve',
      'lock',
      'unlock',
      'branch-tag',
      'switch',
      'merge',
      'properties',
    ]);
    expect(FINDER_BADGE_STATUS_MAP).toMatchObject({
      ' ': 'normal',
      A: 'added',
      C: 'conflicted',
      M: 'modified',
      X: 'external',
      '?': 'unversioned',
      '!': 'missing',
    });
  });

  it('defines file-manager presentation for locked items separately from SVN text status', () => {
    expect(FILE_MANAGER_STATUS_PRESENTATION.locked).toMatchObject({
      windowsIcon: 'locked',
      finderBadge: 'locked',
      label: 'Locked',
    });

    expect(
      getFileManagerPresentationStatus({
        status: ' ',
        lock: { owner: 'jordan', comment: 'editing', date: '2026-05-01T10:00:00Z' },
      })
    ).toBe('locked');

    expect(
      getFileManagerPresentationStatus({
        status: 'M',
        lock: { owner: 'jordan', comment: 'editing', date: '2026-05-01T10:00:00Z' },
      })
    ).toBe('M');
  });

  it('creates app handoff URLs with command and selected paths', () => {
    const url = createFileManagerHandoffUrl('commit', [
      'C:\\wc\\src\\file one.ts',
      'C:\\wc\\src\\file-two.ts',
    ]);

    expect(url).toBe(
      'shellysvn://file-manager-action?command=commit&path=C%3A%5Cwc%5Csrc%5Cfile+one.ts&path=C%3A%5Cwc%5Csrc%5Cfile-two.ts'
    );
  });
});

/*
 * Windows shell-integration surface. The host platform is forced to win32 so
 * the Windows branch of getStatus()/getHelperPath() runs regardless of where
 * the suite executes. existsSync stays mocked false (missing helper), which is
 * the documented first-run state until a packaged build installs the helper.
 */
describe('ShellIntegrationManager — Windows', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
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

  it('resolves the helper path to the Windows .exe launcher', () => {
    const manager = new ShellIntegrationManager();
    const status = manager.getStatus();

    // Basename is separator-agnostic: join() uses the host separator, but the
    // launcher name is the same on every platform.
    expect(status.helperPath?.endsWith('ShellySVNShellHelper.exe')).toBe(true);
  });

  it('reports Windows as the platform with overlays gated on registration', () => {
    const status = new ShellIntegrationManager().getStatus();

    expect(status.platform).toBe('windows');
    expect(status.supported).toBe(true);
    // Helper is missing (existsSync mocked false) → not registered.
    expect(status.registered).toBe(false);
    expect(status.helperExists).toBe(false);
    // Icon overlays are a Windows-only feature and require registration.
    expect(status.iconOverlaysAvailable).toBe(false);
    // Finder badges are macOS-only.
    expect(status.finderBadgesAvailable).toBe(false);
    // Windows registration needs elevation; an unregistered state needs admin.
    expect(status.needsAdmin).toBe(true);
    expect(status.fallbackAvailable).toBe(true);
  });

  it('surfaces the Windows missing-helper repair guidance and Explorer limitation', () => {
    const status = new ShellIntegrationManager().getStatus();

    expect(status.message).toContain('Windows shell helper is missing');
    expect(status.repairActions.some((action) => action.includes('ShellySVNShellHelper.exe'))).toBe(
      true
    );
    expect(status.limitations).toContain(
      'Explorer may require restart or sign-out before overlay changes appear.'
    );
  });

  it('refuses to register when the native helper is missing', async () => {
    const result = await new ShellIntegrationManager().register();

    // register() throws when the helper is absent, surfaced as a failure.
    expect(result.success).toBe(false);
    expect(result.error).toContain('Windows shell helper is missing');
    expect(spawn).not.toHaveBeenCalled();
  });
});
