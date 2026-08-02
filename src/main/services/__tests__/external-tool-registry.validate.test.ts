// @vitest-environment node

/**
 * validateExecutable (reached via registry.register) decides which launchers a
 * user may register as an external editor/diff/merge tool. It has Windows-specific
 * permission semantics (no execute bit, so the X_OK and world-writable checks are
 * skipped) and a security guard that refuses shells and scripts. These tests pin
 * the Windows branch and that guard.
 */
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dialog = vi.hoisted(() => ({ filePaths: [] as string[] }));
const userDataDir = vi.hoisted(() => ({ value: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.value },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: dialog.filePaths }),
  },
}));

vi.mock('../utils/secure-json', () => ({
  writeSecureJson: vi.fn().mockResolvedValue(undefined),
}));

import { getExternalToolRegistry } from '../external-tool-registry';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shellysvn-ext-tools-'));
  userDataDir.value = dir;
  dialog.filePaths = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function writeFile(name: string, mode = 0o644): string {
  const path = join(dir, name);
  writeFileSync(path, 'placeholder');
  chmodSync(path, mode);
  return path;
}

describe('validateExecutable (via register)', () => {
  it('rejects command shells by basename', async () => {
    for (const shell of ['cmd.exe', 'powershell.exe', 'pwsh.exe']) {
      dialog.filePaths = [writeFile(shell)];
      await expect(getExternalToolRegistry().register('editor')).rejects.toThrow(
        'Command shells, interpreters, and scripts cannot be registered'
      );
    }
  });

  it('rejects script files by extension', async () => {
    for (const script of ['tool.bat', 'launcher.cmd', 'macro.ps1', 'run.sh']) {
      dialog.filePaths = [writeFile(script)];
      await expect(getExternalToolRegistry().register('editor')).rejects.toThrow(
        'Command shells, interpreters, and scripts cannot be registered'
      );
    }
  });

  it('rejects a directory', async () => {
    dialog.filePaths = [dir];
    await expect(getExternalToolRegistry().register('editor')).rejects.toThrow(
      'Select an executable application'
    );
  });

  it('accepts a normal executable binary', async () => {
    // 0o755 makes the file genuinely executable on POSIX so the X_OK check
    // passes. (The Windows-only cases below deliberately use 0o644/0o646
    // because X_OK is skipped on win32; this test runs on the real platform.)
    dialog.filePaths = [writeFile('myeditor.exe', 0o755)];
    const result = await getExternalToolRegistry().register('editor');
    expect(result).toMatchObject({ name: 'myeditor.exe', roles: ['editor'], builtIn: false });
  });

  describe('Windows permission semantics', () => {
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

    it('accepts a binary that lacks the execute bit (X_OK is skipped on Windows)', async () => {
      // 0o644 is non-executable on POSIX; the Windows branch must not check X_OK.
      dialog.filePaths = [writeFile('noexec.exe', 0o644)];
      await expect(getExternalToolRegistry().register('editor')).resolves.toMatchObject({
        name: 'noexec.exe',
      });
    });

    it('accepts a world-writable binary (mode check is skipped on Windows)', async () => {
      // 0o646 has the world-write bit set; the Windows branch must not reject it.
      dialog.filePaths = [writeFile('loose.exe', 0o646)];
      await expect(getExternalToolRegistry().register('editor')).resolves.toMatchObject({
        name: 'loose.exe',
      });
    });
  });
});
