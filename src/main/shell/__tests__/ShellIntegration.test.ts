// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

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
  FINDER_BADGE_STATUS_MAP,
  FINDER_CONTEXT_MENU_COMMANDS,
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
      [' ', '!', '?', 'A', 'C', 'D', 'I', 'M', 'R', 'X', '~'].sort()
    );
    expect(OVERLAY_STATUS_MAP.C.icon).toBe('conflict');
    expect(OVERLAY_STATUS_MAP['!'].icon).toBe('missing');
    expect(OVERLAY_STATUS_MAP.X.icon).toBe('external');
  });

  it('defines Finder commands and badge statuses supported by Finder Sync', () => {
    expect(FINDER_CONTEXT_MENU_COMMANDS).toEqual([
      'update',
      'commit',
      'diff',
      'log',
      'revert',
      'cleanup',
      'resolve',
      'lock',
      'unlock',
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
