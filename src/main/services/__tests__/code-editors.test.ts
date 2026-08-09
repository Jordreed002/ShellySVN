// @vitest-environment node
/**
 * The menu must only offer editors that will actually launch, which means the
 * launcher has to be found on `PATH` exactly as a shell would find it.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
const spawnSync = vi.hoisted(() => vi.fn(() => ({ stdout: '' })));
vi.mock('child_process', () => ({ spawn, spawnSync }));

const customTools = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({ get: () => customTools.value }),
}));

vi.mock('../../utils/debug', () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  buildCustomArgs,
  listCodeEditors,
  openInCodeEditor,
  resetCodeEditorCacheForTests,
  setEditorSearchDirectoriesForTests,
} from '../code-editors';

const originalPath = process.env.PATH;
let binDir = '';

function fakeExecutable(name: string) {
  const file = join(binDir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
}

function fakeNonExecutable(name: string) {
  const file = join(binDir, name);
  writeFileSync(file, 'not runnable\n');
  chmodSync(file, 0o644);
}

beforeEach(() => {
  vi.clearAllMocks();
  spawnSync.mockReturnValue({ stdout: '' });
  resetCodeEditorCacheForTests();
  // Otherwise the answer depends on what is installed on this machine.
  setEditorSearchDirectoriesForTests([]);
  customTools.value = [];
  binDir = mkdtempSync(join(tmpdir(), 'shelly-editors-'));
  mkdirSync(binDir, { recursive: true });
  process.env.PATH = binDir;
  // A spawn that reports a successful start.
  spawn.mockImplementation(() => {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const child = {
      once(event: string, handler: (arg?: unknown) => void) {
        handlers[event] = handler;
        if (event === 'spawn') setTimeout(() => handler(), 0);
        return child;
      },
      unref: vi.fn(),
    };
    return child;
  });
});

afterEach(() => {
  process.env.PATH = originalPath;
  setEditorSearchDirectoriesForTests(null);
});

describe('listCodeEditors', () => {
  it('offers only the editors whose launcher is on PATH', async () => {
    fakeExecutable('code');
    fakeExecutable('subl');

    const editors = await listCodeEditors({ refresh: true });

    expect(editors.map((editor) => editor.id)).toEqual(['vscode', 'sublime']);
    expect(editors[0]).toEqual({ id: 'vscode', label: 'VS Code', command: 'code' });
  });

  /*
   * POSIX-only: this asserts the execute-bit filter via access(X_OK). Windows
   * has no execute permission bit — X_OK succeeds for any readable file — so
   * the filter is a no-op there and Windows resolution relies on PATHEXT
   * instead (covered in the 'Windows editor resolution' block below).
   */
  it.skipIf(process.platform === 'win32')(
    'ignores a file that is present but not executable',
    async () => {
      fakeNonExecutable('cursor');

      await expect(listCodeEditors({ refresh: true })).resolves.toEqual([]);
    }
  );

  it('offers nothing when PATH holds no editor at all', async () => {
    await expect(listCodeEditors({ refresh: true })).resolves.toEqual([]);
  });

  it('searches every PATH entry, not just the first', async () => {
    const second = mkdtempSync(join(tmpdir(), 'shelly-editors-2-'));
    writeFileSync(join(second, 'zed'), '#!/bin/sh\n');
    chmodSync(join(second, 'zed'), 0o755);
    process.env.PATH = [binDir, second].join(delimiter);

    const editors = await listCodeEditors({ refresh: true });
    expect(editors.map((editor) => editor.id)).toEqual(['zed']);
  });

  /*
   * The bug this guards: launched from Finder or the dock, the app inherits
   * launchd's `/usr/bin:/bin:/usr/sbin:/sbin` — not the shell's PATH — so an
   * editor in `/usr/local/bin` looked uninstalled and the menu was empty.
   *
   * Windows is skipped here: it has no login-shell PATH discovery (the GUI
   * PATH is taken as-is), so the spawnSync contract these tests assert does
   * not apply. Windows resolution is covered in the describe block below.
   */
  describe.skipIf(process.platform === 'win32')('login-shell PATH discovery (POSIX)', () => {
    it('finds an editor the shell knows about but the GUI PATH does not', async () => {
      fakeExecutable('code');
      // What a Finder-launched app actually sees.
      process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
      spawnSync.mockReturnValue({ stdout: `/usr/bin:${binDir}\n` });

      const editors = await listCodeEditors({ refresh: true });

      expect(editors.map((editor) => editor.id)).toEqual(['vscode']);
      expect(spawnSync).toHaveBeenCalledWith(
        process.env.SHELL,
        ['-ilc', 'printf %s "$PATH"'],
        expect.objectContaining({ timeout: 3000 })
      );
    });

    it('asks the login shell once, not per editor and not per right-click', async () => {
      await listCodeEditors({ refresh: true });
      await listCodeEditors({ refresh: true });

      expect(spawnSync).toHaveBeenCalledTimes(1);
    });

    it('still works when the login shell cannot be read', async () => {
      fakeExecutable('code');
      spawnSync.mockImplementation(() => {
        throw new Error('no shell here');
      });

      await expect(listCodeEditors({ refresh: true })).resolves.toMatchObject([{ id: 'vscode' }]);
    });
  });

  it('holds the PATH scan for the session instead of rescanning per right-click', async () => {
    fakeExecutable('code');
    expect((await listCodeEditors()).map((editor) => editor.id)).toEqual(['vscode']);

    fakeExecutable('cursor');
    // Not rescanned, so the newcomer is not there yet…
    expect((await listCodeEditors()).map((editor) => editor.id)).toEqual(['vscode']);
    // …until asked.
    expect((await listCodeEditors({ refresh: true })).map((editor) => editor.id)).toEqual([
      'vscode',
      'cursor',
    ]);
  });
});

