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

import { ShellIntegrationManager } from '../ShellIntegration';

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
});
