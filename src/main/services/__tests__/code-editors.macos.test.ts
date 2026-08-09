// @vitest-environment node
/**
 * macOS-focused coverage for editor well-known-directory discovery.
 *
 * Launched from Finder/Dock the app inherits launchd's minimal PATH, so an
 * editor installed under Homebrew or JetBrains Toolbox would look absent unless
 * those install locations are added to the search list. The existing
 * `code-editors.test.ts` deliberately disables the well-known set
 * (`setEditorSearchDirectoriesForTests([])`) to keep PATH assertions hermetic,
 * so nothing pins the darwin directory list — especially the macOS-only
 * JetBrains Toolbox path (`~/Library/...`), which lives elsewhere on Linux.
 *
 * Here `access` is mocked so we can observe exactly which candidate paths the
 * search probes, without writing into real install directories.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => vi.fn().mockRejectedValue(new Error('ENOENT')));
const spawn = vi.hoisted(() => vi.fn());
const spawnSync = vi.hoisted(() => vi.fn(() => ({ stdout: '' })));

vi.mock('fs/promises', () => ({ access }));
vi.mock('child_process', () => ({ spawn, spawnSync }));
vi.mock('../../utils/debug', () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../external-tool-registry', () => ({
  getExternalToolRegistry: () => ({ list: () => Promise.resolve([]) }),
}));

import {
  listCodeEditors,
  resetCodeEditorCacheForTests,
  setEditorSearchDirectoriesForTests,
} from '../code-editors';

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    writable: true,
  });
}

/** Every filesystem path the editor search reached out to touch. */
function probedPaths(): string[] {
  return access.mock.calls.map((call) => call[0] as string);
}

// macOS-only: these assert POSIX path strings produced by path.join, which
// uses the host separator — they can only pass on a darwin host. Skip
// elsewhere so the Windows run stays green; they run in full on macOS.
describe.skipIf(process.platform !== 'darwin')(
  'code-editors: macOS well-known search directories',
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      access.mockRejectedValue(new Error('ENOENT'));
      spawnSync.mockReturnValue({ stdout: '' });
      setPlatform('darwin');
      // Isolate the search to the well-known set: blank PATH and no login shell.
      process.env.PATH = '';
      delete process.env.SHELL;
      setEditorSearchDirectoriesForTests(null); // use the real computed set
      resetCodeEditorCacheForTests();
    });

    afterEach(() => {
      setPlatform(originalPlatform);
      process.env.PATH = originalPath;
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
      setEditorSearchDirectoriesForTests(null);
      resetCodeEditorCacheForTests();
    });

    it('searches the Homebrew install directories on macOS', async () => {
      await listCodeEditors({ refresh: true });

      const probed = probedPaths();
      expect(probed).toContain('/opt/homebrew/bin/code');
      expect(probed).toContain('/usr/local/bin/code');
      expect(probed).toContain('/opt/local/bin/code');
    });

    it('searches the macOS JetBrains Toolbox scripts directory', async () => {
      await listCodeEditors({ refresh: true });

      const probed = probedPaths();
      // darwin-only path; asserted by suffix so the test does not depend on $HOME.
      expect(
        probed.some((path) =>
          path.endsWith('/Library/Application Support/JetBrains/Toolbox/scripts/idea')
        )
      ).toBe(true);
    });

    it('does not search the Linux JetBrains Toolbox path on macOS', async () => {
      await listCodeEditors({ refresh: true });

      const probed = probedPaths();
      expect(probed.some((path) => path.includes('/.local/share/JetBrains/Toolbox/scripts'))).toBe(
        false
      );
    });
  }
);

describe('code-editors: platform boundary vs Windows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockRejectedValue(new Error('ENOENT'));
    spawnSync.mockReturnValue({ stdout: '' });
    setPlatform('win32');
    process.env.PATH = '';
    setEditorSearchDirectoriesForTests(null); // real computation, which is [] on win32
    resetCodeEditorCacheForTests();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    process.env.PATH = originalPath;
    setEditorSearchDirectoriesForTests(null);
    resetCodeEditorCacheForTests();
  });

  it('does not append any well-known directories on Windows', async () => {
    await listCodeEditors({ refresh: true });

    // With a blank PATH and no well-known set on Windows, there is nothing to
    // probe — proving the Homebrew/JetBrains directories are not searched there.
    expect(access).not.toHaveBeenCalled();
  });
});