describe('legacy custom application migration', () => {
  it('does not execute legacy renderer-configured commands', async () => {
    await expect(openInCodeEditor('custom:legacy', '/wc/file.txt')).resolves.toEqual({
      success: false,
      error: 'Legacy custom applications are disabled. Re-register this tool in Settings.',
    });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('buildCustomArgs', () => {
  it('appends the path when no template says otherwise', () => {
    expect(buildCustomArgs(undefined, '/wc/x')).toEqual(['/wc/x']);
    expect(buildCustomArgs('   ', '/wc/x')).toEqual(['/wc/x']);
    expect(buildCustomArgs('--new-window', '/wc/x')).toEqual(['--new-window', '/wc/x']);
  });

  it('puts the path exactly where {path} is', () => {
    expect(buildCustomArgs('--diff {path} --wait', '/wc/x')).toEqual(['--diff', '/wc/x', '--wait']);
  });

  it('keeps a quoted argument in one piece', () => {
    expect(buildCustomArgs('--title "My Files" {path}', '/wc/x')).toEqual([
      '--title',
      'My Files',
      '/wc/x',
    ]);
  });

  it('handles a path with spaces without quoting games', () => {
    expect(buildCustomArgs('{path}', '/wc/Gatsby dev workspace')).toEqual([
      '/wc/Gatsby dev workspace',
    ]);
  });
});

describe('openInCodeEditor', () => {
  it('runs the launcher the id maps to, detached, with the path as its argument', async () => {
    fakeExecutable('code');
    await listCodeEditors({ refresh: true });

    await expect(openInCodeEditor('vscode', '/wc/src')).resolves.toEqual({ success: true });

    // The absolute launcher, not the bare name: a GUI-launched app cannot rely
    // on `code` resolving against the PATH it inherited.
    expect(spawn).toHaveBeenCalledWith(
      join(binDir, 'code'),
      ['/wc/src'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
    expect(spawn.mock.calls[0][2].env.PATH).toContain(binDir);
  });

  it('refuses an editor id it does not know, without spawning anything', async () => {
    await expect(openInCodeEditor('rm -rf /', '/wc/src')).resolves.toEqual({
      success: false,
      error: 'Unknown editor: rm -rf /',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses a known editor that is not installed here', async () => {
    await listCodeEditors({ refresh: true });

    await expect(openInCodeEditor('vscode', '/wc/src')).resolves.toMatchObject({
      success: false,
      error: 'VS Code was not found on this machine.',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports a launcher that fails to start', async () => {
    fakeExecutable('code');
    await listCodeEditors({ refresh: true });
    spawn.mockImplementation(() => {
      const child = {
        once(event: string, handler: (arg?: unknown) => void) {
          if (event === 'error') setTimeout(() => handler(new Error('spawn EACCES')), 0);
          return child;
        },
        unref: vi.fn(),
      };
      return child;
    });

    await expect(openInCodeEditor('vscode', '/wc/src')).resolves.toEqual({
      success: false,
      error: 'spawn EACCES',
    });
  });
});

/*
 * Windows editor resolution. The host platform is forced to win32 so the
 * PATHEXT branch runs deterministically regardless of where the suite runs.
 * `code` ships as a `code.cmd` shim on Windows, so detection must consult
 * PATHEXT rather than look for a bare executable.
 */
describe('Windows editor resolution', () => {
  const originalPlatform = process.platform;
  const originalPathExt = process.env.PATHEXT;

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
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
  });

  it('finds an editor through its PATHEXT extension when no bare launcher exists', async () => {
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    // VS Code on Windows is a `code.cmd` shim — there is no bare `code`.
    fakeExecutable('code.cmd');

    const editors = await listCodeEditors({ refresh: true });

    expect(editors.map((editor) => editor.id)).toEqual(['vscode']);
  });

  it('launches the resolved PATHEXT launcher, not the bare command name', async () => {
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    fakeExecutable('code.cmd');
    await listCodeEditors({ refresh: true });

    await openInCodeEditor('vscode', 'C:\\wc\\src');

    expect(spawn).toHaveBeenCalledWith(
      join(binDir, 'code.cmd'),
      ['C:\\wc\\src'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
  });

  it('prefers a bare launcher over PATHEXT extensions when both are present', async () => {
    process.env.PATHEXT = '.EXE;.CMD';
    fakeExecutable('code');
    fakeExecutable('code.cmd');

    await openInCodeEditor('vscode', 'C:\\wc\\src');

    expect(spawn).toHaveBeenCalledWith(
      join(binDir, 'code'),
      ['C:\\wc\\src'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
  });

  it('honours a custom PATHEXT and ignores extensions it does not list', async () => {
    // A setup that only resolves `.bat` must not pick up a `.cmd` shim.
    process.env.PATHEXT = '.BAT';
    fakeExecutable('code.cmd');

    const editors = await listCodeEditors({ refresh: true });

    expect(editors.map((editor) => editor.id)).toEqual([]);
  });

  it('does not query a login shell on Windows (PATH is taken as-is)', async () => {
    process.env.PATHEXT = '.EXE;.CMD';
    fakeExecutable('code.exe');

    await listCodeEditors({ refresh: true });

    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('falls back to the default extension set when PATHEXT is unset', async () => {
    delete process.env.PATHEXT;
    fakeExecutable('code.cmd');

    const editors = await listCodeEditors({ refresh: true });

    expect(editors.map((editor) => editor.id)).toEqual(['vscode']);
  });
});
