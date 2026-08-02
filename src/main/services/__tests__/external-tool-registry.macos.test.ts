// @vitest-environment node

/**
 * macOS-focused coverage for the external-tool registry.
 *
 * A `.app` bundle is a directory, so it has to be exempted from the "must be a
 * file" and `access(X_OK)` rules that govern ordinary executables, and `resolve`
 * has to launch it through `/usr/bin/open -a`. The sibling
 * `external-tool-registry.validate.test.ts` pins the Windows permission branch
 * and the shell/script guard; these tests pin the darwin `.app` path and the
 * platform boundary.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

vi.mock('../../utils/secure-json', () => ({
  writeSecureJson: vi.fn().mockResolvedValue(undefined),
}));

import { getExternalToolRegistry } from '../external-tool-registry';

const originalPlatform = process.platform;
let dir: string;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    writable: true,
  });
}

function writeFile(name: string, mode = 0o755): string {
  const path = join(dir, name);
  writeFileSync(path, 'placeholder');
  chmodSync(path, mode);
  return path;
}

function writeAppBundle(name: string): string {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o755);
  return path;
}

// macOS-only: .app bundles and /usr/bin/open dispatch are darwin behaviour,
// and several assertions depend on POSIX path.join output. Skip on non-darwin
// hosts so the Windows run stays green; they run in full on macOS.
describe.skipIf(process.platform !== 'darwin')('external-tool registry: macOS .app bundles', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shellysvn-mac-tools-'));
    userDataDir.value = dir;
    dialog.filePaths = [];
    setPlatform('darwin');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('accepts a .app bundle directory and strips the extension from its name', async () => {
    dialog.filePaths = [writeAppBundle('Sublime.app')];

    const result = await getExternalToolRegistry().register('editor');

    expect(result).toMatchObject({ name: 'Sublime', roles: ['editor'], builtIn: false });
  });

  it('still rejects an ordinary directory that is not a .app bundle', async () => {
    dialog.filePaths = [writeAppBundle('not-an-app')];

    await expect(getExternalToolRegistry().register('editor')).rejects.toThrow(
      'Select an executable application'
    );
  });

  it('launches a .app bundle through /usr/bin/open -a with the expanded arguments', async () => {
    const appPath = writeAppBundle('Sublime.app');
    dialog.filePaths = [appPath];
    const registered = await getExternalToolRegistry().register('editor');
    if (!registered) throw new Error('registration unexpectedly returned null');

    const resolved = await getExternalToolRegistry().resolve(registered.id, 'editor', {
      '{path}': '/Users/test/notes.txt',
    });

    expect(resolved.command).toBe('/usr/bin/open');
    expect(resolved.args[0]).toBe('-a');
    expect(resolved.args[1]).toMatch(/\/Sublime\.app$/);
    expect(resolved.args[2]).toBe('--args');
    expect(resolved.args[3]).toBe('/Users/test/notes.txt');
  });

  it('launches an ordinary executable directly, not through open -a', async () => {
    const binPath = writeFile('vim');
    dialog.filePaths = [binPath];
    const registered = await getExternalToolRegistry().register('editor');
    if (!registered) throw new Error('registration unexpectedly returned null');

    const resolved = await getExternalToolRegistry().resolve(registered.id, 'editor', {
      '{path}': '/Users/test/notes.txt',
    });

    expect(resolved.command).toMatch(/\/vim$/);
    expect(resolved.args).toEqual(['/Users/test/notes.txt']);
  });
});
